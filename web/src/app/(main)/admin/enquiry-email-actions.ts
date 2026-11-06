'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, enquiryNotes } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { ENQUIRY_TEMPLATES, renderEnquiryEmail, type EnquiryEmailKind } from '@/lib/enquiry-email'
import { enquiryWorkspace } from '@/lib/enquiry-workspace'
import { sendFromMailbox } from '@/lib/mailbox'
import { now, uid } from '@/lib/util'

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
  const w = await enquiryWorkspace(id, me)
  if (!w) return { error: 'That enquiry no longer exists.' }
  const to = w.e.email?.trim()
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: 'There’s no email address for this person. Call them instead.' }
  if (w.contact?.doNotContact) return { error: 'This person asked not to be contacted.' }
  const { html, text } = renderEnquiryEmail({ ...w.ctx, kind }, t, subject, message)
  const res = await sendFromMailbox({ to: [to], subject, text, html, by: me.id })
  if (!res.ok) return { error: res.error }
  const at = now()
  await db.insert(enquiryNotes).values({ id: uid(), enquiryId: id, body: `Email sent: ${subject}`, createdBy: me.id, createdAt: at })
  // Sending a sales or lettings email settles which list an unsorted enquiry belongs on.
  const side = kind === 'lettings-valuation' || kind === 'tenant' ? 'lettings' : 'sales'
  await db.update(enquiries).set({ handled: true, ...(w.sorted.side ? {} : { side }) }).where(eq(enquiries.id, id))
  if (w.e.contactId) await db.update(contacts).set({ lastContactAt: at, updatedAt: at }).where(eq(contacts.id, w.e.contactId))
  await audit(me.id, 'enquiry_email', 'enquiry', id, `${kind}/${key}: ${subject}`.slice(0, 120))
  revalidatePath('/admin', 'layout')
  return { ok: true, sentAt: Date.now(), subject }
}
