import 'server-only'
import { and, eq, gte, inArray, isNull } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { enquiries, notifications, reportGuides } from '@/db/schema'
import { todaysLetters } from './agents'
import { listBetween } from './appointments'
import { bookletInput } from './booklet-data'
import { callerBrief, callerBriefs } from './caller-brief'
import { isValuation } from './enquiry-labels'
import { followupBoard } from './followups'
import { draftReplies, readyDrafts } from './night-drafts'
import { checkPromises, findPromises, promisesDue } from './promises'
import { salesNear } from './sold-prices'
import { briefingJunk, briefingPeople } from './staff-briefing'
import { addDays, fmtTime, londonToIso, todayLondon } from './time'
import { now, uid } from './util'

// The night shift (1am to 6am London, while nobody's working): sorts the day's emails, reads staff's sent emails for
// promises, drafts replies to everything waiting, builds the reports for new valuation requests, and leaves a
// "morning pack" ready for 9am. Nothing is ever sent to a client at night.

const claim = async (key: string) => (await getClient().execute({ sql: `INSERT OR IGNORE INTO jobs (name, last_run_at) VALUES (?, ?)`, args: [key, now()] })).rowsAffected === 1
const isDone = async (key: string) => !!(await getClient().execute({ sql: `SELECT 1 FROM jobs WHERE name = ?`, args: [key] })).rows.length

/** One step per call (the background job calls every couple of minutes), so the work is spread across the night. */
export async function runNightShift(at = new Date()): Promise<{ step: string | null }> {
  const hm = at.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  if (hm < '01:00' || hm >= '06:00') return { step: null }
  await ready()
  const today = todayLondon()
  const day = addDays(today, -1)
  const people = await briefingPeople()

  if (await claim(`night-triage-${today}`)) { await briefingJunk(today); return { step: 'triage' } }
  if (await claim(`night-promises-${today}`)) {
    await findPromises(londonToIso(day, '00:00')!, londonToIso(today, '00:00')!, people)
    await checkPromises()
    return { step: 'promises' }
  }
  if (!(await isDone(`night-drafts-done-${today}`))) {
    // A batch at a time; one batch every few minutes at most.
    const lock = await getClient().execute({ sql: `INSERT INTO jobs (name, last_run_at) VALUES ('night-drafts', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`, args: [now(), new Date(Date.now() - 3 * 60e3).toISOString()] })
    if (lock.rowsAffected !== 1) return { step: null }
    const r = await draftReplies(people, 6)
    if (r.left === 0) await claim(`night-drafts-done-${today}`)
    return { step: 'drafts' }
  }
  if (await claim(`night-reports-${today}`)) { await prebuildReports(); return { step: 'reports' } }
  if (hm >= '05:00' && await claim(`night-pack-${today}`)) {
    const p = await morningPack()
    await db.insert(notifications).values({ id: uid(), kind: 'pack', appointmentId: null, enquiryId: null, title: 'Your morning pack is ready', body: [`${p.drafts.length} repl${p.drafts.length === 1 ? 'y' : 'ies'} drafted`, `${p.appointments.length} appointment${p.appointments.length === 1 ? '' : 's'} today`, `${p.promises.length} promise${p.promises.length === 1 ? '' : 's'} due`, `${p.calls.length} call${p.calls.length === 1 ? '' : 's'} to make`].join(', ') + '.', createdBy: null, createdAt: now() })
    return { step: 'pack' }
  }
  return { step: null }
}

/** New valuation requests (last 3 days) without a guide yet: the slow parts of their report done overnight. */
async function prebuildReports(): Promise<number> {
  const since = new Date(Date.now() - 3 * 864e5).toISOString()
  const rows = await db.select({ e: enquiries }).from(enquiries).leftJoin(reportGuides, eq(reportGuides.bookletId, enquiries.id))
    .where(and(gte(enquiries.createdAt, since), isNull(reportGuides.bookletId), inArray(enquiries.status, ['new', 'contacted', 'engaged']))).limit(30)
  let n = 0
  for (const { e } of rows.filter((r) => isValuation(r.e)).slice(0, 6)) {
    try { await bookletInput(e.id, { name: 'The team' }); n++ } catch (err) { console.error('night shift: report', e.id, err) }
  }
  return n
}

export type PackAppointment = { id: string; time: string; who: string; kind: string; where: string; staff: string; brief: string[] }

/** Everything for the morning: drafts, today's appointments with a brief each, promises due, calls, letters. */
export async function morningPack() {
  await ready()
  const today = todayLondon()
  const [drafts, appts, promises, board, letters] = await Promise.all([
    readyDrafts(), listBetween(londonToIso(today, '00:00')!, londonToIso(addDays(today, 1), '00:00')!), promisesDue(today), followupBoard(), todaysLetters(),
  ])
  const appointments: PackAppointment[] = await Promise.all(appts.filter((a) => a.status === 'scheduled').map(async (a) => {
    const brief: string[] = []
    if (a.enquiryId) brief.push(...(await callerBrief(a.enquiryId).catch(() => ({ lines: [] as string[] }))).lines)
    if (a.kind === 'valuation') {
      const pc = (a.location || a.address || '').toUpperCase().match(/([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/)
      const near = pc ? await salesNear(`${pc[1]} ${pc[2]}`, { limit: 4 }).catch(() => null) : null
      if (near?.recent.length) brief.push(`Recent sales nearby: ${near.recent.slice(0, 4).map((s) => `${s.street ?? s.postcode} £${s.price.toLocaleString('en-GB')} (${s.typeLabel.toLowerCase()}, ${s.soldOn.slice(0, 7)})`).join('; ')}`)
    }
    if (a.notes) brief.push(`Notes: ${a.notes.replace(/\s+/g, ' ').slice(0, 200)}`)
    return { id: a.id, time: fmtTime(a.startsAt), who: a.contactName ?? 'Client', kind: a.kind, where: a.location || 'Location to be confirmed', staff: a.staffName, brief }
  }))
  const callRows = [...board.callsDue, ...board.waiting].slice(0, 12)
  const briefs = await callerBriefs(callRows.map((r) => r.e.id))
  const calls = callRows.map((r) => ({ id: r.e.id, name: r.e.name, phone: r.e.phone, brief: briefs.get(r.e.id)?.lines ?? [], flags: briefs.get(r.e.id)?.flags ?? [] }))
  return { today, drafts, appointments, promises, calls, letters }
}
