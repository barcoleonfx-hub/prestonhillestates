import 'server-only'
// Runs the follow-ups (see lib/followup-rules): puts new leads on the sequence, sends the emails that are due from
// the office mailbox (never on Sundays or outside 9am to 9pm), and keeps the WhatsApps that are due on the
// Follow-ups page for staff to send. Stops as soon as the person replies or the lead moves on.

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { admins, calls, contacts, enquiries, followupLog, properties, settings, type Contact, type Enquiry } from '@/db/schema'
import { enquirySide, isValuation } from './enquiry-labels'
import { isBoilerplate } from './email-import'
import { detailLines } from './enquiry-workspace'
import { recordOutgoing } from './enquiry-thread'
import { toE164 } from './lead-rules'
import { mailboxStatus, sendFromMailbox } from './mailbox'
import { displayAddressFor } from './properties'
import { knownBase, oneClickUrl, unsubscribeUrl } from './property-email-data'
import { REPORT_WAIT_DAYS, WHATSAPP_GRACE_DAYS, dueAt, followupEmail, isStaffStep, nextDue, planLabel, stepSkip, stepsFor, stopReason, type LeadState, type StepDef, type Track } from './followup-rules'
import { logAction, queueFollowupLetter } from './agents'
import { shareFor } from './booklet-share'
import { reportFinal, reportGuide, reportStates } from './report-guide'
import { holdForApproval } from './agent-queue'
import { senseCheck } from './sense-check'
import { mailPaused, noteMailError } from './mail-health'
import { now, uid } from './util'
import { quietReason, waBlocked } from './whatsapp'

const KEY = 'followups'
export type FollowupSettings = { on: boolean; since: string | null; by: string | null; at: string | null }

export async function followupSettings(): Promise<FollowupSettings> {
  await ready()
  const r = await db.query.settings.findFirst({ where: eq(settings.key, KEY) })
  try { return { on: false, since: null, by: null, at: null, ...(r ? JSON.parse(r.value) : {}) } } catch { return { on: false, since: null, by: null, at: null } }
}
export async function saveFollowupSettings(v: FollowupSettings) {
  await db.insert(settings).values({ key: KEY, value: JSON.stringify(v), updatedAt: now() })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(v), updatedAt: now() } })
}

type Row = { e: Enquiry; c: Contact | null; channel: string | null; ownerName: string | null; p: typeof properties.$inferSelect | null }

export function trackOf(r: Pick<Row, 'e' | 'c' | 'channel'>): Track {
  const side = enquirySide(r.e, r.channel, r.c?.roles) ?? 'sales'
  if (isValuation(r.e)) return side === 'lettings' ? 'lettings-valuation' : 'sales-valuation'
  return side === 'lettings' ? 'tenant' : 'buyer'
}

/** The home to value, or the one they asked about; never a portal's small print. */
export function addressOf(r: Row): { address: string | null; postcode: string | null } {
  const pc = (s: string | null | undefined) => (s ?? '').match(/([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/i)
  if (r.p) { const m = pc(r.p.postcode); return { address: displayAddressFor(r.p), postcode: m ? `${m[1]} ${m[2]}`.toUpperCase() : null } }
  const lines = detailLines(r.e.message)
  const f = (re: RegExp) => { const v = lines.find((l) => l.label && re.test(l.label))?.value ?? null; return v && !isBoilerplate(v) && !/^£/.test(v) ? v : null }
  const named = f(/^(address|property)$/i) ?? f(/^about$/i) ?? (isValuation(r.e) ? f(/^their address$/i) : null)
  const m = pc(r.e.postcode) ?? pc(named)
  const postcode = m ? `${m[1]} ${m[2]}`.toUpperCase() : null
  const address = named?.replace(/,?\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\s*$/i, '').trim() || null
  return { address, postcode }
}

function stateOf(r: Row): LeadState {
  const e164 = r.c?.phoneE164 ?? toE164(r.e.phone ?? r.c?.phone)
  return {
    status: r.e.status, startedAt: r.e.followupStartedAt ?? r.e.createdAt, lastInboundAt: r.e.lastInboundAt, lastOutboundAt: r.e.lastOutboundAt,
    doNotContact: !!r.c?.doNotContact, marketingOptOut: !!r.c?.marketingOptOut, email: r.e.email?.trim() || r.c?.email || null,
    canWhatsApp: !waBlocked({ e164, doNotContact: r.c?.doNotContact, stoppedAt: r.c?.whatsappStoppedAt }),
    phone: e164 ?? (r.e.phone?.trim() || r.c?.phone || null),
  }
}

async function rows(where: ReturnType<typeof and>, limit: number): Promise<Row[]> {
  const r = await db.select({ e: enquiries, c: contacts, channel: properties.channel, ownerName: admins.name, p: properties }).from(enquiries)
    .leftJoin(contacts, eq(enquiries.contactId, contacts.id)).leftJoin(properties, eq(enquiries.propertyId, properties.id)).leftJoin(admins, eq(enquiries.ownerId, admins.id))
    .where(where).orderBy(asc(enquiries.followupNextAt)).limit(limit)
  return r
}

type StepPos = Pick<Enquiry, 'id' | 'followupPlan' | 'followupStep'>
/** The step a lead is on, in its own plan. */
export const stepOf = (e: Pick<Enquiry, 'followupPlan' | 'followupStep'>): StepDef | undefined => stepsFor(e.followupPlan)[e.followupStep]

async function log(e: StepPos, status: string, detail: string | null, by: string | null = 'system') {
  const s = stepOf(e)
  await db.insert(followupLog).values({ id: uid(), enquiryId: e.id, step: s?.key ?? String(e.followupStep), channel: s?.channel ?? 'email', status, detail, createdBy: by, createdAt: now() })
}

/** Moves a lead on to its next step (or finishes the plan). */
export async function advance(e: Pick<Enquiry, 'id' | 'followupStep' | 'followupStartedAt' | 'createdAt' | 'followupPlan'>, at = new Date()) {
  const next = e.followupStep + 1
  const when = nextDue(e.followupStartedAt ?? e.createdAt, next, at, e.followupPlan)
  const done = e.followupPlan === 'valuation' ? 'Valuation plan done: over to Seller outreach' : e.followupPlan === 'after-visit' ? 'After-visit follow-ups done' : 'All follow-ups done'
  await db.update(enquiries).set(when ? { followupStep: next, followupNextAt: when } : { followupStep: next, followupState: 'done', followupNextAt: null, followupNote: done }).where(eq(enquiries.id, e.id))
}

/** Tries a step again later (e.g. waiting for the report): never past the given time. */
async function later(e: Pick<Enquiry, 'id'>, at: Date, hours: number) {
  await db.update(enquiries).set({ followupNextAt: new Date(at.getTime() + hours * 3600e3).toISOString() }).where(eq(enquiries.id, e.id))
}

async function stop(id: string, why: string) {
  await db.update(enquiries).set({ followupState: 'stopped', followupNextAt: null, followupNote: why }).where(eq(enquiries.id, id))
}

/** Puts a lead on its plan from now (staff starting it by hand, e.g. for an older enquiry). Valuations get the valuation plan. */
export async function startFollowups(id: string, from = new Date()) {
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, id) })
  if (!e) return
  const plan = isValuation(e) ? 'valuation' : null
  const startedAt = from.toISOString()
  await db.update(enquiries).set({ followupState: 'active', followupPlan: plan, followupStep: 0, followupStartedAt: startedAt, followupNextAt: dueAt(startedAt, stepsFor(plan)[0].day), followupNote: null }).where(eq(enquiries.id, id))
}

/**
 * Moves a valuation lead from the earlier follow-ups onto the valuation plan at the day it has reached (counted from
 * the enquiry), so it carries on from there rather than starting again. Returns false if it's past the plan's end.
 */
export async function moveToValuationPlan(id: string, at = new Date()): Promise<boolean> {
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, id) })
  if (!e || e.followupState !== 'active' || e.followupPlan === 'valuation' || !isValuation(e)) return false
  const startedAt = e.followupStartedAt ?? e.createdAt
  const days = Math.floor((at.getTime() - Date.parse(startedAt)) / 864e5)
  const steps = stepsFor('valuation')
  // The next step from today; a call or WhatsApp already in the past is skipped, except today's.
  const idx = steps.findIndex((s) => s.day >= days)
  if (idx < 0) return false
  const when = nextDue(startedAt, idx, at, 'valuation')!
  await db.update(enquiries).set({ followupPlan: 'valuation', followupStep: idx, followupStartedAt: startedAt, followupNextAt: when, followupNote: null }).where(eq(enquiries.id, id))
  return true
}

/** After a valuation visit where they're thinking it over: thanks today, then a call, an email and a call. */
export async function startAfterVisit(id: string, from = new Date()) {
  const startedAt = from.toISOString()
  await db.update(enquiries).set({ followupState: 'active', followupPlan: 'after-visit', followupStep: 0, followupStartedAt: startedAt, followupNextAt: startedAt, followupNote: null }).where(eq(enquiries.id, id))
  await logAction({ agent: 'valuation', enquiryId: id, kind: 'plan', status: 'done', title: 'After-visit follow-ups started', detail: 'Thank-you email today, a call on day 2, an email on day 5 and a call on day 10.' })
}

/** Staff did the due call or WhatsApp: that step's done. */
export async function completeStaffStep(enquiryId: string, by: string, how: 'whatsapp' | 'call', detail?: string) {
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId) })
  if (!e || e.followupState !== 'active' || stepOf(e)?.channel !== how || !e.followupNextAt || e.followupNextAt > new Date(Date.now() + 12 * 3600_000).toISOString()) return
  await log(e, 'done', detail ?? (how === 'whatsapp' ? 'Sent on WhatsApp' : 'Called'), by)
  await advance(e)
}
/** Staff sent the due WhatsApp from the portal: that step's done. */
export const completeWhatsAppStep = (enquiryId: string, by: string) => completeStaffStep(enquiryId, by, 'whatsapp')

/** Whether the lead's report is finalised from a recent OnTheMarket guide, with its link and figures if so. */
async function reportFor(enquiryId: string, base: string): Promise<{ url: string; guide: { asking: number; low: number | null; high: number | null } } | null> {
  const [state, final, g] = await Promise.all([reportStates([enquiryId]).then((m) => m.get(enquiryId)!), reportFinal(enquiryId), reportGuide(enquiryId)])
  if (state.state !== 'final' || state.stale || !final || !g?.asking) return null
  return { url: `${base}/report/${await shareFor(enquiryId)}`, guide: { asking: g.asking, low: g.low, high: g.high } }
}

export type RunResult = { ran: boolean; enrolled?: number; sent?: number; held?: number; letters?: number; skipped?: number; stopped?: number; failed?: number; quiet?: string | null; error?: string }

/** Called every couple of minutes by the background job; does real work at most every 4 minutes. */
export async function runFollowups(opts: { force?: boolean; at?: Date } = {}): Promise<RunResult> {
  await ready()
  const cfg = await followupSettings()
  if (!cfg.on || !cfg.since) return { ran: false }
  const at = opts.at ?? new Date()
  const nowIso = at.toISOString()
  if (!opts.force) {
    const claim = await getClient().execute({
      sql: `INSERT INTO jobs (name, last_run_at) VALUES ('followups', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`,
      args: [nowIso, new Date(at.getTime() - 4 * 60_000).toISOString()],
    })
    if (claim.rowsAffected !== 1) return { ran: false }
  }
  const res: RunResult = { ran: true, enrolled: 0, sent: 0, held: 0, letters: 0, skipped: 0, stopped: 0, failed: 0, quiet: quietReason(at) }

  // 1. New leads since follow-ups were switched on, that nobody has heard back from. Valuations get the valuation plan.
  const fresh = await db.select().from(enquiries)
    .where(and(isNull(enquiries.followupState), gte(enquiries.createdAt, cfg.since), inArray(enquiries.status, ['new', 'contacted']))).limit(200)
  for (const f of fresh) {
    const plan = isValuation(f) ? 'valuation' : null
    await db.update(enquiries).set({ followupState: 'active', followupPlan: plan, followupStep: 0, followupStartedAt: f.createdAt, followupNextAt: dueAt(f.createdAt, stepsFor(plan)[0].day) })
      .where(eq(enquiries.id, f.id))
    res.enrolled!++
  }

  // 2. Anything that has stopped being a follow-up (they replied, booked, moved on, asked us to stop) stops now.
  const active = await rows(and(eq(enquiries.followupState, 'active'), lte(enquiries.followupNextAt, new Date(at.getTime() + 7 * 864e5).toISOString())), 400)
  for (const r of active) {
    const why = stopReason(stateOf(r), r.e.followupPlan)
    if (why) { await stop(r.e.id, why); res.stopped!++ }
  }

  const due = await rows(and(eq(enquiries.followupState, 'active'), lte(enquiries.followupNextAt, nowIso)), 300)

  // 3. Calls and WhatsApps (a person does them): skipped if they can't be done, done if a call was logged, missed if left too long.
  for (const r of due.filter((x) => isStaffStep(stepOf(x.e)))) {
    const step = stepOf(r.e)!
    const skip = stepSkip(step, stateOf(r), at)
    if (skip) { await log(r.e, 'skipped', skip); await advance(r.e, at); res.skipped!++; continue }
    if (step.channel === 'call' && r.e.contactId) {
      const since = new Date(Date.parse(r.e.followupNextAt!) - 12 * 3600e3).toISOString()
      const called = await db.select({ id: calls.id, by: calls.createdBy }).from(calls).where(and(eq(calls.contactId, r.e.contactId), gte(calls.createdAt, since))).limit(1)
      if (called.length) { await log(r.e, 'done', 'Call logged', called[0].by); await advance(r.e, at); continue }
    }
    if (Date.parse(r.e.followupNextAt!) < at.getTime() - WHATSAPP_GRACE_DAYS * 864e5) {
      await log(r.e, 'missed', `Not done within ${WHATSAPP_GRACE_DAYS} days`); await advance(r.e, at); res.skipped!++
    }
  }

  // 4. Letters and emails that are due, outside quiet times only.
  if (res.quiet) return res
  const base = await knownBase()

  for (const r of due.filter((x) => stepOf(x.e)?.channel === 'letter')) {
    const ready = await reportFor(r.e.id, base)
    if (!ready && Date.parse(r.e.followupNextAt!) > at.getTime() - REPORT_WAIT_DAYS * 864e5) { await later(r.e, at, 3); continue }
    const q = ready ? await queueFollowupLetter(r.e.id) : { ok: false, why: 'no finalised OnTheMarket guide in time' }
    if (q.ok) { await log(r.e, 'done', 'In today’s follow-up letters to print'); res.letters!++ } else { await log(r.e, 'skipped', `No letter: ${q.why}`.slice(0, 300)); res.skipped!++ }
    await advance(r.e, at)
  }

  const box = await mailboxStatus().catch(() => null)
  if (!box?.hasPassword) return { ...res, error: 'The office mailbox isn’t connected.' }
  if (mailPaused(at.getTime())) return { ...res, error: 'The mail server couldn’t be reached: emails wait 30 minutes before trying again.' }
  // A few at a time: each one is sense-checked (with a second read by Claude) before it goes.
  let emailed = 0
  for (const r of due.filter((x) => stepOf(x.e)?.channel === 'email')) {
    if (emailed >= 8) break
    // Claim the lead for 30 minutes, so a slow run and the next one can never both email it.
    const claim = await db.update(enquiries).set({ followupNextAt: new Date(at.getTime() + 30 * 60e3).toISOString() })
      .where(and(eq(enquiries.id, r.e.id), eq(enquiries.followupNextAt, r.e.followupNextAt!), eq(enquiries.followupStep, r.e.followupStep)))
    if (!claim.rowsAffected) continue
    emailed++
    const step = stepOf(r.e)!
    const l = stateOf(r)
    const skip = stepSkip(step, l, at)
    if (skip) { await log(r.e, 'skipped', skip); await advance(r.e, at); res.skipped!++; continue }
    const track = trackOf(r)
    const valuation = track === 'sales-valuation' || track === 'lettings-valuation'
    const report = valuation ? await reportFor(r.e.id, base) : null
    if (step.report && !report) {
      // The report goes only with a finalised OnTheMarket guide: wait for it (staff are being prompted), then skip.
      if (Date.parse(r.e.followupNextAt!) > at.getTime() - REPORT_WAIT_DAYS * 864e5) { await db.update(enquiries).set({ followupNextAt: r.e.followupNextAt }).where(eq(enquiries.id, r.e.id)); await later(r.e, at, 3); emailed--; continue }
      await log(r.e, 'skipped', 'No finalised OnTheMarket guide in time, so no report'); await advance(r.e, at); res.skipped!++; continue
    }
    const { address, postcode } = addressOf(r)
    const first = (r.e.name.trim().split(/\s+/)[0] ?? '').replace(/^(mr|mrs|ms|miss|dr)\.?$/i, '')
    const m = followupEmail(track, step.key, { first, me: r.ownerName ?? '', address, postcode, base, unsubscribeUrl: r.c ? unsubscribeUrl(base, r.c.id) : null, reportUrl: report?.url ?? null, guide: report?.guide ?? null })
    if (!m) { await advance(r.e, at); continue }
    const headers: Record<string, string> = r.c ? { 'List-Unsubscribe': `<${oneClickUrl(base, r.c.id)}>, <mailto:${box.user}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'X-Followup': step.key } : { 'X-Followup': step.key }
    const agent = valuation ? 'valuation' : 'followup'
    const chase = r.e.followupPlan !== 'after-visit' && !['em14', 'em30'].includes(step.key)
    const purpose = `${planLabel(r.e.followupPlan)}, day ${step.day} (“${step.label.replace(/^Email: /, '')}”) for a ${track.replace('-', ' ')} enquiry${r.e.followupPlan === 'after-visit' ? ' after our valuation visit, while they think it over' : ' that hasn’t replied'}`
    const sc = await senseCheck({ agent, enquiryId: r.e.id, channel: 'email', to: l.email!, subject: m.subject, text: m.text, purpose, template: true, chase })
    if (sc.verdict === 'block') {
      await logAction({ agent, enquiryId: r.e.id, kind: 'email', status: 'blocked', title: `Didn’t send “${m.subject}” to ${r.e.name}`, detail: `Blocked: ${sc.summary}.`, checks: sc.checks })
      await log(r.e, 'skipped', `Sense-check: ${sc.summary}`.slice(0, 300)); await advance(r.e, at); res.skipped!++; continue
    }
    if (sc.verdict === 'hold') {
      await holdForApproval({ agent, enquiryId: r.e.id, title: `“${m.subject}” to ${r.e.name}`, summary: sc.summary, checks: sc.checks, payload: { channel: 'email', to: l.email!, subject: m.subject, text: m.text, html: m.html, headers, purpose, template: true, chase, followupStep: step.key } })
      await log(r.e, 'held', `Waiting for approval: ${sc.summary}`.slice(0, 300)); await advance(r.e, at); res.held!++; continue
    }
    const sent = await sendFromMailbox({ to: [l.email!], subject: m.subject, text: m.text, html: m.html, by: null, headers })
    if (!sent.ok) {
      res.failed!++
      // The mailbox itself is the problem: stop this run and try again next time.
      if (noteMailError(sent.error)) {
        // Put it back as due, so it goes next time.
        await db.update(enquiries).set({ followupNextAt: r.e.followupNextAt }).where(eq(enquiries.id, r.e.id))
        return { ...res, error: sent.error }
      }
      await log(r.e, 'failed', sent.error.slice(0, 300)); await advance(r.e, at); continue
    }
    // Kept in the enquiry's conversation, so their reply joins it (and stops the follow-ups).
    await recordOutgoing(r.e.id, { messageId: sent.messageId, subject: m.subject, body: m.text, by: null, via: 'followup' })
    await log(r.e, 'sent', m.subject)
    await logAction({ agent, enquiryId: r.e.id, kind: 'email', status: 'done', title: `Sent “${m.subject}” to ${r.e.name}`, detail: `${address ?? r.e.name}: ${sc.summary}.`, checks: sc.checks })
    await advance(r.e, at)
    res.sent!++
  }
  return res
}

/** For the Follow-ups page, the Agents page and the lead card. */
export async function followupBoard(at = new Date()) {
  await ready()
  const nowIso = at.toISOString()
  const [due, upcoming, recent, waiting] = await Promise.all([
    rows(and(eq(enquiries.followupState, 'active'), lte(enquiries.followupNextAt, nowIso)), 300),
    rows(and(eq(enquiries.followupState, 'active'), sql`${enquiries.followupNextAt} > ${nowIso}`), 60),
    db.select({ l: followupLog, name: enquiries.name, plan: enquiries.followupPlan, by: admins.name }).from(followupLog).innerJoin(enquiries, eq(followupLog.enquiryId, enquiries.id)).leftJoin(admins, eq(followupLog.createdBy, admins.id))
      .orderBy(desc(followupLog.createdAt)).limit(40),
    // Speed matters most: new leads nobody has contacted yet, oldest first.
    rows(and(eq(enquiries.status, 'new'), gte(enquiries.createdAt, new Date(at.getTime() - 14 * 864e5).toISOString())), 60),
  ])
  return {
    waDue: due.filter((r) => stepOf(r.e)?.channel === 'whatsapp'),
    callsDue: due.filter((r) => stepOf(r.e)?.channel === 'call'),
    upcoming, recent, waiting: waiting.sort((a, b) => (a.e.createdAt < b.e.createdAt ? -1 : 1)),
  }
}
export type BoardRow = Row
export type LeadRow = Row
