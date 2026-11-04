import 'server-only'
import { and, asc, desc, eq, gte, inArray, ne, notInArray, or, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { mailMessages, mailThreads, settings, type MailThread } from '@/db/schema'
import { AREAS } from '@/lib/mail-areas'
import { now } from '@/lib/util'

const HIDDEN = ['promo', 'internal', 'leads']
const MUTED_KEY = 'mail_muted'

export type AreaWeek = { id: string; label: string; hint: string; received: number; dealt: number; waiting: number; top: MailThread[] }
export type Sender = { sender: string; n: number; last: string; subject: string; unsubscribe: string | null; oneClick: boolean }

export async function mutedSenders(): Promise<string[]> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, MUTED_KEY) })
  try { return row ? (JSON.parse(row.value) as string[]) : [] } catch { return [] }
}
export async function muteSender(sender: string) {
  const list = [...new Set([...(await mutedSenders()), sender.toLowerCase()])]
  await db.insert(settings).values({ key: MUTED_KEY, value: JSON.stringify(list), updatedAt: now() })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(list), updatedAt: now() } })
}

/** Everything the Inbox page shows, in one go. */
export async function inboxDashboard(days = 7) {
  await ready()
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const realThread = notInArray(mailThreads.area, HIDDEN)

  const [receivedRows, dealtRows, waitingRows, recent, waiting, dealt, leads, promoRows, muted, totals] = await Promise.all([
    db.select({ area: mailMessages.area, n: sql<number>`count(*)` }).from(mailMessages)
      .where(and(eq(mailMessages.direction, 'in'), gte(mailMessages.sentAt, since), notInArray(mailMessages.area, HIDDEN))).groupBy(mailMessages.area),
    db.select({ area: mailThreads.area, n: sql<number>`count(*)` }).from(mailThreads)
      .where(and(realThread, inArray(mailThreads.status, ['replied', 'done']), or(gte(mailThreads.lastOutAt, since), gte(mailThreads.doneAt, since)))).groupBy(mailThreads.area),
    db.select({ area: mailThreads.area, n: sql<number>`count(*)` }).from(mailThreads).where(and(realThread, eq(mailThreads.status, 'pending'))).groupBy(mailThreads.area),
    db.select().from(mailThreads).where(and(realThread, ne(mailThreads.status, 'sent'), gte(mailThreads.lastAt, since))).orderBy(desc(mailThreads.lastAt)).limit(400),
    db.select().from(mailThreads).where(and(realThread, eq(mailThreads.status, 'pending'))).orderBy(asc(mailThreads.lastInAt)).limit(300),
    db.select().from(mailThreads).where(and(realThread, inArray(mailThreads.status, ['replied', 'done']), or(gte(mailThreads.lastOutAt, since), gte(mailThreads.doneAt, since)))).orderBy(desc(mailThreads.lastAt)).limit(60),
    db.select({ n: sql<number>`count(*)` }).from(mailMessages).where(and(eq(mailMessages.area, 'leads'), gte(mailMessages.sentAt, since))),
    db.select({
      sender: mailMessages.fromAddr, n: sql<number>`count(*)`, last: sql<string>`max(${mailMessages.sentAt})`,
      unsubscribe: sql<string | null>`max(${mailMessages.unsubscribe})`, oneClick: sql<number>`max(${mailMessages.unsubscribePost})`,
    }).from(mailMessages).where(and(eq(mailMessages.promo, true), gte(mailMessages.sentAt, new Date(Date.now() - 60 * 86400000).toISOString())))
      .groupBy(mailMessages.fromAddr).orderBy(desc(sql`count(*)`)).limit(60),
    mutedSenders(),
    db.select({ n: sql<number>`count(*)`, promo: sql<number>`sum(case when ${mailMessages.promo} = 1 then 1 else 0 end)` }).from(mailMessages)
      .where(and(eq(mailMessages.direction, 'in'), gte(mailMessages.sentAt, since))),
  ])
  const by = (rows: { area: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.area, Number(r.n)]))
  const rec = by(receivedRows), dl = by(dealtRows), wt = by(waitingRows)
  const areas: AreaWeek[] = AREAS.map((a) => ({
    id: a.id, label: a.label, hint: a.hint, received: rec[a.id] ?? 0, dealt: dl[a.id] ?? 0, waiting: wt[a.id] ?? 0,
    top: recent.filter((t) => t.area === a.id).sort((x, y) => (x.status === 'pending' ? -1 : 0) - (y.status === 'pending' ? -1 : 0)).slice(0, 4),
  }))
  // The latest subject from each sender.
  const latest = new Map<string, string>()
  const subj = promoRows.length ? await db.select({ f: mailMessages.fromAddr, s: mailMessages.subject, at: mailMessages.sentAt }).from(mailMessages)
    .where(and(eq(mailMessages.promo, true), inArray(mailMessages.fromAddr, promoRows.map((r) => r.sender!).filter(Boolean)))).orderBy(desc(mailMessages.sentAt)).limit(3000) : []
  for (const r of subj) if (r.f && !latest.has(r.f)) latest.set(r.f, r.s ?? '')
  const senders: Sender[] = promoRows.filter((r) => r.sender && !muted.includes(r.sender)).map((r) => ({
    sender: r.sender!, n: Number(r.n), last: r.last, subject: latest.get(r.sender!) ?? '', unsubscribe: r.unsubscribe, oneClick: !!Number(r.oneClick),
  }))
  return {
    since, areas, waiting, dealt, senders,
    leads: Number(leads[0]?.n ?? 0),
    received: Number(totals[0]?.n ?? 0) - Number(totals[0]?.promo ?? 0),
    promoCount: Number(totals[0]?.promo ?? 0),
  }
}

/** One conversation with all its emails, oldest first. */
export async function threadWithMessages(id: string) {
  await ready()
  const t = await db.query.mailThreads.findFirst({ where: eq(mailThreads.id, id) })
  if (!t) return null
  const messages = await db.select().from(mailMessages).where(eq(mailMessages.threadId, id)).orderBy(asc(mailMessages.sentAt))
  return { thread: t, messages }
}

/** A filtered list of conversations for "see all". */
export async function threadList(opts: { area?: string; status?: string; q?: string; limit?: number }) {
  await ready()
  const where = [notInArray(mailThreads.area, HIDDEN)]
  if (opts.area) where.push(eq(mailThreads.area, opts.area))
  if (opts.status === 'pending') where.push(eq(mailThreads.status, 'pending'))
  else if (opts.status === 'dealt') where.push(inArray(mailThreads.status, ['replied', 'done']))
  else if (opts.status === 'info') where.push(eq(mailThreads.status, 'info'))
  if (opts.q) {
    const t = `%${opts.q.toLowerCase()}%`
    where.push(or(sql`lower(${mailThreads.subject}) like ${t}`, sql`lower(coalesce(${mailThreads.counterpart}, '')) like ${t}`, sql`lower(coalesce(${mailThreads.counterpartName}, '')) like ${t}`)!)
  }
  return db.select().from(mailThreads).where(and(...where, notInArray(mailThreads.status, ['promo', 'sent']))).orderBy(desc(mailThreads.lastAt)).limit(opts.limit ?? 200)
}
