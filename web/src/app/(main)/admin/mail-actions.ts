'use server'

import { revalidatePath } from 'next/cache'
import { and, desc, eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { mailMessages, mailThreads } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { AREAS } from '@/lib/mail-areas'
import { muteSender } from '@/lib/mail-dashboard'
import { setThreadDone } from '@/lib/mail-store'
import { sendFromMailbox } from '@/lib/mailbox'

export type ReplyState = { ok?: boolean; error?: string; sentAt?: number }
const str = (form: FormData, k: string, max = 500) => String(form.get(k) ?? '').trim().slice(0, max)
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const list = (v: string) => v.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)

/** Replies to a conversation from the office mailbox, keeping it in the same thread for everyone. */
export async function replyToThread(_prev: ReplyState, form: FormData): Promise<ReplyState> {
  const me = await requireAdmin()
  await ready()
  const id = str(form, 'threadId', 64)
  const to = list(str(form, 'to', 500)), cc = list(str(form, 'cc', 500))
  const body = String(form.get('body') ?? '').trim().slice(0, 20_000)
  if (!to.length || !to.every((a) => EMAIL.test(a)) || !cc.every((a) => EMAIL.test(a))) return { error: 'Check the email address.' }
  if (!body) return { error: 'Write a reply first.' }
  const t = await db.query.mailThreads.findFirst({ where: eq(mailThreads.id, id) })
  if (!t) return { error: 'That conversation no longer exists.' }
  // Reply to their latest email so mail programs keep it in the same thread.
  const last = (await db.select().from(mailMessages).where(and(eq(mailMessages.threadId, id), eq(mailMessages.direction, 'in'))).orderBy(desc(mailMessages.sentAt)).limit(1))[0]
    ?? (await db.select().from(mailMessages).where(eq(mailMessages.threadId, id)).orderBy(desc(mailMessages.sentAt)).limit(1))[0]
  const subject = /^\s*re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`
  const references = last ? [...(last.refs ? last.refs.split(/\s+/) : []), last.messageId].slice(-20) : []
  const quoted = last?.body ? `\n\nOn ${new Date(last.sentAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}, ${last.fromName || last.fromAddr} wrote:\n${last.body.split('\n').slice(0, 60).map((l) => `> ${l}`).join('\n')}` : ''
  const r = await sendFromMailbox({ to, cc, subject, text: `${body}\n\n${me.name}\nPreston Hill Estates · 271 Preston Road, Harrow HA3 0PS · 020 8904 9005${quoted}`, inReplyTo: last?.messageId, references, by: me.id })
  if (!r.ok) return { error: r.error }
  await audit(me.id, 'mail_reply', 'mail_thread', id, subject.slice(0, 80))
  revalidatePath('/admin/mail', 'layout')
  return { ok: true, sentAt: Date.now() }
}

export async function markThread(form: FormData) {
  const me = await requireAdmin()
  await ready()
  const id = str(form, 'id', 64)
  const done = form.get('done') === '1'
  await setThreadDone(id, done, me.id)
  await audit(me.id, done ? 'mail_done' : 'mail_reopen', 'mail_thread', id, '')
  revalidatePath('/admin/mail', 'layout')
}

/** Moves a conversation to another part of the business (and its emails with it). */
export async function setThreadArea(form: FormData) {
  const me = await requireAdmin()
  await ready()
  const id = str(form, 'id', 64)
  const area = str(form, 'area', 20)
  if (!AREAS.some((a) => a.id === area)) return
  await db.update(mailMessages).set({ area }).where(and(eq(mailMessages.threadId, id), eq(mailMessages.direction, 'in')))
  await db.update(mailThreads).set({ area }).where(eq(mailThreads.id, id))
  await audit(me.id, 'mail_area', 'mail_thread', id, area)
  revalidatePath('/admin/mail', 'layout')
}

export type UnsubState = { ok?: boolean; error?: string; open?: string }

/** Unsubscribes from a newsletter: one-click where the sender supports it, otherwise by email, then hides the sender. */
export async function unsubscribeSender(_prev: UnsubState, form: FormData): Promise<UnsubState> {
  const me = await requireAdmin()
  await ready()
  const sender = str(form, 'sender', 300).toLowerCase()
  const msg = (await db.select().from(mailMessages).where(and(eq(mailMessages.fromAddr, sender), eq(mailMessages.promo, true))).orderBy(desc(mailMessages.sentAt)).limit(1))[0]
  const link = msg?.unsubscribe ?? ''
  try {
    if (/^https:\/\//i.test(link) && msg?.unsubscribePost) {
      const res = await fetch(link, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click', signal: AbortSignal.timeout(15_000) })
      if (!res.ok && res.status >= 400) return { error: `The sender’s unsubscribe page answered with an error (${res.status}). Try “Open their unsubscribe page” instead.`, open: link }
    } else if (/^mailto:/i.test(link)) {
      const u = new URL(link)
      const r = await sendFromMailbox({ to: [decodeURIComponent(u.pathname)], subject: u.searchParams.get('subject') || 'unsubscribe', text: u.searchParams.get('body') || 'Please unsubscribe this address.', by: me.id })
      if (!r.ok) return { error: r.error }
    } else if (/^https:\/\//i.test(link)) {
      // No one-click support: the person has to confirm on the sender's own page.
      await muteSender(sender)
      revalidatePath('/admin/mail', 'layout')
      return { ok: true, open: link }
    } else {
      await muteSender(sender)
      revalidatePath('/admin/mail', 'layout')
      return { ok: true }
    }
  } catch {
    return { error: 'Couldn’t reach the sender’s unsubscribe service. Try again later.', open: /^https/.test(link) ? link : undefined }
  }
  await muteSender(sender)
  await audit(me.id, 'mail_unsubscribe', 'mail_sender', sender, link.slice(0, 120))
  revalidatePath('/admin/mail', 'layout')
  return { ok: true }
}

export async function hideSender(form: FormData) {
  await requireAdmin()
  await muteSender(str(form, 'sender', 300))
  revalidatePath('/admin/mail', 'layout')
}
