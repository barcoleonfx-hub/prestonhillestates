import 'server-only'
import { and, asc, eq, gt, gte, inArray, like, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db, ready } from '@/db/client'
import { admins, calls, contacts, mailMessages, promises } from '@/db/schema'
import { askClaude } from './staff-briefing-ai'
import { DEFAULT_PEOPLE, signedBy, unquoted, type Person } from './staff-briefing-rules'
import { now, uid } from './util'

// The promise tracker: every night, the emails staff sent that day are read for commitments ("I'll call you
// tomorrow", "I'll send the contract on Friday"). Each is tracked until we've been back in touch with that person
// (an email or a logged call), and shows in the person's briefing and the Director's snapshot when it's due.

const Found = z.object({
  promises: z.array(z.object({
    ref: z.string().describe('The [ref] of the email it is in'),
    promise: z.string().describe('What we promised, as a short instruction to ourselves, e.g. "Call Mr Shah about the survey"'),
    due: z.string().describe('The date it is due, YYYY-MM-DD, worked out from the email’s date ("tomorrow", "Friday", "next week" = the Monday). Empty if no time was given.'),
  })).describe('Only real commitments by us to do something specific. Not pleasantries ("let me know if you need anything"), not things the other person will do.'),
})

const SYSTEM = `You read emails sent by staff at an estate agent and pick out what they promised to do: call someone, send something, arrange or check something, by a time. Only real, specific commitments made by us. Use the email's date to work out the due date.`

const londonDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** Reads the emails staff sent between `from` and `to` for promises (each email once). */
export async function findPromises(from: string, to: string, people: Person[] = DEFAULT_PEOPLE): Promise<number> {
  await ready()
  const sent = (await db.select().from(mailMessages).where(and(eq(mailMessages.direction, 'out'), gte(mailMessages.sentAt, from), lt(mailMessages.sentAt, to))).orderBy(asc(mailMessages.sentAt)).limit(80))
    // Staff's own emails only: not the agents' automatic ones (sent from the portal by nobody).
    .filter((m) => !(m.via === 'portal' && !m.sentBy))
  if (!sent.length) return 0
  const seen = new Set((await db.select({ id: promises.messageId }).from(promises).where(inArray(promises.messageId, sent.map((m) => m.messageId)))).map((r) => r.id))
  const todo = sent.filter((m) => !seen.has(m.messageId))
  if (!todo.length) return 0
  const staff = await db.select({ id: admins.id, name: admins.name }).from(admins)
  const whoSent = (m: (typeof todo)[number]) => {
    const byName = m.sentBy ? staff.find((s) => s.id === m.sentBy)?.name : null
    return people.find((p) => (byName && p.aliases.some((a) => byName.toLowerCase().split(/\s+/).includes(a.toLowerCase()))) || signedBy(m.body, p.aliases))?.name ?? null
  }
  const refs = todo.map((m, i) => ({ ref: `E${i + 1}`, m }))
  const ask = refs.map(({ ref, m }) => `[${ref}] Sent ${new Date(m.sentAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })} to ${m.toAddrs ?? ''}\nSubject: ${m.subject ?? ''}\n${clip(unquoted(m.body), 1500)}`).join('\n\n')
  const r = await askClaude('claude-sonnet-5-5', SYSTEM, Found, ask, 'night shift: promises', 'low')
  if ('why' in r) return 0
  let n = 0
  for (const p of r.out.promises) {
    const hit = refs.find((x) => x.ref === p.ref)
    if (!hit || !p.promise.trim()) continue
    const m = hit.m
    const sentDay = londonDate(m.sentAt)
    // A due date must be a real date from the day it was sent to 60 days on; otherwise three working days on.
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(p.due) && p.due >= sentDay && Date.parse(p.due) - Date.parse(sentDay) <= 60 * 864e5
    const due = ok ? p.due : londonDate(new Date(Date.parse(m.sentAt) + 3 * 864e5).toISOString())
    const addr = (m.toAddrs ?? '').toLowerCase().match(/[^\s<>,;"']+@[^\s<>,;"']+/)?.[0] ?? null
    const name = (m.toAddrs ?? '').replace(/<[^>]*>/g, '').split(',')[0]?.replace(/["']/g, '').trim() || addr
    const res = await db.insert(promises).values({ id: uid(), messageId: m.messageId, threadId: m.threadId, person: whoSent(m), toName: name, toAddr: addr, promise: clip(p.promise.trim(), 200), dueDate: due, status: 'open', sentAt: m.sentAt, createdAt: now() }).onConflictDoNothing()
    if (res.rowsAffected) n++
  }
  // Emails with no promise are marked as read too, so they're not read again.
  for (const m of todo) if (!r.out.promises.some((p) => refs.find((x) => x.ref === p.ref)?.m.messageId === m.messageId)) {
    await db.insert(promises).values({ id: uid(), messageId: m.messageId, threadId: m.threadId, person: null, toName: null, toAddr: null, promise: '(none)', dueDate: null, status: 'none', sentAt: m.sentAt, createdAt: now() }).onConflictDoNothing()
  }
  return n
}

/** Marks promises kept once we've been back in touch (an email to them, or a logged call); old ones lapse. */
export async function checkPromises(): Promise<{ kept: number; lapsed: number }> {
  await ready()
  const open = await db.select().from(promises).where(eq(promises.status, 'open')).limit(300)
  let kept = 0, lapsed = 0
  for (const p of open) {
    let done = false
    if (p.toAddr) {
      const later = await db.select({ id: mailMessages.id }).from(mailMessages).where(and(eq(mailMessages.direction, 'out'), gt(mailMessages.sentAt, p.sentAt), ne(mailMessages.messageId, p.messageId), like(mailMessages.toAddrs, `%${p.toAddr}%`))).limit(1)
      done = later.length > 0
      if (!done) {
        const c = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, p.toAddr)).limit(5)
        if (c.length) done = (await db.select({ id: calls.id }).from(calls).where(and(inArray(calls.contactId, c.map((x) => x.id)), gt(calls.createdAt, p.sentAt))).limit(1)).length > 0
      }
    }
    if (done) { await db.update(promises).set({ status: 'kept', keptAt: now() }).where(eq(promises.id, p.id)); kept++; continue }
    if (p.dueDate && Date.parse(`${p.dueDate}T12:00:00Z`) < Date.now() - 14 * 864e5) { await db.update(promises).set({ status: 'lapsed' }).where(eq(promises.id, p.id)); lapsed++ }
  }
  return { kept, lapsed }
}

export type OpenPromise = typeof promises.$inferSelect

/** Open promises due by `day` (YYYY-MM-DD), for one person or everyone. */
export async function promisesDue(day: string, person?: string): Promise<OpenPromise[]> {
  await ready()
  const rows = await db.select().from(promises).where(and(eq(promises.status, 'open'))).orderBy(asc(promises.dueDate)).limit(200)
  return rows.filter((p) => p.dueDate && p.dueDate <= day && (person === undefined || p.person === person))
}
