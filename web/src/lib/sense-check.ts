import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { and, eq, gte, inArray, ne, or } from 'drizzle-orm'
import { z } from 'zod'
import { db, ready } from '@/db/client'
import { agentActions, appointments, contacts, enquiries, enquiryMessages } from '@/db/schema'
import type { AgentName } from './agents'
import { agentsMaySpend, recordUsage } from './ai-usage'
import { anthropicKey } from './anthropic-key'
import { emailFacts } from './email-writer'
import { isValuation } from './enquiry-labels'
import { knownBase } from './property-email-data'
import { reportFinal, reportGuide, reportStates } from './report-guide'
import { contentChecks, verdictOf, type Check, type Verdict } from './sense-check-rules'

/** A check's name inside a sentence: “Not asked to stop” → “not asked to stop”, keeping OnTheMarket and Claude. */
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

// The sense-check before any agent message goes. Three layers: rules about the person (fixed in code, no AI),
// rules about the wording (fixed in code), then a second, independent read by Claude against the facts we hold.
// Anything the rules or the reader aren't sure of waits for a person in Needs approval; nothing is ever sent on a guess.

export type { Check, Verdict }
export type Draft = {
  agent: AgentName
  enquiryId: string
  channel: 'email'
  to: string
  subject: string
  text: string
  /** What it's for, in plain words, for the reader: e.g. "Day 2 follow-up to a sales valuation request". */
  purpose: string
  /** Fixed wording staff have already approved (a template), as opposed to words an AI wrote. */
  template: boolean
  /** A nudge to book a valuation: never once one is booked. */
  chase?: boolean
}
export type SenseResult = { verdict: Verdict; checks: Check[]; summary: string }

const WEEK = 7 * 864e5

/** The rules about the person: asked to stop, unsubscribed, already booked, too many messages, another agent on it. */
async function personChecks(d: Draft): Promise<{ checks: Check[]; first: string; postcode: string | null }> {
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, d.enquiryId) })
  if (!e) return { checks: [{ name: 'The enquiry exists', ok: false, level: 'block' }], first: '', postcode: null }
  const c = e.contactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, e.contactId) }) : null
  const to = d.to.trim().toLowerCase()
  const known = [e.email, c?.email].filter(Boolean).map((x) => x!.trim().toLowerCase())
  // All their enquiries: the same person may have asked more than once.
  const theirs = (await db.select({ id: enquiries.id }).from(enquiries).where(or(e.contactId ? eq(enquiries.contactId, e.contactId) : eq(enquiries.id, e.id), eq(enquiries.email, e.email ?? '\u0000')))).map((r) => r.id)
  const since = new Date(Date.now() - WEEK).toISOString()
  const [booked, lately, others] = await Promise.all([
    db.select({ id: appointments.id }).from(appointments).where(and(inArray(appointments.enquiryId, theirs), eq(appointments.kind, 'valuation'), ne(appointments.status, 'cancelled'), gte(appointments.startsAt, new Date(Date.now() - 30 * 864e5).toISOString()))).limit(1),
    db.select({ id: enquiryMessages.id }).from(enquiryMessages).where(and(inArray(enquiryMessages.enquiryId, theirs), eq(enquiryMessages.direction, 'out'), gte(enquiryMessages.sentAt, since))),
    db.select({ agent: agentActions.agent }).from(agentActions).where(and(inArray(agentActions.enquiryId, theirs), eq(agentActions.status, 'done'), eq(agentActions.kind, 'email'), ne(agentActions.agent, d.agent), gte(agentActions.createdAt, since))).limit(1),
  ])
  const checks: Check[] = [
    { name: 'Not asked to stop', ok: !c?.doNotContact && e.outcome !== 'not_interested' && e.outcome !== 'do_not_call', level: 'block' },
    { name: 'Not unsubscribed from our emails', ok: !c?.marketingOptOut, level: 'block' },
    { name: 'Going to their own email address', ok: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) && known.includes(to), level: 'block', note: to },
    { name: 'No more than 3 messages from us this week', ok: lately.length < 3, note: `${lately.length} in the last 7 days` },
    { name: 'One agent at a time', ok: !others.length, note: others[0] ? `the ${others[0].agent} agent emailed them this week` : undefined },
  ]
  if (d.chase !== false && isValuation(e)) checks.push({ name: 'No valuation already booked', ok: !booked.length, level: 'block' })
  const first = (e.name.trim().split(/\s+/)[0] ?? '').replace(/^(mr|mrs|ms|miss|dr)\.?$/i, '')
  const pc = (e.postcode ?? '').toUpperCase().match(/([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/)
  return { checks, first, postcode: pc ? `${pc[1]} ${pc[2]}` : null }
}

const Read = z.object({
  ok: z.boolean().describe('True only if it is accurate, about the right person and home, and fine to send as it is'),
  summary: z.string().describe('One short sentence for staff, e.g. "Accurate and friendly." or "Quotes a price we don’t have."'),
  problems: z.array(z.object({
    severity: z.enum(['must_fix', 'minor']).describe('"must_fix": wrong, misleading, about the wrong person or home, rude or pushy; "minor": could be better'),
    problem: z.string().describe('What is wrong, in one plain sentence'),
  })).describe('At most 5, the most important first. Empty if nothing is wrong.'),
})

const SYSTEM = `You are the second pair of eyes at Preston Hill Estates, an independent estate agent at 271 Preston Road, Harrow HA3 0PS (020 8904 9005), on Preston Road since 2004. An automated agent wants to send the message below to a client. You check it against the facts we hold before it goes. You never rewrite it: you say whether it can go.

It must not go ("must_fix") if any of these is true:
- A number, price, date, name, address or claim contradicts the facts, or isn't supported by them. A valuation figure or guide price may only be the finalised OnTheMarket guide figure given in the facts.
- It's addressed to the wrong person or about the wrong home, or reads as if meant for someone else.
- It promises something we can't know (a sale price, a buyer, a timescale) or uses pressure ("act fast", "won't last", "prices are falling").
- The tone is rude, cold, pushy or over-familiar, or it makes no sense for where this person is (e.g. chasing someone to book after they said no).
- Unfilled placeholders, broken sentences, or machine-like phrasing.

Fixed, already-approved wording is fine as it is: judge whether it fits this person and these facts, not the style. Raise only real problems.`

/** The second read by Claude, or why it didn't run. */
async function aiRead(d: Draft, guide: string | null): Promise<{ ok: boolean; note: string; ran: boolean }> {
  const k = anthropicKey()
  if ('error' in k) return { ok: false, ran: false, note: 'the Claude API key isn’t set' }
  if (!(await agentsMaySpend())) return { ok: false, ran: false, note: 'this month’s AI budget is used up' }
  const facts = await emailFacts({ propertyId: null, enquiryId: d.enquiryId, threadId: null, contactId: null }).catch(() => '')
  const ask = [
    `What it is: ${d.purpose}. ${d.template ? 'Fixed wording staff approved, filled in for this person.' : 'Written by an AI agent for this person.'}`,
    `Today: ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })}`,
    `To: ${d.to}\nSubject: ${d.subject}\n\n${d.text.slice(0, 8000)}`,
    `The facts we hold:\n${facts || '(only the enquiry above)'}`,
    guide ? `Their finalised OnTheMarket guide: ${guide}` : 'There is no finalised OnTheMarket guide for them yet: the message must not give any valuation figure.',
  ].join('\n\n')
  const model = 'claude-sonnet-5-5'
  try {
    const client = new Anthropic({ apiKey: k.key })
    const res = await client.beta.messages.parse({
      model, max_tokens: 6000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system: SYSTEM,
      output_config: { effort: 'medium', format: betaZodOutputFormat(Read) }, messages: [{ role: 'user', content: ask }],
    })
    await recordUsage(model, res.usage, `sense-check: ${d.purpose}`, true)
    if (res.stop_reason === 'refusal' || !res.parsed_output) return { ok: false, ran: false, note: 'the reader couldn’t check it' }
    const out = res.parsed_output
    const must = out.problems.filter((p) => p.severity === 'must_fix')
    const ok = out.ok && !must.length
    return { ok, ran: true, note: ok ? out.summary.trim() : (must.length ? must : out.problems).map((p) => p.problem).join(' ') || out.summary.trim() }
  } catch (e) {
    if (!(e instanceof Anthropic.APIError)) console.error('sense-check read failed', e)
    return { ok: false, ran: false, note: e instanceof Anthropic.APIError ? `the reader didn’t answer (${e.status ?? 'no answer'})` : 'the reader didn’t answer' }
  }
}

/** The fixed rules (no AI): about the person and about the wording. Also what their finalised guide says. */
export async function ruleChecks(d: Draft): Promise<{ checks: Check[]; guide: string | null }> {
  await ready()
  const person = await personChecks(d)
  const [state, guideRow, final, base] = await Promise.all([
    reportStates([d.enquiryId]).then((m) => m.get(d.enquiryId)!), reportGuide(d.enquiryId), reportFinal(d.enquiryId), knownBase(),
  ])
  const isFinal = state.state === 'final' && !state.stale && final
  const prices = isFinal && guideRow ? [guideRow.asking, guideRow.low, guideRow.high].filter((n): n is number => !!n) : []
  const content = contentChecks({ subject: d.subject, text: d.text, channel: d.channel }, { first: person.first, postcode: person.postcode, prices, reportFinal: isFinal, ourHosts: [new URL(base).hostname] })
  const fmt = (n: number | null) => (n ? `£${n.toLocaleString('en-GB')}` : null)
  const guide = isFinal && guideRow ? [`guide price ${fmt(guideRow.asking)}${guideRow.priceFor === 'lettings' ? ' a month' : ''}`, guideRow.low && guideRow.high ? `range ${fmt(guideRow.low)} to ${fmt(guideRow.high)}` : null].filter(Boolean).join(', ') : null
  return { checks: [...person.checks, ...content], guide }
}

const summarise = (checks: Check[]) => {
  const failed = checks.filter((c) => !c.ok)
  return failed.length ? failed.map((c) => lc(c.name) + (c.note ? ` (${c.note})` : '')).join('; ') : `all ${checks.length} checks passed`
}

/** Checks a message an agent wants to send. "pass": send it; "hold": a person looks first; "block": never. */
export async function senseCheck(d: Draft): Promise<SenseResult> {
  const { checks, guide } = await ruleChecks(d)
  if (verdictOf(checks) !== 'block') {
    const read = await aiRead(d, guide)
    // Fixed wording that passed every rule can still go if the reader can't run; anything an AI wrote can't.
    checks.push(read.ran || !d.template
      ? { name: 'Second read by Claude: facts, names and tone', ok: read.ok, note: read.note }
      : { name: 'Second read by Claude: facts, names and tone', ok: true, note: `not run (${read.note}); fixed wording, every rule passed` })
  }
  return { verdict: verdictOf(checks), checks, summary: summarise(checks) }
}
