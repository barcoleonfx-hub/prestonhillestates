'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, enquiryNotes } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { ENQUIRY_TEMPLATES, renderEnquiryEmail, type EnquiryEmailKind } from '@/lib/enquiry-email'
import { enquiryWorkspace } from '@/lib/enquiry-workspace'
import { conversation, recordOutgoing } from '@/lib/enquiry-thread'
import { renderReply } from '@/lib/enquiry-email'
import { sendFromMailbox } from '@/lib/mailbox'
import { now, uid } from '@/lib/util'
import { figureText, type CheckComp, type SavedValuation } from '@/lib/valuation-check'

export type SendState = { ok?: boolean; error?: string; sentAt?: number; subject?: string }

const KINDS: EnquiryEmailKind[] = ['sales-valuation', 'lettings-valuation', 'buyer', 'tenant']

/**
 * Sends one of the ready-made emails (with the wording as edited) to the person who enquired, from the office
 * mailbox. It's noted on the enquiry, which counts as dealt with, and the person's last contact is today.
 */
export async function sendEnquiryEmail(_prev: SendState, form: FormData): Promise<SendState> {
  const me = await requireAdmin()
  await ready()
  const id = String(form.get('id') ?? '')
  const kind = String(form.get('kind') ?? '') as EnquiryEmailKind
  const key = String(form.get('template') ?? '')
  const subject = String(form.get('subject') ?? '').trim().slice(0, 200)
  const message = String(form.get('message') ?? '').trim().slice(0, 6000)
  if (!KINDS.includes(kind)) return { error: 'Choose which kind of email to send.' }
  const t = ENQUIRY_TEMPLATES[kind].find((x) => x.key === key)
  if (!t) return { error: 'Choose an email first.' }
  if (!subject || !message) return { error: 'The email needs a subject and a message.' }
  if (/\[(day and time|the times you can offer)\]/i.test(`${subject}\n${message}`)) return { error: 'Fill in the day and time first: the email still says [day and time].' }
  if (/\[your valuation\]/i.test(`${subject}\n${message}`)) return { error: 'Fill in your valuation first: the email still says [your valuation].' }
  const w = await enquiryWorkspace(id, me)
  if (!w) return { error: 'That enquiry no longer exists.' }
  const to = w.e.email?.trim()
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: 'There’s no email address for this person. Call them instead.' }
  if (w.contact?.doNotContact) return { error: 'This person asked not to be contacted.' }
  const { html, text } = renderEnquiryEmail({ ...w.ctx, kind }, t, subject, message)
  const res = await sendFromMailbox({ to: [to], subject, text, html, by: me.id })
  if (!res.ok) return { error: res.error }
  const at = now()
  // Recorded with its email ID, so their reply joins this enquiry.
  await recordOutgoing(id, { messageId: res.messageId, subject, body: message, by: me.id, sentAt: at })
  await db.insert(enquiryNotes).values({ id: uid(), enquiryId: id, body: `Email sent: ${subject}`, createdBy: me.id, createdAt: at })
  // Sending a sales or lettings email settles which list an unsorted enquiry belongs on.
  const side = kind === 'lettings-valuation' || kind === 'tenant' ? 'lettings' : 'sales'
  await db.update(enquiries).set({ handled: true, ...(w.sorted.side ? {} : { side }) }).where(eq(enquiries.id, id))
  if (w.e.contactId) await db.update(contacts).set({ lastContactAt: at, updatedAt: at }).where(eq(contacts.id, w.e.contactId))
  await audit(me.id, 'enquiry_email', 'enquiry', id, `${kind}/${key}: ${subject}`.slice(0, 120))
  revalidatePath('/admin', 'layout')
  return { ok: true, sentAt: Date.now(), subject }
}

export type CheckState = { ok?: boolean; error?: string; savedAt?: number }

/** Saves the valuation check: the comparables found and the figure (or range) settled on. */
export async function saveValuationCheck(_prev: CheckState, form: FormData): Promise<CheckState> {
  const me = await requireAdmin()
  await ready()
  const id = String(form.get('id') ?? '')
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, id) })
  if (!e) return { error: 'That enquiry no longer exists.' }
  const money = (v: FormDataEntryValue | null) => { const t = String(v ?? '').toLowerCase().replace(/[£,\s]/g, ''); const n = parseFloat(t) * (t.endsWith('m') ? 1e6 : t.endsWith('k') ? 1e3 : 1); return Number.isFinite(n) && n > 0 ? Math.round(n) : null }
  let comps: CheckComp[] = []
  try {
    comps = (JSON.parse(String(form.get('comps') ?? '[]')) as CheckComp[]).slice(0, 30)
      .map((c) => ({ source: String(c.source ?? 'Other').slice(0, 30), kind: (['sold', 'asking', 'rent'].includes(c.kind) ? c.kind : 'sold') as CheckComp['kind'], price: Math.round(Number(c.price) || 0), address: String(c.address ?? '').slice(0, 160), beds: c.beds != null && c.beds !== ('' as unknown) ? Number(c.beds) || null : null, link: c.link && /^https:\/\//.test(String(c.link)) ? String(c.link).slice(0, 400) : null }))
      .filter((c) => c.price > 0)
  } catch { return { error: 'The comparables couldn’t be read. Try again.' } }
  const low = money(form.get('low')), high = money(form.get('high'))
  if (low && high && low > high) return { error: 'The lower figure is above the higher one.' }
  const note = String(form.get('note') ?? '').trim().slice(0, 600) || null
  const saved: SavedValuation = { comps, low: low ?? high, high: high ?? low, note, savedAt: now(), savedBy: me.name }
  await db.update(enquiries).set({ valuation: JSON.stringify(saved) }).where(eq(enquiries.id, id))
  const rent = /\bletting\b/.test(e.intent ?? '') || String(form.get('rent')) === '1'
  if (saved.low) await db.insert(enquiryNotes).values({ id: uid(), enquiryId: id, body: `Valuation: ${figureText(saved.low, saved.high, rent)}${comps.length ? ` (${comps.length} comparable${comps.length === 1 ? '' : 's'})` : ''}`, createdBy: me.id, createdAt: now() })
  await audit(me.id, 'valuation_check', 'enquiry', id, figureText(saved.low, saved.high, rent) || 'comparables')
  revalidatePath(`/admin/enquiries/${id}`)
  return { ok: true, savedAt: Date.now() }
}

export type ReplyState = { ok?: boolean; error?: string; sentAt?: number }

/** Replies in the enquiry's email conversation (same thread in their inbox), from the office mailbox. */
export async function replyToEnquiry(_prev: ReplyState, form: FormData): Promise<ReplyState> {
  const me = await requireAdmin()
  await ready()
  const id = String(form.get('id') ?? '')
  const body = String(form.get('body') ?? '').trim().slice(0, 6000)
  if (!body) return { error: 'Write your reply first.' }
  const w = await enquiryWorkspace(id, me)
  if (!w) return { error: 'That enquiry no longer exists.' }
  const to = w.e.email?.trim()
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: 'There’s no email address for this person.' }
  if (w.contact?.doNotContact) return { error: 'This person asked not to be contacted.' }
  const thread = await conversation(id)
  const lastIn = [...thread].reverse().find((m) => m.direction === 'in')
  const last = thread[thread.length - 1]
  const base = (lastIn ?? last)?.subject ?? 'Your enquiry with Preston Hill Estates'
  const subject = /^re:/i.test(base) ? base : `Re: ${base}`
  const refs = [w.e.externalId, ...thread.map((m) => m.messageId)].filter((x): x is string => !!x).slice(-15)
  const { html, text } = renderReply(body, w.ctx.sender)
  const res = await sendFromMailbox({ to: [to], subject, text, html, by: me.id, inReplyTo: (lastIn ?? last)?.messageId ?? w.e.externalId ?? null, references: refs })
  if (!res.ok) return { error: res.error }
  await recordOutgoing(id, { messageId: res.messageId, subject, body, by: me.id })
  await db.update(enquiries).set({ handled: true }).where(eq(enquiries.id, id))
  if (w.e.contactId) await db.update(contacts).set({ lastContactAt: now(), updatedAt: now() }).where(eq(contacts.id, w.e.contactId))
  await audit(me.id, 'enquiry_reply', 'enquiry', id, subject.slice(0, 120))
  revalidatePath('/admin', 'layout')
  return { ok: true, sentAt: Date.now() }
}
