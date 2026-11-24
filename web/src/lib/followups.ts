import 'server-only'
// Runs the follow-ups (see lib/followup-rules): puts new leads on the sequence, sends the emails that are due from
// the office mailbox (never on Sundays or outside 9am to 9pm), and keeps the WhatsApps that are due on the
// Follow-ups page for staff to send. Stops as soon as the person replies or the lead moves on.

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { admins, contacts, enquiries, followupLog, properties, settings, type Contact, type Enquiry } from '@/db/schema'
import { enquirySide, isValuation } from './enquiry-labels'
import { isBoilerplate } from './email-import'
import { detailLines } from './enquiry-workspace'
import { recordOutgoing } from './enquiry-thread'
import { toE164 } from './lead-rules'
import { mailboxStatus, sendFromMailbox } from './mailbox'
import { displayAddressFor } from './properties'
import { knownBase, oneClickUrl, unsubscribeUrl } from './property-email-data'
import { EMAIL_STEPS, STEPS, WHATSAPP_GRACE_DAYS, WHATSAPP_STEPS, dueAt, followupEmail, nextDue, stepSkip, stopReason, type LeadState, type Track } from './followup-rules'
import { logAction } from './agents'
import { holdForApproval } from './agent-queue'
import { senseCheck } from './sense-check'
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
  }
}

async function rows(where: ReturnType<typeof and>, limit: number): Promise<Row[]> {
  const r = await db.select({ e: enquiries, c: contacts, channel: properties.channel, ownerName: admins.name, p: properties }).from(enquiries)
    .leftJoin(contacts, eq(enquiries.contactId, contacts.id)).leftJoin(properties, eq(enquiries.propertyId, properties.id)).leftJoin(admins, eq(enquiries.ownerId, admins.id))
    .where(where).orderBy(asc(enquiries.followupNextAt)).limit(limit)
  return r
}

async function log(enquiryId: string, stepIndex: number, status: string, detail: string | null, by: string | null = 'system') {
  const s = STEPS[stepIndex]
  await db.insert(followupLog).values({ id: uid(), enquiryId, step: s?.key ?? String(stepIndex), channel: s?.channel ?? 'email', status, detail, createdBy: by, createdAt: now() })
}

/** Moves a lead on to its next step (or finishes the sequence). */
export async function advance(e: Pick<Enquiry, 'id' | 'followupStep' | 'followupStartedAt' | 'createdAt'>, at = new Date()) {
  const next = e.followupStep + 1
  const when = nextDue(e.followupStartedAt ?? e.createdAt, next, at)
  await db.update(enquiries).set(when ? { followupStep: next, followupNextAt: when } : { followupStep: next, followupState: 'done', followupNextAt: null, followupNote: 'All follow-ups done' }).where(eq(enquiries.id, e.id))
}

async function stop(id: string, why: string) {
  await db.update(enquiries).set({ followupState: 'stopped', followupNextAt: null, followupNote: why }).where(eq(enquiries.id, id))
}

/** Puts a lead on the sequence from now (staff starting it by hand, e.g. for an older enquiry). */
export async function startFollowups(id: string, from = new Date()) {
  const startedAt = from.toISOString()
  await db.update(enquiries).set({ followupState: 'active', followupStep: 0, followupStartedAt: startedAt, followupNextAt: dueAt(startedAt, STEPS[0].day), followupNote: null }).where(eq(enquiries.id, id))
}

/** Staff sent the due WhatsApp from the portal: that step's done. */
export async function completeWhatsAppStep(enquiryId: string, by: string) {
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId) })
  if (!e || e.followupState !== 'active' || STEPS[e.followupStep]?.channel !== 'whatsapp' || !e.followupNextAt || e.followupNextAt > new Date(Date.now() + 12 * 3600_000).toISOString()) return
  await log(e.id, e.followupStep, 'done', 'Sent on WhatsApp', by)
  await advance(e)
}

export type RunResult = { ran: boolean; enrolled?: number; sent?: number; held?: number; skipped?: number; stopped?: number; failed?: number; quiet?: string | null; error?: string }

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
  const res: RunResult = { ran: true, enrolled: 0, sent: 0, skipped: 0, stopped: 0, failed: 0, quiet: quietReason(at) }

  // 1. New leads since follow-ups were switched on, that nobody has heard back from.
  const fresh = await db.select({ id: enquiries.id, createdAt: enquiries.createdAt }).from(enquiries)
    .where(and(isNull(enquiries.followupState), gte(enquiries.createdAt, cfg.since), inArray(enquiries.status, ['new', 'contacted']))).limit(200)
  for (const f of fresh) {
    await db.update(enquiries).set({ followupState: 'active', followupStep: 0, followupStartedAt: f.createdAt, followupNextAt: dueAt(f.createdAt, STEPS[0].day) })
      .where(eq(enquiries.id, f.id))
    res.enrolled!++
  }

  // 2. Anything that has stopped being a follow-up (they replied, moved on, asked us to stop) stops now.
  const active = await rows(and(eq(enquiries.followupState, 'active'), lte(enquiries.followupNextAt, new Date(at.getTime() + 7 * 864e5).toISOString())), 400)
  for (const r of active) {
    const why = stopReason(stateOf(r))
    if (why) { await stop(r.e.id, why); res.stopped!++ }
  }

  // 3. WhatsApps nobody sent in time are skipped, or skipped now if they can't be sent.
  const waDue = await rows(and(eq(enquiries.followupState, 'active'), inArray(enquiries.followupStep, WHATSAPP_STEPS), lte(enquiries.followupNextAt, nowIso)), 200)
  for (const r of waDue) {
    const skip = stepSkip(STEPS[r.e.followupStep], stateOf(r), at)
    const late = Date.parse(r.e.followupNextAt!) < at.getTime() - WHATSAPP_GRACE_DAYS * 864e5
    if (skip || late) { await log(r.e.id, r.e.followupStep, skip ? 'skipped' : 'missed', skip ?? `Not sent within ${WHATSAPP_GRACE_DAYS} days`); await advance(r.e, at); res.skipped!++ }
  }

  // 4. Emails that are due, outside quiet times only.
  if (res.quiet) return res
  const box = await mailboxStatus().catch(() => null)
  if (!box?.hasPassword) return { ...res, error: 'The office mailbox isn’t connected.' }
  const base = await knownBase()
  // A few at a time: each one is sense-checked (with a second read by Claude) before it goes.
  const emDue = await rows(and(eq(enquiries.followupState, 'active'), inArray(enquiries.followupStep, EMAIL_STEPS), lte(enquiries.followupNextAt, nowIso)), 8)
  for (const r of emDue) {
    // Claim the lead for 30 minutes, so a slow run and the next one can never both email it.
    const claim = await db.update(enquiries).set({ followupNextAt: new Date(at.getTime() + 30 * 60e3).toISOString() })
      .where(and(eq(enquiries.id, r.e.id), eq(enquiries.followupNextAt, r.e.followupNextAt!), eq(enquiries.followupStep, r.e.followupStep)))
    if (!claim.rowsAffected) continue
    const step = STEPS[r.e.followupStep]
    const l = stateOf(r)
    const skip = stepSkip(step, l, at)
    if (skip) { await log(r.e.id, r.e.followupStep, 'skipped', skip); await advance(r.e, at); res.skipped!++; continue }
    const { address, postcode } = addressOf(r)
    const first = (r.e.name.trim().split(/\s+/)[0] ?? '').replace(/^(mr|mrs|ms|miss|dr)\.?$/i, '')
    const track = trackOf(r)
    const m = followupEmail(track, step.key, { first, me: r.ownerName ?? '', address, postcode, base, unsubscribeUrl: r.c ? unsubscribeUrl(base, r.c.id) : null })
    if (!m) { await advance(r.e, at); continue }
    const headers: Record<string, string> = r.c ? { 'List-Unsubscribe': `<${oneClickUrl(base, r.c.id)}>, <mailto:${box.user}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'X-Followup': step.key } : { 'X-Followup': step.key }
    const valuation = track === 'sales-valuation' || track === 'lettings-valuation'
    const agent = valuation ? 'valuation' : 'followup'
    const purpose = `Day ${step.day} follow-up (“${step.label.replace(/^Email: /, '')}”) to a ${track.replace('-', ' ')} enquiry that hasn’t replied`
    const sc = await senseCheck({ agent, enquiryId: r.e.id, channel: 'email', to: l.email!, subject: m.subject, text: m.text, purpose, template: true, chase: step.key !== 'em14' })
    const who = address ?? r.e.name
    if (sc.verdict === 'block') {
      await logAction({ agent, enquiryId: r.e.id, kind: 'email', status: 'blocked', title: `Didn’t send “${m.subject}” to ${r.e.name}`, detail: `Blocked: ${sc.summary}.`, checks: sc.checks })
      await log(r.e.id, r.e.followupStep, 'skipped', `Sense-check: ${sc.summary}`.slice(0, 300)); await advance(r.e, at); res.skipped!++; continue
    }
    if (sc.verdict === 'hold') {
      await holdForApproval({ agent, enquiryId: r.e.id, title: `“${m.subject}” to ${r.e.name}`, summary: sc.summary, checks: sc.checks, payload: { channel: 'email', to: l.email!, subject: m.subject, text: m.text, html: m.html, headers, purpose, template: true, chase: step.key !== 'em14', followupStep: step.key } })
      await log(r.e.id, r.e.followupStep, 'held', `Waiting for approval: ${sc.summary}`.slice(0, 300)); await advance(r.e, at); res.held = (res.held ?? 0) + 1; continue
    }
    const sent = await sendFromMailbox({ to: [l.email!], subject: m.subject, text: m.text, html: m.html, by: null, headers })
    if (!sent.ok) {
      res.failed!++
      // The mailbox itself is the problem: stop this run and try again next time.
      if (/password|connect the mailbox|couldn’t reach|ECONN|ETIMEDOUT/i.test(sent.error)) {
        // Put it back as due, so it goes next time.
        await db.update(enquiries).set({ followupNextAt: r.e.followupNextAt }).where(eq(enquiries.id, r.e.id))
        return { ...res, error: sent.error }
      }
      await log(r.e.id, r.e.followupStep, 'failed', sent.error.slice(0, 300)); await advance(r.e, at); continue
    }
    // Kept in the enquiry's conversation, so their reply joins it (and stops the follow-ups).
    await recordOutgoing(r.e.id, { messageId: sent.messageId, subject: m.subject, body: m.text, by: null, via: 'followup' })
    await log(r.e.id, r.e.followupStep, 'sent', m.subject)
    await logAction({ agent, enquiryId: r.e.id, kind: 'email', status: 'done', title: `Sent “${m.subject}” to ${r.e.name}`, detail: `${who}: ${sc.summary}.`, checks: sc.checks })
    await advance(r.e, at)
    res.sent!++
  }
  return res
}

/** For the Follow-ups page and the lead card. */
export async function followupBoard(at = new Date()) {
  await ready()
  const nowIso = at.toISOString()
  const [waDue, upcoming, recent, waiting] = await Promise.all([
    rows(and(eq(enquiries.followupState, 'active'), inArray(enquiries.followupStep, WHATSAPP_STEPS), lte(enquiries.followupNextAt, nowIso)), 100),
    rows(and(eq(enquiries.followupState, 'active'), sql`${enquiries.followupNextAt} > ${nowIso}`), 60),
    db.select({ l: followupLog, name: enquiries.name, by: admins.name }).from(followupLog).innerJoin(enquiries, eq(followupLog.enquiryId, enquiries.id)).leftJoin(admins, eq(followupLog.createdBy, admins.id))
      .orderBy(desc(followupLog.createdAt)).limit(40),
    // Speed matters most: new leads nobody has contacted yet, oldest first.
    rows(and(eq(enquiries.status, 'new'), gte(enquiries.createdAt, new Date(at.getTime() - 14 * 864e5).toISOString())), 60),
  ])
  return { waDue, upcoming, recent, waiting: waiting.sort((a, b) => (a.e.createdAt < b.e.createdAt ? -1 : 1)) }
}
export type BoardRow = Row
export type LeadRow = Row
