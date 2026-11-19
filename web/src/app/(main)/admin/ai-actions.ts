'use server'

import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { writeEmail, type AiRequest, type WriterResult } from '@/lib/email-writer'
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
    about: String(r.about ?? '').slice(0, 800), instruction: String(r.instruction ?? '').slice(0, 800), mode: r.mode === 'improve' ? 'improve' : 'write',
    subject: String(r.subject ?? '').slice(0, 200), draft: String(r.draft ?? '').slice(0, 8000), staffName: me.name,
  })
  if (!('error' in res)) await audit(me.id, 'AI email draft', place, r.enquiryId ?? r.propertyId ?? r.threadId ?? '-', res.note)
  return res
}
