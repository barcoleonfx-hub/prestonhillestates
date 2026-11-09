import 'server-only'
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { enquiries, enquiryMessages, mailMessages, notifications } from '@/db/schema'
import type { ImportRow } from './email-import'
import { now, uid } from './util'

// The email conversation on an enquiry. Everything we send from an enquiry is recorded with its email ID; when
// an email arrives, it's checked against those first, so a reply joins its enquiry (and puts it back under
// "Needs a reply") instead of becoming a new enquiry.

const DAY = 86400000
const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/^((re|fw|fwd|aw)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim()

/** Records an email we sent from an enquiry. */
export async function recordOutgoing(enquiryId: string, m: { messageId: string | null; subject: string; body: string; by: string | null; via?: string; sentAt?: string }) {
  await db.insert(enquiryMessages).values({
    id: uid(), enquiryId, messageId: m.messageId, direction: 'out', subject: m.subject, body: m.body.replace(/\r/g, '').slice(0, 8000), fromAddr: null,
    via: m.via ?? 'portal', sentBy: m.by, sentAt: m.sentAt ?? now(), createdAt: now(),
  }).onConflictDoNothing()
}

/**
 * Is this email a reply to (or a follow-up on) one of our enquiries? In order of certainty:
 * 1. its reply headers name an email we sent from an enquiry, or the enquiry's own email;
 * 2. it's from someone we emailed about an enquiry in the last 90 days, with "Re:" and the same subject;
 * 3. it's a person's email (not a portal lead) from someone with an enquiry in the last 60 days.
 */
export async function matchReply(row: ImportRow): Promise<{ enquiryId: string; how: string } | null> {
  // Our own emails (a copy of something we sent) are never a reply from them.
  if (/@prestonhillestates\./i.test(row.reply.from ?? '')) return null
  const ids = [row.reply.inReplyTo, ...row.reply.references].filter((x): x is string => !!x)
  if (ids.length) {
    const hit = (await db.select({ e: enquiryMessages.enquiryId }).from(enquiryMessages).where(inArray(enquiryMessages.messageId, ids.slice(-30))).limit(1))[0]
    if (hit) return { enquiryId: hit.e, how: 'reply' }
    const lead = (await db.select({ id: enquiries.id }).from(enquiries).where(inArray(enquiries.externalId, ids.slice(-30))).limit(1))[0]
    if (lead) return { enquiryId: lead.id, how: 'reply' }
  }
  const from = (row.reply.from ?? '').toLowerCase()
  const addr = (row.email ?? '').toLowerCase()
  const who = [...new Set([from, addr].filter((x) => x && !/@prestonhillestates\./i.test(x)))]
  if (!who.length) return null
  const subject = norm(row.subject)
  if (/^(re|fw|fwd)\s*:/i.test(row.subject.trim()) && subject) {
    const since = new Date(Date.now() - 90 * DAY).toISOString()
    const sent = await db.select({ e: enquiryMessages.enquiryId, subject: enquiryMessages.subject }).from(enquiryMessages)
      .innerJoin(enquiries, eq(enquiries.id, enquiryMessages.enquiryId))
      .where(and(eq(enquiryMessages.direction, 'out'), gte(enquiryMessages.sentAt, since), inArray(sql`lower(${enquiries.email})`, who)))
      .orderBy(desc(enquiryMessages.sentAt)).limit(20)
    const same = sent.find((m) => norm(m.subject) === subject)
    if (same) return { enquiryId: same.e, how: 'subject' }
  }
  if (row.category === 'person' || row.category === 'skipped') {
    const since = new Date(Date.now() - 60 * DAY).toISOString()
    const open = (await db.select({ id: enquiries.id }).from(enquiries)
      .where(and(inArray(sql`lower(${enquiries.email})`, who), gte(enquiries.createdAt, since)))
      .orderBy(desc(enquiries.createdAt)).limit(1))[0]
    if (open) return { enquiryId: open.id, how: 'same person' }
  }
  return null
}

/** Adds their email to the enquiry's conversation, puts the enquiry back under "Needs a reply", and alerts the office. */
export async function attachReply(enquiryId: string, row: ImportRow, how: string): Promise<boolean> {
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId) })
  if (!e) return false
  const res = await db.insert(enquiryMessages).values({
    id: uid(), enquiryId, messageId: row.reply.messageId ?? row.key, direction: 'in', subject: row.subject, body: row.reply.text || row.message,
    fromAddr: row.reply.from, via: how === 'reply' ? 'email' : `email (${how})`, sentBy: null, sentAt: row.date, createdAt: now(),
  }).onConflictDoNothing()
  if (!res.rowsAffected) return false // already in the conversation
  await db.update(enquiries).set({ handled: false, lastReplyAt: row.date > (e.lastReplyAt ?? '') ? row.date : e.lastReplyAt }).where(eq(enquiries.id, enquiryId))
  await db.insert(notifications).values({
    id: uid(), kind: 'enquiry', appointmentId: null, title: `${e.name} replied`,
    body: [row.subject, row.reply.text.split('\n').find((l) => l.trim())?.slice(0, 140) ?? ''].filter(Boolean).join('\n'), createdBy: null, createdAt: now(),
  })
  return true
}

/**
 * Replies staff sent from Apple Mail (or any mail app) to someone in an enquiry's conversation: found in the
 * portal's copy of the Sent folder by their reply headers, and added to the conversation.
 */
export async function linkSentReplies(): Promise<number> {
  const since = new Date(Date.now() - 30 * DAY).toISOString()
  const known = await db.select({ e: enquiryMessages.enquiryId, id: enquiryMessages.messageId }).from(enquiryMessages).where(gte(enquiryMessages.sentAt, since))
  const leads = await db.select({ e: enquiries.id, id: enquiries.externalId }).from(enquiries).where(and(gte(enquiries.createdAt, since), sql`${enquiries.externalId} IS NOT NULL`))
  const byId = new Map([...leads, ...known].filter((k) => k.id).map((k) => [k.id!, k.e]))
  if (!byId.size) return 0
  const sent = await db.select().from(mailMessages).where(and(eq(mailMessages.direction, 'out'), gte(mailMessages.sentAt, since), or(isNull(mailMessages.via), eq(mailMessages.via, 'mailbox'))))
  let n = 0
  for (const m of sent) {
    const refs = [m.inReplyTo, ...(m.refs ?? '').split(/\s+/)].filter(Boolean) as string[]
    const enquiryId = refs.map((r) => byId.get(r)).find(Boolean)
    if (!enquiryId) continue
    const r = await db.insert(enquiryMessages).values({
      id: uid(), enquiryId, messageId: m.messageId, direction: 'out', subject: m.subject, body: (m.body ?? '').slice(0, 8000), fromAddr: m.fromAddr,
      via: 'mailbox', sentBy: null, sentAt: m.sentAt, createdAt: now(),
    }).onConflictDoNothing()
    if (r.rowsAffected) n++
  }
  return n
}

/** The conversation on an enquiry, oldest first. */
export async function conversation(enquiryId: string) {
  return db.select().from(enquiryMessages).where(eq(enquiryMessages.enquiryId, enquiryId)).orderBy(enquiryMessages.sentAt)
}
