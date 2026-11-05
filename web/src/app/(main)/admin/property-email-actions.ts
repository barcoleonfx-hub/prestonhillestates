'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { db, ready } from '@/db/client'
import { propertyEmails } from '@/db/schema'
import { audit } from '@/lib/contacts'
import { mailboxStatus, sendFromMailbox } from '@/lib/mailbox'
import { getProperty } from '@/lib/properties'
import { draftFor, renderEmail, type Sender } from '@/lib/property-email'
import { emailProperty, oneClickUrl, propertyEmailCandidates, siteBase } from '@/lib/property-email-data'
import { now, uid } from '@/lib/util'

export type SendItem = { contactId: string; subject: string; message: string }
export type SendResult = { contactId: string; ok: boolean; error?: string }

const PER_CALL = 5
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function setup(propertyId: string) {
  const me = await requireAdmin()
  await ready()
  const p = await getProperty(propertyId)
  if (!p) return { error: 'That property no longer exists.' } as const
  if (!p.published) return { error: 'Publish the property on the website first, so the link in the email works.' } as const
  const box = await mailboxStatus()
  if (!box?.hasPassword) return { error: 'Connect the office mailbox in Email settings first. Emails are sent from it.' } as const
  const base = await siteBase()
  const sender: Sender = { name: me.name, phone: '020 8904 9005', email: box.user }
  return { me, p, base, sender }
}

/** Sends each person their own tailored email about this listing, a few at a time so the mail server isn't flooded. */
export async function sendPropertyEmails(propertyId: string, items: SendItem[], resend = false): Promise<{ error?: string; results: SendResult[] }> {
  const s = await setup(propertyId)
  if ('error' in s) return { error: s.error, results: [] }
  const { me, p, base, sender } = s
  const prop = emailProperty(p, base)
  const { ready: cands } = await propertyEmailCandidates(p, base)
  const byId = new Map(cands.map((c) => [c.recipient.contactId, c]))
  const results: SendResult[] = []
  for (const item of items.slice(0, PER_CALL)) {
    const c = byId.get(item.contactId)
    if (!c) { results.push({ contactId: item.contactId, ok: false, error: 'No longer a match, or has asked not to be emailed.' }); continue }
    if (c.sentAt && !resend) { results.push({ contactId: item.contactId, ok: false, error: 'Already emailed about this property.' }); continue }
    const d = draftFor(prop, c.recipient, sender)
    const subject = item.subject.trim().slice(0, 150) || d.subject
    const message = item.message.trim().slice(0, 6000) || d.message
    const { html, text } = renderEmail(prop, c.recipient, { ...d, subject, message }, sender)
    const r = await sendFromMailbox({
      to: [c.recipient.email], subject, text, html, by: me.id,
      headers: {
        'List-Unsubscribe': `<${oneClickUrl(base, c.recipient.contactId)}>, <mailto:${sender.email}?subject=Unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })
    await db.insert(propertyEmails).values({
      id: uid(), propertyId: p.id, contactId: c.recipient.contactId, email: c.recipient.email, subject,
      status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error, sentBy: me.id, sentAt: now(),
    })
    results.push(r.ok ? { contactId: item.contactId, ok: true } : { contactId: item.contactId, ok: false, error: r.error })
    if (!r.ok && /password|reach the outgoing/i.test(r.error)) break // the rest would fail the same way
    await pause(700)
  }
  const sent = results.filter((r) => r.ok).length
  if (sent) await audit(me.id, 'property_email', 'property', p.id, `${sent} sent`)
  revalidatePath(`/admin/properties/${p.id}`, 'layout')
  return { results }
}

/** Sends one person's email to the member of staff instead, marked as a test, to check how it looks in a real inbox. */
export async function sendPropertyEmailTest(propertyId: string, item: SendItem): Promise<{ ok?: boolean; error?: string; to?: string }> {
  const s = await setup(propertyId)
  if ('error' in s) return { error: s.error }
  const { me, p, base, sender } = s
  const prop = emailProperty(p, base)
  const c = (await propertyEmailCandidates(p, base)).ready.find((x) => x.recipient.contactId === item.contactId)
  if (!c) return { error: 'That person is no longer on the list.' }
  const d = draftFor(prop, c.recipient, sender)
  const subject = `[Test for ${c.recipient.name}] ${item.subject.trim() || d.subject}`
  const { html, text } = renderEmail(prop, c.recipient, { ...d, subject, message: item.message.trim() || d.message }, sender)
  const r = await sendFromMailbox({ to: [me.email], subject, text, html, by: me.id })
  return r.ok ? { ok: true, to: me.email } : { error: r.error }
}
