import 'server-only'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, mailMessages } from '@/db/schema'
import { sortEmailText, sortEnquiry } from './enquiry-labels'
import { now } from './util'

/**
 * Enquiries from emails whose saved summary doesn't say sales or lettings: reads the original email (subject and
 * full text, kept in the mail store) and saves the answer and the reason. Each enquiry is checked once; up to
 * 400 a run, so a backlog clears in a few minutes.
 */
export async function sortFromEmails(): Promise<{ ran: boolean; checked: number; sorted: number }> {
  await ready()
  const rows = await db.select({ id: enquiries.id, kind: enquiries.kind, intent: enquiries.intent, message: enquiries.message, externalId: enquiries.externalId })
    .from(enquiries).where(and(eq(enquiries.kind, 'email'), isNull(enquiries.side), isNull(enquiries.propertyId), isNull(enquiries.sideCheckedAt))).limit(400)
  if (!rows.length) return { ran: false, checked: 0, sorted: 0 }
  const todo = rows.filter((r) => !sortEnquiry(r).side)
  const ids = todo.map((r) => r.externalId).filter((x): x is string => !!x)
  const mails = new Map<string, { subject: string | null; body: string | null }>()
  for (let i = 0; i < ids.length; i += 100) {
    for (const m of await db.select({ id: mailMessages.messageId, subject: mailMessages.subject, body: mailMessages.body }).from(mailMessages).where(inArray(mailMessages.messageId, ids.slice(i, i + 100)))) mails.set(m.id, m)
  }
  let sorted = 0
  const t = now()
  for (const r of rows) {
    const mail = r.externalId ? mails.get(r.externalId) : undefined
    const res = todo.includes(r) && mail ? sortEmailText(mail.subject ?? '', (mail.body ?? '').slice(0, 20000)) : null
    if (res?.side) sorted++
    await db.update(enquiries).set({ autoSide: res?.side ?? null, sideWhy: res?.side ? res.why : null, sideCheckedAt: t }).where(eq(enquiries.id, r.id))
  }
  return { ran: true, checked: rows.length, sorted }
}
