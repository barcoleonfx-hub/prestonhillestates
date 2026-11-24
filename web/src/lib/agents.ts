import 'server-only'
import { and, desc, eq, gte, inArray, isNull, like, ne } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { agentActions, appointments, contacts, enquiries, letterBatches, notifications, postalLetters } from '@/db/schema'
import { isValuation } from './enquiry-labels'
import { letterLines, letterText } from './postal-letters'
import { postable, shortHome } from './postal-letter-rules'
import { reportStates, type ReportState } from './report-guide'
import { now, uid } from './util'

/** A check's name inside a sentence: “Not asked to stop” → “not asked to stop”, keeping OnTheMarket and Claude. */
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

// The agents' shared ground rules and log. The Valuation agent's first duty: the moment a valuation comes in, get the
// OnTheMarket guide uploaded (nothing is sent without it), and once the report is finalised, have the valuation letter
// in today's batch, ready to print and post the same day. Everything it does is sense-checked and logged.

export type Check = { name: string; ok: boolean; note?: string }
export type AgentName = 'valuation' | 'followup' | 'outreach' | 'marketing' | 'director'

export async function logAction(a: { agent: AgentName; enquiryId?: string | null; kind: string; status: 'done' | 'held' | 'blocked' | 'prompted'; title: string; detail?: string; checks?: Check[]; by?: string | null }): Promise<string> {
  const id = uid()
  await db.insert(agentActions).values({ id, agent: a.agent, enquiryId: a.enquiryId ?? null, kind: a.kind, status: a.status, title: a.title, detail: a.detail ?? null, checks: a.checks ? JSON.stringify(a.checks) : null, createdAt: now(), doneAt: a.status === 'done' ? now() : null, doneBy: a.by ?? null })
  return id
}

/** London's day of the week (0 Sunday) and hour. */
function londonNow(d = new Date()): { day: number; hour: number; date: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]))
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  return { day, hour: Number(parts.hour), date: d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) }
}
/** Office hours: Monday to Saturday, 9:00 to 18:00. */
export const workingHours = (d = new Date()) => { const t = londonNow(d); return t.day >= 1 && t.day <= 6 && t.hour >= 9 && t.hour < 18 }

const DAYS = 45
const HOUR = 3600e3

/** Valuation leads still being worked: the last 45 days, not won or lost, not asked to stop. */
async function liveValuations() {
  const since = new Date(Date.now() - DAYS * 864e5).toISOString()
  const rows = await db.select({ e: enquiries, c: contacts }).from(enquiries).leftJoin(contacts, eq(enquiries.contactId, contacts.id))
    .where(and(gte(enquiries.createdAt, since), inArray(enquiries.kind, ['valuation', 'email']))).orderBy(desc(enquiries.createdAt)).limit(400)
  return rows.filter(({ e, c }) => isValuation(e) && !c?.doNotContact && e.status !== 'won' && e.status !== 'lost' && e.outcome !== 'not_interested' && e.outcome !== 'do_not_call')
}

export type GuideTodo = { id: string; name: string; home: string; createdAt: string; report: ReportState }

/** Valuation leads whose report can't go out yet: no OnTheMarket guide, not finalised, or an old guide. */
export async function guidesToUpload(): Promise<GuideTodo[]> {
  await ready()
  // One per person: their newest valuation enquiry (the list is newest first).
  const seen = new Set<string>()
  const rows = (await liveValuations()).filter(({ e }) => { const k = e.contactId ?? `${e.name}|${e.postcode ?? ''}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
  const states = await reportStates(rows.map((r) => r.e.id))
  return rows.flatMap(({ e, c }) => {
    const report = states.get(e.id)!
    if (report.state === 'final' && !report.stale) return []
    const lines = letterLines(e, c)
    return [{ id: e.id, name: e.name, home: shortHome(lines) ?? e.postcode ?? 'their home', createdAt: e.createdAt, report }]
  })
}

let lastPrompt = 0
/**
 * Raises the "upload the OnTheMarket guide" pop-up for each new valuation lead at once, a reminder every 4 office
 * hours while it's still missing (three at most), and "finish the report" when a guide has sat unfinalised for 2
 * hours. Runs from the portal's alert poll, at most once a minute.
 */
export async function promptGuides(): Promise<number> {
  if (Date.now() - lastPrompt < 60e3) return 0
  lastPrompt = Date.now()
  await ready()
  const todo = await guidesToUpload()
  if (!todo.length) return 0
  const sent = await db.select({ enquiryId: notifications.enquiryId, title: notifications.title, at: notifications.createdAt }).from(notifications)
    .where(and(eq(notifications.kind, 'guide'), inArray(notifications.enquiryId, todo.map((t) => t.id))))
  const inHours = workingHours()
  let raised = 0
  for (const t of todo) {
    const mine = sent.filter((n) => n.enquiryId === t.id).sort((a, b) => (a.at < b.at ? 1 : -1))
    const last = mine[0] ? Date.parse(mine[0].at) : 0
    const fresh = Date.now() - Date.parse(t.createdAt) < 3 * 864e5
    let title: string | null = null, body = ''
    if (t.report.state === 'none') {
      if (!mine.length && fresh) { title = `Upload the OnTheMarket guide: ${t.home}`; body = `New valuation from ${t.name}. Download the Market Appraisal Guide from OnTheMarket, upload it and set the guide price. Their letter is prepared as soon as it’s done.` }
      else if (mine.length && mine.length < 3 && inHours && Date.now() - last > 4 * HOUR) { title = `Still waiting for the OnTheMarket guide: ${t.home}`; body = `${t.name}’s report and letter can’t go out without it.` }
    } else if (t.report.state === 'draft' && t.report.uploadedAt && Date.now() - Date.parse(t.report.uploadedAt) > 2 * HOUR && inHours && Date.now() - last > 4 * HOUR && mine.length < 4) {
      title = `Finish the report for ${t.home}`; body = 'The OnTheMarket guide is uploaded: set the guide price and press “Finalise the report”, and the letter is prepared.'
    }
    if (!title) continue
    await db.insert(notifications).values({ id: uid(), kind: 'guide', appointmentId: null, enquiryId: t.id, title, body, createdBy: null, createdAt: now() })
    await logAction({ agent: 'valuation', enquiryId: t.id, kind: 'guide-prompt', status: 'prompted', title })
    raised++
  }
  return raised
}

const todayIso = () => londonNow().date

/**
 * Once a report is finalised, its valuation letter goes into today's batch, ready to print and post the same day.
 * Sense-checked first: the report final and from a guide under 3 months old, the person not asked to stop, a full
 * postal address, no valuation already booked, and no letter for them already waiting or posted in the last 14 days.
 */
export async function queueSameDayLetter(enquiryId: string, by: { id: string; name: string }): Promise<{ ok: boolean; why?: string; batchId?: string }> {
  await ready()
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId) })
  if (!e || !isValuation(e)) return { ok: false, why: 'not a valuation enquiry' }
  const c = e.contactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, e.contactId) }) : null
  const report = (await reportStates([enquiryId])).get(enquiryId)!
  const lines = letterLines(e, c ?? null)
  const home = shortHome(lines) ?? e.postcode ?? 'their home'
  const [booked, recent] = await Promise.all([
    db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.enquiryId, enquiryId), eq(appointments.kind, 'valuation'), ne(appointments.status, 'cancelled'), gte(appointments.startsAt, new Date().toISOString()))).limit(1),
    db.select({ batchId: postalLetters.batchId, postedAt: postalLetters.postedAt, createdAt: postalLetters.createdAt }).from(postalLetters).where(eq(postalLetters.enquiryId, enquiryId)),
  ])
  const waiting = recent.some((r) => !r.postedAt)
  const postedLately = recent.some((r) => r.postedAt && Date.now() - Date.parse(r.postedAt) < 14 * 864e5)
  const checks: Check[] = [
    { name: 'Report finalised from the OnTheMarket guide', ok: report.state === 'final' },
    { name: 'Guide under 3 months old', ok: report.state !== 'none' && !report.stale, note: report.madeOn ?? undefined },
    { name: 'Not asked to stop', ok: !c?.doNotContact && e.outcome !== 'not_interested' && e.outcome !== 'do_not_call' },
    { name: 'Full postal address', ok: postable(lines), note: lines.join(', ') },
    { name: 'No valuation already booked', ok: !booked.length },
    { name: 'No letter already waiting or posted in the last 14 days', ok: !waiting && !postedLately },
  ]
  const failed = checks.filter((x) => !x.ok)
  if (failed.length) {
    const why = failed.map((x) => lc(x.name)).join('; ')
    await logAction({ agent: 'valuation', enquiryId, kind: 'letter', status: 'held', title: `No letter for ${home}`, detail: `Held: ${why}.`, checks, by: by.id })
    await db.insert(notifications).values({ id: uid(), kind: 'letter', appointmentId: null, enquiryId, title: `No letter for ${home}`, body: `Held by the sense-check: ${failed.map((x) => lc(x.name)).join('; ')}.`, createdBy: null, createdAt: now() })
    return { ok: false, why }
  }
  // Today's batch: one a day, a new one once the day's batch is marked as posted.
  const day = todayIso()
  const open = await db.select().from(letterBatches).where(and(like(letterBatches.id, `auto-${day}%`), isNull(letterBatches.postedAt))).orderBy(desc(letterBatches.createdAt)).limit(1)
  let batchId = open[0]?.id
  if (!batchId) {
    const n = (await db.select({ id: letterBatches.id }).from(letterBatches).where(like(letterBatches.id, `auto-${day}%`))).length
    batchId = n ? `auto-${day}-${n + 1}` : `auto-${day}`
    const text = await letterText()
    await db.insert(letterBatches).values({ id: batchId, sender: by.name, beforeText: text.before, afterText: text.after, createdBy: by.id, createdAt: now() })
  }
  await db.insert(postalLetters).values({ id: uid(), batchId, enquiryId, contactId: e.contactId, name: e.name, address: lines.join('\n'), home, createdAt: now() })
  await logAction({ agent: 'valuation', enquiryId, kind: 'letter', status: 'done', title: `Letter for ${home} added to today’s letters`, detail: `Guide price £${report.asking?.toLocaleString('en-GB')}.`, checks, by: by.id })
  await db.insert(notifications).values({ id: uid(), kind: 'letter', appointmentId: null, enquiryId, title: `Letter for ${home} ready to print`, body: 'It’s in today’s letters with their guide price and QR code: print it and post it today.', createdBy: null, createdAt: now() })
  return { ok: true, batchId }
}

/** Today's letter batches not yet posted (the agent's, and any staff printed today). */
export async function todaysLetters(): Promise<{ id: string; count: number; createdAt: string }[]> {
  await ready()
  const day = todayIso()
  const bs = await db.select().from(letterBatches).where(and(like(letterBatches.id, `auto-${day}%`), isNull(letterBatches.postedAt))).orderBy(desc(letterBatches.createdAt))
  if (!bs.length) return []
  const ls = await db.select({ batchId: postalLetters.batchId }).from(postalLetters).where(inArray(postalLetters.batchId, bs.map((b) => b.id)))
  return bs.map((b) => ({ id: b.id, count: ls.filter((l) => l.batchId === b.id).length, createdAt: b.createdAt }))
}

export type ActionRow = typeof agentActions.$inferSelect
export async function recentActions(limit = 40): Promise<ActionRow[]> {
  await ready()
  return db.select().from(agentActions).orderBy(desc(agentActions.createdAt)).limit(limit)
}
