import 'server-only'
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db, ready } from '@/db/client'
import { enquiries, mailMessages, mailThreads, replyDrafts } from '@/db/schema'
import { emailFacts } from './email-writer'
import { isValuation } from './enquiry-labels'
import { junkThreads } from './mail-triage'
import { reportFinal, reportGuide } from './report-guide'
import { contentChecks, type Check } from './sense-check-rules'
import { askClaude } from './staff-briefing-ai'
import { DEFAULT_PEOPLE, isFor, unquoted, type Person } from './staff-briefing-rules'
import { now, uid } from './util'

// The night shift's replies: for every real email waiting on us, a drafted answer written from the conversation and
// what we know about the person. Nothing is sent: in the morning staff read each one, fill in anything in
// [square brackets], and send it or bin it. Pitches and spam are skipped.

const clip = (s: string | null | undefined, n: number) => { const t = (s ?? '').replace(/\r/g, '').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
/** Something staff must fill in: "[confirm the time]". */
export const BLANK = /\[[^\]\n]{2,80}\]/

const Draft = z.object({
  reply: z.boolean().describe('False if no reply is needed (a thank-you, an automated message, a conversation that has ended)'),
  reason: z.string().describe('If no reply is needed, why, in a few words. Otherwise empty.'),
  body: z.string().describe('The reply itself, starting "Hi <first name>," and with no sign-off (the sender’s name and office details are added). Plain text.'),
  check: z.string().describe('One sentence for staff: what to check or fill in before sending (e.g. "Confirm the viewing time with the landlord"). Empty if nothing.'),
})

const SYSTEM = `You draft email replies for Preston Hill Estates, an independent estate agent at 271 Preston Road, Harrow (020 8904 9005), on Preston Road since 2004. A member of staff will read your draft in the morning, change anything that needs it and send it. You never send anything.

Rules:
- Reply to what they actually asked or said, using the conversation and the facts given. Warm, clear, professional British English; short (usually 2 to 5 sentences).
- Never invent anything: no prices, dates, times, availability, names, fees, legal or tax answers, or promises we can't know. Where something is needed that isn't in the facts, put a short instruction in square brackets for staff, e.g. [confirm the viewing time] or [check the deposit amount], and mention it in "check".
- Valuation figures only from a finalised OnTheMarket guide given in the facts; never otherwise.
- Don't sign off and don't add contact details: they're added automatically.
- If no reply is needed, say so (reply: false).`

/** Whose email it is: the person it's addressed to or names, from the briefing list. */
function personFor(m: { toAddrs: string | null; ccAddrs: string | null; subject: string | null; body: string | null }, people: Person[]): string | null {
  return people.find((p) => isFor(m, p.aliases))?.name ?? null
}

export type DraftResult = { drafted: number; notNeeded: number; left: number }

/** Drafts replies for up to `max` conversations waiting on us (oldest first). */
export async function draftReplies(people: Person[] = DEFAULT_PEOPLE, max = 8): Promise<DraftResult> {
  await ready()
  const since = new Date(Date.now() - 21 * 864e5).toISOString()
  const pending = await db.select().from(mailThreads).where(and(eq(mailThreads.status, 'pending'), gte(mailThreads.lastAt, since))).orderBy(asc(mailThreads.lastInAt)).limit(120)
  if (!pending.length) return { drafted: 0, notNeeded: 0, left: 0 }
  const junk = await junkThreads(pending.map((t) => t.id)).catch(() => new Set<string>())
  const lasts = await db.select().from(mailMessages).where(and(inArray(mailMessages.threadId, pending.map((t) => t.id)), eq(mailMessages.direction, 'in'))).orderBy(desc(mailMessages.sentAt))
  const latest = new Map<string, (typeof lasts)[number]>()
  for (const m of lasts) if (!latest.has(m.threadId)) latest.set(m.threadId, m)
  const done = await db.select({ t: replyDrafts.threadId, f: replyDrafts.forMessageId }).from(replyDrafts).where(inArray(replyDrafts.threadId, pending.map((t) => t.id)))
  const has = new Set(done.map((d) => `${d.t}|${d.f}`))
  const todo = pending.filter((t) => !junk.has(t.id) && latest.has(t.id) && !has.has(`${t.id}|${latest.get(t.id)!.messageId}`))
  let drafted = 0, notNeeded = 0
  for (const t of todo.slice(0, max)) {
    const last = latest.get(t.id)!
    // Older drafts for this conversation are out of date: they've written again.
    await db.update(replyDrafts).set({ status: 'stale' }).where(and(eq(replyDrafts.threadId, t.id), eq(replyDrafts.status, 'ready')))
    const r = await draftOne(t, last, people)
    if (r === 'drafted') drafted++
    else if (r === 'not-needed') notNeeded++
  }
  return { drafted, notNeeded, left: Math.max(0, todo.length - max) }
}

async function draftOne(t: typeof mailThreads.$inferSelect, last: typeof mailMessages.$inferSelect, people: Person[]): Promise<'drafted' | 'not-needed' | 'failed'> {
  const convo = (await db.select().from(mailMessages).where(eq(mailMessages.threadId, t.id)).orderBy(desc(mailMessages.sentAt)).limit(6)).reverse()
  const addr = (last.replyTo || last.fromAddr || '').toLowerCase()
  const e = t.contactId
    ? (await db.select().from(enquiries).where(eq(enquiries.contactId, t.contactId)).orderBy(desc(enquiries.createdAt)).limit(1))[0]
    : addr ? (await db.select().from(enquiries).where(eq(enquiries.email, addr)).orderBy(desc(enquiries.createdAt)).limit(1))[0] : undefined
  const [facts, final, g] = e ? await Promise.all([
    emailFacts({ propertyId: null, enquiryId: e.id, threadId: null, contactId: e.contactId }).catch(() => ''),
    isValuation(e) ? reportFinal(e.id).catch(() => false) : Promise.resolve(false),
    isValuation(e) ? reportGuide(e.id).catch(() => null) : Promise.resolve(null),
  ]) : ['', false, null]
  const guide = final && g?.asking ? `Their finalised OnTheMarket guide: guide ${g.priceFor === 'lettings' ? 'rent' : 'price'} £${g.asking.toLocaleString('en-GB')}${g.priceFor === 'lettings' ? ' a month' : ''}${g.low && g.high ? `, range £${g.low.toLocaleString('en-GB')} to £${g.high.toLocaleString('en-GB')}` : ''}.` : 'No finalised OnTheMarket guide: no valuation figure may be given.'
  const ask = [
    `The conversation (oldest first):\n${convo.map((m) => `--- ${m.direction === 'in' ? `From ${m.fromName || m.fromAddr}` : 'From us'}, ${when(m.sentAt)}\nSubject: ${m.subject ?? ''}\n${clip(unquoted(m.body) || m.snippet, 1500)}`).join('\n')}`,
    facts ? `What we know about them:\n${facts}` : 'We have nothing else on file about them.',
    guide,
  ].join('\n\n')
  const r = await askClaude('claude-sonnet-5-5', SYSTEM, Draft, ask, 'night shift: reply draft')
  if ('why' in r) return 'failed'
  const person = personFor(last, people)
  const subject = /^\s*re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`
  if (!r.out.reply || !r.out.body.trim()) {
    await db.insert(replyDrafts).values({ id: uid(), threadId: t.id, forMessageId: last.messageId, person, subject, body: '', checkNote: clip(r.out.reason, 200), status: 'not-needed', createdAt: now() }).onConflictDoNothing()
    return 'not-needed'
  }
  const body = r.out.body.trim()
  const first = (last.fromName ?? '').trim().split(/\s+/)[0]?.replace(/[^A-Za-z'-]/g, '') ?? ''
  const pc = (e?.postcode ?? '').toUpperCase().match(/([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/)
  // The sense-check, as warnings for the person sending it (they decide); [brackets] must be filled before it can go.
  const checks: Check[] = contentChecks({ subject, text: body, channel: 'whatsapp' }, {
    first, postcode: pc ? `${pc[1]} ${pc[2]}` : null, prices: final && g ? [g.asking, g.low, g.high].filter((n): n is number => !!n) : [], reportFinal: !!final, ourHosts: ['www.prestonhillestates.com', 'prestonhillestates.com'],
  }).filter((c) => c.name !== 'No blanks or placeholders' && c.name !== 'A sensible length')
  await db.insert(replyDrafts).values({ id: uid(), threadId: t.id, forMessageId: last.messageId, person, subject, body, checkNote: clip(r.out.check, 300) || null, checks: JSON.stringify(checks), status: 'ready', createdAt: now() }).onConflictDoNothing()
  return 'drafted'
}

export type DraftCard = typeof replyDrafts.$inferSelect & { from: string; theirs: string; theirAt: string; warnings: Check[] }

/** Drafts waiting for someone, newest conversation last (and still current: nobody has replied, nothing newer from them). */
export async function readyDrafts(person?: string | null): Promise<DraftCard[]> {
  await ready()
  const rows = await db.select().from(replyDrafts).where(and(eq(replyDrafts.status, 'ready'), gte(replyDrafts.createdAt, new Date(Date.now() - 7 * 864e5).toISOString()))).orderBy(asc(replyDrafts.createdAt)).limit(100)
  if (!rows.length) return []
  const threads = await db.select().from(mailThreads).where(inArray(mailThreads.id, rows.map((r) => r.threadId)))
  const msgs = await db.select().from(mailMessages).where(inArray(mailMessages.messageId, rows.map((r) => r.forMessageId)))
  const out: DraftCard[] = []
  for (const r of rows) {
    const t = threads.find((x) => x.id === r.threadId)
    const m = msgs.find((x) => x.messageId === r.forMessageId)
    // Already answered since, or they've written again: out of date.
    if (!t || !m || t.status !== 'pending' || (t.lastOutAt && t.lastOutAt > m.sentAt) || (t.lastInAt && t.lastInAt > m.sentAt)) {
      await db.update(replyDrafts).set({ status: 'stale' }).where(eq(replyDrafts.id, r.id)); continue
    }
    if (person !== undefined && person !== null && r.person && r.person !== person) continue
    let warnings: Check[] = []
    try { warnings = (r.checks ? (JSON.parse(r.checks) as Check[]) : []).filter((c) => !c.ok) } catch { /* none */ }
    out.push({ ...r, from: m.fromName || m.fromAddr || 'them', theirs: clip(unquoted(m.body) || m.snippet, 700), theirAt: m.sentAt, warnings })
  }
  return out
}

/** How many drafts are waiting, per person (null: anyone's). */
export async function draftCounts(): Promise<Map<string | null, number>> {
  const all = await readyDrafts()
  const m = new Map<string | null, number>()
  for (const d of all) m.set(d.person, (m.get(d.person) ?? 0) + 1)
  return m
}

