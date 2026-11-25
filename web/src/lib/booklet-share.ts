import 'server-only'
import { randomBytes } from 'node:crypto'
import { and, eq, isNotNull, like, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { bookletShares, enquiries, enquiryMessages, enquiryNotes, leadEvents, mailMessages, notifications, postalLetters, settings } from '@/db/schema'
import { now, uid } from './util'

// The private link to a valuation booklet that goes in the "Your personal property report" email: a long random
// address only the person (and anyone they pass it to) knows. Opening it is noted on the enquiry, and the office
// is alerted the first time, so they know when to call.

/** The booklet's link token, made the first time it's needed. */
export async function shareFor(bookletId: string): Promise<string> {
  await ready()
  const hit = await db.query.bookletShares.findFirst({ where: eq(bookletShares.bookletId, bookletId) })
  if (hit) return hit.token
  const token = randomBytes(18).toString('base64url')
  await db.insert(bookletShares).values({ token, bookletId, createdAt: now() }).onConflictDoNothing()
  return (await db.query.bookletShares.findFirst({ where: eq(bookletShares.bookletId, bookletId) }))!.token
}

export async function shareByToken(token: string) {
  await ready()
  if (!/^[\w-]{16,40}$/.test(token)) return null
  return (await db.query.bookletShares.findFirst({ where: eq(bookletShares.token, token) })) ?? null
}

export async function shareStats(bookletId: string) {
  await ready()
  return (await db.query.bookletShares.findFirst({ where: eq(bookletShares.bookletId, bookletId) })) ?? null
}

/**
 * Whether the report link has actually gone to them: in an email (from the portal or Apple Mail), a WhatsApp sent from
 * the portal, or a letter (its QR code) marked as posted. Until then nobody but us can have it, so an "open" isn't them.
 */
export async function reportSent(bookletId: string, token: string): Promise<boolean> {
  await ready()
  const t = `%${token}%`
  const [msg, mail, wa, letter] = await Promise.all([
    db.select({ id: enquiryMessages.id }).from(enquiryMessages).where(and(eq(enquiryMessages.direction, 'out'), like(enquiryMessages.body, t))).limit(1),
    db.select({ id: mailMessages.id }).from(mailMessages).where(and(eq(mailMessages.direction, 'out'), like(mailMessages.body, t))).limit(1),
    db.select({ id: leadEvents.id }).from(leadEvents).where(and(eq(leadEvents.kind, 'whatsapp'), like(leadEvents.detail, t))).limit(1),
    db.select({ id: postalLetters.id }).from(postalLetters).where(and(eq(postalLetters.enquiryId, bookletId), isNotNull(postalLetters.postedAt))).limit(1),
  ])
  return !!(msg.length || mail.length || wa.length || letter.length)
}

/** Someone opened the report: count it, and the first time, note it on the enquiry and alert the office. */
export async function recordView(token: string) {
  const s = await shareByToken(token)
  if (!s) return
  // Before it's been sent, an "open" is a link preview or someone in the office: it doesn't count.
  if (!s.bookletId.startsWith('a-') && !(await reportSent(s.bookletId, token))) return
  const at = now()
  await db.update(bookletShares).set({ views: sql`${bookletShares.views} + 1`, lastViewAt: at, ...(s.firstViewAt ? {} : { firstViewAt: at }) }).where(eq(bookletShares.token, token))
  if (s.firstViewAt || s.bookletId.startsWith('a-')) return
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, s.bookletId) })
  if (!e) return
  await db.insert(enquiryNotes).values({ id: uid(), enquiryId: e.id, body: 'Opened their property report', createdBy: 'system', createdAt: at })
  await db.insert(notifications).values({ id: uid(), kind: 'enquiry', appointmentId: null, enquiryId: e.id, title: `${e.name} opened their property report`, body: 'A good moment to call them.', createdBy: null, createdAt: at })
}

/**
 * Once: opens recorded before the report was ever sent (link previews, someone in the office) are cleared, with the
 * "opened their property report" note they left.
 */
export async function repairFalseOpens(): Promise<number> {
  await ready()
  const KEY = 'repair_false_opens'
  const mine = await db.insert(settings).values({ key: KEY, value: now(), updatedAt: now() }).onConflictDoNothing()
  if (!mine.rowsAffected) return 0
  const opened = await db.select().from(bookletShares).where(sql`${bookletShares.views} > 0`).limit(2000)
  let n = 0
  for (const s of opened) {
    if (s.bookletId.startsWith('a-') || (await reportSent(s.bookletId, s.token))) continue
    await db.update(bookletShares).set({ views: 0, firstViewAt: null, lastViewAt: null }).where(eq(bookletShares.token, s.token))
    await db.delete(enquiryNotes).where(and(eq(enquiryNotes.enquiryId, s.bookletId), eq(enquiryNotes.body, 'Opened their property report'), eq(enquiryNotes.createdBy, 'system')))
    n++
  }
  return n
}
