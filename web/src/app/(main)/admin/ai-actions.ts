'use server'

import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { writeEmail, type AiRequest, type WriterResult } from '@/lib/email-writer'
import { checkEmail, fixEmail, type CheckResult, type EditableField, type FixIssue, type FixResult } from '@/lib/email-check'
import { AI_PLACES, type AiPlace } from '@/lib/email-writer-rules'

const recent = new Map<string, number[]>()
/** At most this many AI drafts per person per hour (each costs a few pence). */
const PER_HOUR = 40
const id = (v: unknown) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : null)

/** "Write with AI", anywhere an email is written. Nothing is saved or sent: the words go into the box for staff to check. */
export async function aiWrite(r: AiRequest): Promise<WriterResult | { error: string }> {
  const me = await requireAdmin()
  const times = (recent.get(me.id) ?? []).filter((t) => t > Date.now() - 3600_000)
  if (times.length >= PER_HOUR) return { error: `That’s ${PER_HOUR} AI drafts in the last hour. Try again a little later.` }
  recent.set(me.id, [...times, Date.now()])
  const place: AiPlace = r.place in AI_PLACES ? r.place : 'letter'
  const res = await writeEmail({
    place, propertyId: id(r.propertyId), enquiryId: id(r.enquiryId), threadId: id(r.threadId), contactId: id(r.contactId),
    about: String(r.about ?? '').slice(0, place === 'listing-description' ? 3000 : 800), instruction: String(r.instruction ?? '').slice(0, 800), mode: r.mode === 'improve' ? 'improve' : 'write',
    subject: String(r.subject ?? '').slice(0, 200), draft: String(r.draft ?? '').slice(0, 8000), staffName: me.name,
  })
  if (!('error' in res)) await audit(me.id, 'AI email draft', place, r.enquiryId ?? r.propertyId ?? r.threadId ?? '-', res.note)
  return res
}

/** The check before an email goes. Counts towards the same hourly limit. */
export async function aiCheck(r: { what: string; subject: string; preheader: string; text: string; links: string[]; propertyId: string | null; enquiryId: string | null; contactId: string | null }): Promise<CheckResult | { error: string }> {
  const me = await requireAdmin()
  const times = (recent.get(me.id) ?? []).filter((t) => t > Date.now() - 3600_000)
  if (times.length >= PER_HOUR * 2) return { error: 'That’s a lot of AI checks in the last hour. Try again a little later.' }
  recent.set(me.id, [...times, Date.now()])
  return checkEmail({
    what: String(r.what ?? '').slice(0, 200), subject: String(r.subject ?? '').slice(0, 300), preheader: String(r.preheader ?? '').slice(0, 300),
    text: String(r.text ?? '').slice(0, 20000), links: (Array.isArray(r.links) ? r.links : []).map((l) => String(l).slice(0, 400)).slice(0, 30),
    propertyId: id(r.propertyId), enquiryId: id(r.enquiryId), contactId: id(r.contactId), staffName: me.name,
  })
}

/** "Fix these for me": the check's issues made in the parts staff can edit. Nothing is sent; staff see the changes. */
export async function aiFix(r: { what: string; issues: FixIssue[]; fields: EditableField[]; subject: string; text: string; propertyId: string | null; enquiryId: string | null; contactId: string | null }): Promise<FixResult | { error: string }> {
  const me = await requireAdmin()
  const times = (recent.get(me.id) ?? []).filter((t) => t > Date.now() - 3600_000)
  if (times.length >= PER_HOUR * 2) return { error: 'That’s a lot of AI requests in the last hour. Try again a little later.' }
  recent.set(me.id, [...times, Date.now()])
  const s = (v: unknown, n: number) => String(v ?? '').slice(0, n)
  const res = await fixEmail({
    what: s(r.what, 200), subject: s(r.subject, 300), text: s(r.text, 20000),
    issues: (Array.isArray(r.issues) ? r.issues : []).slice(0, 8).map((i) => ({ severity: i?.severity === 'fix' ? 'fix' : 'consider', where: s(i?.where, 200), problem: s(i?.problem, 600), suggestion: s(i?.suggestion, 1200) })),
    fields: (Array.isArray(r.fields) ? r.fields : []).slice(0, 30).map((f) => ({ key: s(f?.key, 80), label: s(f?.label, 120), value: s(f?.value, 8000), note: f?.note ? s(f.note, 200) : undefined })).filter((f) => f.key),
    propertyId: id(r.propertyId), enquiryId: id(r.enquiryId), contactId: id(r.contactId), staffName: me.name,
  })
  if (!('error' in res)) await audit(me.id, 'AI email fixes', 'check', r.enquiryId ?? r.propertyId ?? '-', `${res.changes.length} change(s)`)
  return res
}
