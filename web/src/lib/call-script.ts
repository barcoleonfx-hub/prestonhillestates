import 'server-only'
import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins, appointments, bookletShares, callSessions, contacts, enquiries } from '@/db/schema'
import { buildScript, pickSlots, toldFromForm, type Script, type ScriptFacts, type ScriptKind } from './call-script-rules'
import { detailLines, homeOf } from './enquiry-workspace'
import { isValuation, sortEnquiry } from './enquiry-labels'
import { leadHistory } from './lead-history'
import { getProperty, displayAddressFor, priceLabel } from './properties'
import { reportGuide, reportStates } from './report-guide'
import { listBetween } from './appointments'
import { addDays, fmtWhen, londonToIso, todayLondon } from './time'
import { now, uid } from './util'

// The personalised call script for one lead (the rules are in call-script-rules). A call in progress is saved as
// staff type, so nothing's lost if the page reloads, and the answers carry over to the next call.

const firstOf = (name: string) => { const w = name.trim().split(/\s+/)[0] ?? ''; return /^(mr|mrs|ms|miss|dr)\.?$/i.test(w) ? '' : w }
const parse = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d } catch { return d } }
const hm = (t: string) => { const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}` }
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

export type Session = { id: string; adminId: string; by: string; answers: Record<string, string>; ticks: string[]; notes: string; outcome: string | null; detail: string | null; startedAt: string; finishedAt: string | null }

/** The two free times to offer, from this person's diary. */
async function freeSlots(staffId: string): Promise<ScriptFacts['slots']> {
  const today = todayLondon()
  const busy = (await listBetween(londonToIso(addDays(today, 1), '00:00')!, londonToIso(addDays(today, 12), '00:00')!, { staffId }))
    .filter((a) => a.status === 'scheduled').map((a) => [Date.parse(a.startsAt), Date.parse(a.startsAt) + a.durationMin * 60e3] as const)
  // Free from half an hour before (to get there) to an hour after.
  const free = (date: string, time: string) => { const s = Date.parse(londonToIso(date, time)!); return !busy.some(([a, b]) => a < s + 60 * 60e3 && b > s - 30 * 60e3) }
  return pickSlots(free, today, (d) => new Date(`${d}T12:00:00Z`).getUTCDay(), (d, t) => `${dayLabel(d)} at ${hm(t)}`)
}

function shape(r: typeof callSessions.$inferSelect, names: Map<string, string>): Session {
  return { id: r.id, adminId: r.adminId, by: names.get(r.adminId) ?? 'Staff', answers: parse(r.answers, {}), ticks: parse(r.ticks, []), notes: r.notes, outcome: r.outcome, detail: r.detail, startedAt: r.startedAt, finishedAt: r.finishedAt }
}

export type CallScriptData = { facts: ScriptFacts; script: Script; open: Session | null; earlier: Session[]; e164: string | null }

/** Everything the call script panel needs for this lead and this member of staff. */
export async function callScriptFor(enquiryId: string, me: { id: string; name: string }): Promise<CallScriptData | null> {
  await ready()
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId) })
  if (!e) return null
  const [c, p, history, states, g, share, booked, sessions, slots] = await Promise.all([
    e.contactId ? db.query.contacts.findFirst({ where: eq(contacts.id, e.contactId) }) : Promise.resolve(undefined),
    e.propertyId ? getProperty(e.propertyId).catch(() => null) : Promise.resolve(null),
    leadHistory(e.id).catch(() => ({ touches: [], inbound: [] })),
    reportStates([e.id]).catch(() => null),
    reportGuide(e.id).catch(() => null),
    db.query.bookletShares.findFirst({ where: eq(bookletShares.bookletId, e.id) }),
    db.select().from(appointments).where(and(eq(appointments.enquiryId, e.id), eq(appointments.status, 'scheduled'), gt(appointments.startsAt, now()))).orderBy(asc(appointments.startsAt)).limit(1),
    db.select().from(callSessions).where(eq(callSessions.enquiryId, e.id)).orderBy(desc(callSessions.startedAt)).limit(20),
    freeSlots(me.id).catch(() => []),
  ])
  const valuation = isValuation(e)
  const side = sortEnquiry(e, p?.channel, c?.roles).side
  const kind: ScriptKind = valuation ? 'valuation' : side === 'lettings' ? 'tenant' : 'buyer'
  const home = homeOf(e, valuation)
  const st = states?.get(e.id)
  const final = st?.state === 'final' && !st.stale && !!st.asking
  const staff = sessions.length ? await db.select({ id: admins.id, name: admins.name }).from(admins).where(inArray(admins.id, [...new Set(sessions.map((s) => s.adminId))])) : []
  const names = new Map(staff.map((s) => [s.id, s.name]))
  const all = sessions.map((s) => shape(s, names))
  // What they've told us: their form first, then anything said on an earlier call (newest wins).
  const told: Record<string, string> = toldFromForm(detailLines(e.message))
  for (const s of [...all].filter((x) => x.finishedAt).reverse()) for (const [k, v] of Object.entries(s.answers)) if (v.trim()) told[k] = `Said on ${new Date(s.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })}: ${v.trim()}`.slice(0, 240)
  const facts: ScriptFacts = {
    kind, letting: valuation && side === 'lettings',
    first: firstOf(e.name), me: firstOf(me.name),
    address: valuation ? [home.address, home.postcode].filter(Boolean).join(', ') || null : null,
    property: p ? displayAddressFor(p) : !valuation ? home.address : null,
    price: p ? priceLabel(p) : null,
    sent: {
      email: history.touches.some((t) => t.channel === 'email'),
      whatsapp: history.touches.some((t) => t.channel === 'whatsapp'),
      letter: history.touches.some((t) => t.channel === 'letter'),
      calls: all.filter((s) => s.finishedAt).length,
    },
    report: { state: final ? 'final' : st?.state === 'none' || !st ? 'none' : 'draft', asking: final ? st!.asking : null, low: final ? g?.low ?? null : null, high: final ? g?.high ?? null : null, views: final ? share?.views ?? 0 : 0 },
    told, slots, booked: booked[0] ? fmtWhen(booked[0].startsAt) : null,
  }
  return {
    facts, script: buildScript(facts),
    open: all.find((s) => !s.finishedAt && s.adminId === me.id) ?? null,
    earlier: all.filter((s) => s.finishedAt),
    e164: c?.phoneE164 ?? null,
  }
}

/** Saves the call in progress (one per person per lead), creating it on the first keystroke. */
export async function saveCallSession(enquiryId: string, adminId: string, patch: { answers: Record<string, string>; ticks: string[]; notes: string }): Promise<string> {
  await ready()
  const clean = {
    answers: JSON.stringify(Object.fromEntries(Object.entries(patch.answers ?? {}).filter(([k, v]) => /^[a-z]{1,20}$/.test(k) && typeof v === 'string').slice(0, 40).map(([k, v]) => [k, v.slice(0, 1000)]))),
    ticks: JSON.stringify((patch.ticks ?? []).filter((t) => /^[a-z]{1,20}$/.test(t)).slice(0, 30)),
    notes: String(patch.notes ?? '').slice(0, 4000),
  }
  const open = await db.query.callSessions.findFirst({ where: and(eq(callSessions.enquiryId, enquiryId), eq(callSessions.adminId, adminId), isNull(callSessions.finishedAt)) })
  if (open) { await db.update(callSessions).set({ ...clean, updatedAt: now() }).where(eq(callSessions.id, open.id)); return open.id }
  const id = uid()
  await db.insert(callSessions).values({ id, enquiryId, adminId, ...clean, startedAt: now(), updatedAt: now() })
  return id
}

/** Marks the call in progress finished, with how it ended. */
export async function closeCallSession(id: string, outcome: string, detail: string | null, callId: string | null) {
  await db.update(callSessions).set({ outcome, detail, callId, finishedAt: now(), updatedAt: now() }).where(eq(callSessions.id, id))
}
