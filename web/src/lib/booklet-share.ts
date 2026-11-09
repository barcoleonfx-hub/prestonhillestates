import 'server-only'
import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { bookletShares, enquiries, enquiryNotes, notifications } from '@/db/schema'
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

/** Someone opened the report: count it, and the first time, note it on the enquiry and alert the office. */
export async function recordView(token: string) {
  const s = await shareByToken(token)
  if (!s) return
  const at = now()
  await db.update(bookletShares).set({ views: sql`${bookletShares.views} + 1`, lastViewAt: at, ...(s.firstViewAt ? {} : { firstViewAt: at }) }).where(eq(bookletShares.token, token))
  if (s.firstViewAt || s.bookletId.startsWith('a-')) return
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, s.bookletId) })
  if (!e) return
  await db.insert(enquiryNotes).values({ id: uid(), enquiryId: e.id, body: 'Opened their property report', createdBy: 'system', createdAt: at })
  await db.insert(notifications).values({ id: uid(), kind: 'enquiry', appointmentId: null, title: `${e.name} opened their property report`, body: 'A good moment to call them.', createdBy: null, createdAt: at })
}
