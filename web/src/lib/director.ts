import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { and, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, getClient, ready } from '@/db/client'
import { agentActions, appointments, contacts, enquiries, enquiryMessages, notifications, postalLetters, reportGuides } from '@/db/schema'
import { agentSettings, agentsMaySpend, monthSpend, recordUsage, spendSince } from './ai-usage'
import { guidesToUpload, logAction, todaysLetters } from './agents'
import { heldItems } from './agent-queue'
import { anthropicKey } from './anthropic-key'
import { directorEmail, plainView, viewProblem, type DirectorFacts, type DirectorView, type LeadLine } from './director-rules'
import { enquiryLabel, isValuation } from './enquiry-labels'
import { followupBoard } from './followups'
import { sendFromMailbox } from './mailbox'
import { letterLines } from './postal-letters'
import { shortHome } from './postal-letter-rules'
import { knownBase } from './property-email-data'
import { fmtTime, todayLondon } from './time'
import { now, uid } from './util'

// The Director: one email a day to the office (7:30am London) saying what every agent did, what came of it, what
// the sense-check stopped, and what needs a person today. Numbers are counted here; Claude only writes the short
// view on top, and that is checked against the figures before it goes.

const DAY = 864e5
const londonDay = (d = new Date()) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })

async function count(q: Promise<{ n: number }[]>): Promise<number> { return Number((await q)[0]?.n ?? 0) }
const n = sql<number>`count(*)`

/** Everything the report says, counted over the last 24 hours (and the last 7 days for the scorecard). */
export async function directorFacts(at = new Date()): Promise<DirectorFacts> {
  await ready()
  const since = new Date(at.getTime() - DAY).toISOString()
  const week = new Date(at.getTime() - 7 * DAY).toISOString()
  const [base, newRows, guides, letters, held, board, spend, yesterday, todayStart] = await Promise.all([
    knownBase(),
    db.select({ e: enquiries, c: contacts }).from(enquiries).leftJoin(contacts, eq(enquiries.contactId, contacts.id)).where(gte(enquiries.createdAt, since)).orderBy(desc(enquiries.createdAt)).limit(200),
    guidesToUpload(), todaysLetters(), heldItems(), followupBoard(at), monthSpend(), spendSince(since),
    Promise.resolve(new Date(`${todayLondon()}T00:00:00Z`).toISOString()),
  ])
  const list: LeadLine[] = newRows.map(({ e, c }) => {
    const contacted = e.status !== 'new' || !!e.lastOutboundAt
    return { id: e.id, name: e.name, what: enquiryLabel(e).replace(/^Website /, ''), home: isValuation(e) ? shortHome(letterLines(e, c)) ?? e.postcode : e.postcode, at: e.createdAt, contacted, waitingHours: contacted ? 0 : Math.floor((at.getTime() - Date.parse(e.createdAt)) / 3600e3) }
  })
  // Older leads (up to 3 days) still waiting for us to get back to them count too.
  const waiting = await db.select({ e: enquiries }).from(enquiries).where(and(eq(enquiries.status, 'new'), gte(enquiries.createdAt, new Date(at.getTime() - 3 * DAY).toISOString()), lt(enquiries.createdAt, since))).limit(50)
  for (const { e } of waiting) if (!e.lastOutboundAt) list.push({ id: e.id, name: e.name, what: enquiryLabel(e).replace(/^Website /, ''), home: e.postcode, at: e.createdAt, contacted: false, waitingHours: Math.floor((at.getTime() - Date.parse(e.createdAt)) / 3600e3) })
  list.sort((a, b) => b.waitingHours - a.waitingHours)

  const acts = await db.select({ status: agentActions.status, kind: agentActions.kind, checks: agentActions.checks }).from(agentActions).where(gte(agentActions.createdAt, since))
  const emails = acts.filter((a) => a.kind === 'email')
  const checked = acts.filter((a) => a.checks)
  const dayEnd = new Date(Date.parse(todayStart) + DAY + 3600e3).toISOString()
  const [booked, todays, finalised, prepared, posted, replies, wkVal, wkBooked, wkReplies, wkSent] = await Promise.all([
    count(db.select({ n }).from(appointments).where(and(eq(appointments.kind, 'valuation'), gte(appointments.createdAt, since)))),
    db.select().from(appointments).where(and(eq(appointments.kind, 'valuation'), ne(appointments.status, 'cancelled'), gte(appointments.startsAt, at.toISOString()), lt(appointments.startsAt, dayEnd))).orderBy(appointments.startsAt),
    count(db.select({ n }).from(reportGuides).where(gte(reportGuides.finalisedAt, since))),
    count(db.select({ n }).from(postalLetters).where(gte(postalLetters.createdAt, since))),
    count(db.select({ n }).from(postalLetters).where(gte(postalLetters.postedAt, since))),
    count(db.select({ n }).from(enquiryMessages).where(and(eq(enquiryMessages.direction, 'in'), gte(enquiryMessages.sentAt, since)))),
    db.select({ e: enquiries }).from(enquiries).where(gte(enquiries.createdAt, week)).then((r) => r.filter(({ e }) => isValuation(e)).length),
    count(db.select({ n }).from(appointments).where(and(eq(appointments.kind, 'valuation'), gte(appointments.createdAt, week)))),
    count(db.select({ n }).from(enquiryMessages).where(and(eq(enquiryMessages.direction, 'in'), gte(enquiryMessages.sentAt, week)))),
    count(db.select({ n }).from(agentActions).where(and(eq(agentActions.kind, 'email'), eq(agentActions.status, 'done'), gte(agentActions.createdAt, week)))),
  ])
  // Only today's (London) valuations, not tomorrow's early ones.
  const today = todays.filter((a) => new Date(a.startsAt).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) === todayLondon())
  return {
    day: londonDay(at), base,
    leads: { valuations: newRows.filter(({ e }) => isValuation(e)).length, other: newRows.filter(({ e }) => !isValuation(e)).length, list },
    valuations: { booked, today: today.map((a) => ({ time: fmtTime(a.startsAt), who: a.contactName ?? 'Valuation', where: a.address ?? '' })) },
    guides: { missing: guides.filter((g) => g.report.state === 'none').length, draft: guides.filter((g) => g.report.state === 'draft').length, finalised },
    letters: { prepared, toPrint: letters.reduce((s, b) => s + b.count, 0), posted },
    emails: { sent: emails.filter((a) => a.status === 'done').length, held: emails.filter((a) => a.status === 'held' || a.status === 'rejected' || a.status === 'sending').length, blocked: emails.filter((a) => a.status === 'blocked').length },
    approvals: held.filter((h) => !h.expired).length,
    whatsappsDue: board.waDue.length,
    callsDue: board.callsDue.length,
    replies,
    checks: { total: checked.length, passed: checked.filter((a) => a.status === 'done' || a.status === 'prompted').length, held: checked.filter((a) => a.status === 'held' || a.status === 'rejected').length, blocked: checked.filter((a) => a.status === 'blocked').length },
    week: { valuations: wkVal, booked: wkBooked, replies: wkReplies, sent: wkSent },
    spend: { yesterday, month: spend.agentsGbp, budget: spend.budgetGbp },
  }
}

const View = z.object({
  headline: z.string().describe('One sentence: the single most important thing about the last 24 hours'),
  view: z.string().describe('At most 80 words: what went well, what didn’t, and why it matters. Plain British English.'),
  next: z.array(z.string()).describe('Up to 3 specific things to do today, most important first'),
})

const SYSTEM = `You are the Director of the AI agents at Preston Hill Estates, an independent estate agent at 271 Preston Road, Harrow (since 2004). Each morning you write the short "Director's view" at the top of the daily report to the owner. The agents: the Valuation agent (turns valuation requests into booked valuations: OnTheMarket guide, report, same-day letter, follow-ups) and the follow-ups for other enquiries. The business grows organically: no paid advertising.

Rules:
- Use only the figures given. Never invent or estimate a number; don't add up or average figures yourself. If something is zero, you may say "none".
- The most important thing is speed on valuation leads: a lead waiting hours for a call, or a missing OnTheMarket guide (no report or letter can go without one), comes first.
- Be direct and specific, like a sharp operations director. No praise for the sake of it, no filler, no exclamation marks.
- "next" items must be concrete actions a person can do today.`

async function writeView(f: DirectorFacts): Promise<{ view: DirectorView; note: string | null }> {
  const fallback = (why: string) => ({ view: plainView(f), note: `The Director’s view is the plain summary today: ${why}.` })
  const k = anthropicKey()
  if ('error' in k) return fallback('the Claude API key isn’t set')
  if (!(await agentsMaySpend())) return fallback('this month’s AI budget is used up')
  const model = 'claude-opus-5-5'
  try {
    const client = new Anthropic({ apiKey: k.key })
    const { base: _base, ...facts } = f
    const res = await client.beta.messages.parse({
      model, max_tokens: 8000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system: SYSTEM,
      output_config: { effort: 'medium', format: betaZodOutputFormat(View) },
      messages: [{ role: 'user', content: `Today's figures (last 24 hours unless it says otherwise; "week" is the last 7 days; money in pounds):\n${JSON.stringify(facts, null, 1)}` }],
    })
    await recordUsage(model, res.usage, 'director: daily view', true)
    if (res.stop_reason === 'refusal' || !res.parsed_output) return fallback('Claude couldn’t write it')
    const v = { headline: res.parsed_output.headline.trim(), view: res.parsed_output.view.trim(), next: res.parsed_output.next.slice(0, 3).map((x) => x.trim()) }
    // Sense-check the Director too: any number it uses must be one of today's figures.
    const problem = viewProblem(v, f)
    if (problem) return fallback(`the written view was dropped because ${problem}`)
    return { view: v, note: null }
  } catch (e) {
    if (!(e instanceof Anthropic.APIError)) console.error('director view failed', e)
    return fallback('Claude didn’t answer')
  }
}

/** The report as it would go now (with the plain view, so previews cost nothing). */
export async function previewReport() {
  const f = await directorFacts()
  return directorEmail(f, plainView(f), 'Preview: the Director’s view is written by Claude when the report is sent.')
}

/** Writes and sends the report to the office. */
export async function sendReport(by: string | null = null): Promise<{ ok: boolean; error?: string; to?: string }> {
  const cfg = await agentSettings()
  const to = cfg.directorTo || 'info@prestonhillestates.com'
  const f = await directorFacts()
  const { view, note } = await writeView(f)
  const m = directorEmail(f, view, note)
  const sent = await sendFromMailbox({ to: [to], subject: m.subject, text: m.text, html: m.html, by })
  if (!sent.ok) {
    await logAction({ agent: 'director', kind: 'report', status: 'blocked', title: `Daily report not sent to ${to}`, detail: sent.error.slice(0, 300) })
    await db.insert(notifications).values({ id: uid(), kind: 'approval', appointmentId: null, enquiryId: null, title: 'The daily report couldn’t be sent', body: `${sent.error.slice(0, 200)} Send it from the Agents page once that’s fixed.`, createdBy: null, createdAt: now() })
    return { ok: false, error: sent.error }
  }
  await logAction({ agent: 'director', kind: 'report', status: 'done', title: `Daily report sent to ${to}`, detail: `${m.subject}${note ? `. ${note}` : ''}`, by })
  return { ok: true, to }
}

/** Called by the background job every couple of minutes: sends the day's report once, from 7:30am London. */
export async function runDirector(at = new Date()): Promise<{ ran: boolean }> {
  const cfg = await agentSettings()
  if (cfg.directorOff) return { ran: false }
  const hm = at.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  if (hm < '07:30' || hm >= '12:00') return { ran: false }
  await ready()
  // Once a day, whichever server run gets there first.
  const claim = await getClient().execute({ sql: `INSERT OR IGNORE INTO jobs (name, last_run_at) VALUES (?, ?)`, args: [`director-${todayLondon()}`, at.toISOString()] })
  if (claim.rowsAffected !== 1) return { ran: false }
  await sendReport(null)
  return { ran: true }
}

/** When the last report went (or failed), for the Agents page. */
export async function lastReport() {
  await ready()
  const r = await db.select().from(agentActions).where(and(eq(agentActions.agent, 'director'), inArray(agentActions.status, ['done', 'blocked']))).orderBy(desc(agentActions.createdAt)).limit(1)
  return r[0] ?? null
}
