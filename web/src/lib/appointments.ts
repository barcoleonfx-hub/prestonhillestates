import 'server-only'
import { after } from 'next/server'
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, notInArray, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins, appointments, notificationReads, notifications, properties, type Appointment, type Property } from '@/db/schema'
import { kindLabel, OUTCOME_GRACE_MIN } from './appointment-options'
import { icsEvent, portalUrl, sendMail, staffEmailHtml } from './mailer'
import { durationLabel, endIso, fmtDay, fmtTime, fmtWhen } from './time'
import { now, uid } from './util'

export type ApptRow = Appointment & {
  staffName: string
  staffEmail: string
  staffPhone: string | null
  propertyRef: string | null
  location: string
}

type PropAddr = Pick<Property, 'ref' | 'addressLine1' | 'street' | 'town' | 'postcode' | 'displayAddress'>

/** Full address for whoever is going (the public display address hides the house number). */
export function fullAddress(p: PropAddr | null | undefined, fallback: string | null): string {
  if (p) {
    const line = [p.addressLine1, p.street].filter(Boolean).join(' ')
    const full = [line, p.town, p.postcode].filter(Boolean).join(', ')
    return full || p.displayAddress || fallback || ''
  }
  return fallback || ''
}

const apptSelect = {
  a: appointments,
  staffName: admins.name,
  staffEmail: admins.email,
  staffPhone: admins.phone,
  p: {
    ref: properties.ref, addressLine1: properties.addressLine1, street: properties.street,
    town: properties.town, postcode: properties.postcode, displayAddress: properties.displayAddress,
  },
}

function shape(r: { a: Appointment; staffName: string; staffEmail: string; staffPhone: string | null; p: PropAddr | null }): ApptRow {
  const p = r.p && r.p.ref ? r.p : null
  return { ...r.a, staffName: r.staffName, staffEmail: r.staffEmail, staffPhone: r.staffPhone, propertyRef: p?.ref ?? null, location: fullAddress(p, r.a.address) }
}

function base() {
  return db.select(apptSelect).from(appointments)
    .innerJoin(admins, eq(appointments.staffId, admins.id))
    .leftJoin(properties, eq(appointments.propertyId, properties.id))
}

export async function getAppointment(id: string): Promise<ApptRow | null> {
  await ready()
  const [r] = await base().where(eq(appointments.id, id)).limit(1)
  return r ? shape(r) : null
}

/** Appointments starting within [fromIso, toIso). */
export async function listBetween(fromIso: string, toIso: string, opts: { staffId?: string; includeCancelled?: boolean } = {}) {
  await ready()
  const where = [gte(appointments.startsAt, fromIso), lt(appointments.startsAt, toIso)]
  if (opts.staffId) where.push(eq(appointments.staffId, opts.staffId))
  if (!opts.includeCancelled) where.push(ne(appointments.status, 'cancelled'))
  return (await base().where(and(...where)).orderBy(asc(appointments.startsAt))).map(shape)
}

const graceCutoff = () => new Date(Date.now() - OUTCOME_GRACE_MIN * 60000).toISOString()

/** Finished appointments still waiting for an outcome. Pass a staff id for just that person's. */
export async function needingOutcome(staffId?: string): Promise<ApptRow[]> {
  await ready()
  const where = [eq(appointments.status, 'scheduled'), lt(appointments.startsAt, new Date().toISOString())]
  if (staffId) where.push(eq(appointments.staffId, staffId))
  const rows = (await base().where(and(...where)).orderBy(asc(appointments.startsAt))).map(shape)
  const cutoff = graceCutoff()
  return rows.filter((r) => endIso(r.startsAt, r.durationMin) <= cutoff)
}

/** Other bookings for the same person that overlap the given slot. */
export async function clashesFor(staffId: string, startsAt: string, durationMin: number, excludeId?: string) {
  await ready()
  const start = new Date(startsAt).getTime()
  const end = start + durationMin * 60000
  const dayBefore = new Date(start - 24 * 3600000).toISOString()
  const where = [eq(appointments.staffId, staffId), eq(appointments.status, 'scheduled'), gt(appointments.startsAt, dayBefore), lt(appointments.startsAt, new Date(end).toISOString())]
  if (excludeId) where.push(ne(appointments.id, excludeId))
  const rows = (await base().where(and(...where))).map(shape)
  return rows.filter((r) => new Date(r.startsAt).getTime() + r.durationMin * 60000 > start)
}

export async function activeStaff() {
  await ready()
  return db.select({ id: admins.id, name: admins.name, email: admins.email, phone: admins.phone, role: admins.role })
    .from(admins).where(eq(admins.active, true)).orderBy(asc(admins.name))
}

/* ---------------- notifications ---------------- */

export type AlertKind = 'booked' | 'changed' | 'cancelled' | 'reminder'

function titleFor(kind: AlertKind, a: ApptRow) {
  const what = kindLabel(a.kind)
  switch (kind) {
    case 'booked': return `New ${what.toLowerCase()} booked`
    case 'changed': return `${what} changed`
    case 'cancelled': return `${what} cancelled`
    case 'reminder': return `${what} at ${fmtTime(a.startsAt)}`
  }
}

function summaryLine(a: ApptRow) {
  return `${fmtWhen(a.startsAt)} · ${durationLabel(a.durationMin)} · ${a.location || 'Location to be confirmed'} · ${a.staffName} going`
}

/**
 * Records an on-screen alert for every member of staff and emails them all.
 * The person who made the change doesn't get a pop-up for their own action, but still gets the email for their calendar.
 */
export async function announce(kind: AlertKind, appointmentId: string, actorId: string | null, extra?: { changes?: string; reason?: string }) {
  const a = await getAppointment(appointmentId)
  if (!a) return
  await db.insert(notifications).values({
    id: uid(), kind, appointmentId: a.id, title: titleFor(kind, a),
    body: extra?.reason ? `${summaryLine(a)}\nReason: ${extra.reason}` : extra?.changes ? `${summaryLine(a)}\nChanged: ${extra.changes}` : summaryLine(a),
    createdBy: actorId, createdAt: now(),
  })
  // Email after the response so the person booking isn't kept waiting on the mail server.
  after(() => emailEveryone(kind, a, extra))
}

async function emailEveryone(kind: AlertKind, a: ApptRow, extra?: { changes?: string; reason?: string }) {
  const staff = await activeStaff()
  const what = kindLabel(a.kind)
  const when = `${fmtDay(a.startsAt)}, ${fmtTime(a.startsAt)} to ${fmtTime(endIso(a.startsAt, a.durationMin))}`
  const subjectBits: Record<AlertKind, string> = {
    booked: `Booked: ${what} ${fmtDay(a.startsAt)} ${fmtTime(a.startsAt)}, ${a.staffName} going`,
    changed: `Changed: ${what} now ${fmtDay(a.startsAt)} ${fmtTime(a.startsAt)}, ${a.staffName} going`,
    cancelled: `Cancelled: ${what} ${fmtDay(a.startsAt)} ${fmtTime(a.startsAt)}`,
    reminder: `Reminder: ${what} at ${fmtTime(a.startsAt)}, ${a.staffName} going`,
  }
  const heading: Record<AlertKind, string> = {
    booked: `${what} booked`,
    changed: `${what} has changed`,
    cancelled: `${what} cancelled`,
    reminder: `${what} starts at ${fmtTime(a.startsAt)}`,
  }
  const rows: [string, string][] = [
    ['When', when],
    ['Duration', durationLabel(a.durationMin)],
    ['Where', a.location || 'To be confirmed'],
    ['Who’s going', `${a.staffName}${a.staffPhone ? ` (${a.staffPhone})` : ''}`],
    ['Meeting', [a.contactName, a.contactPhone, a.contactEmail].filter(Boolean).join(' · ')],
    ['Property ref', a.propertyRef ?? ''],
    ['Notes', a.notes ?? ''],
    ['What changed', extra?.changes ?? ''],
    ['Reason', extra?.reason ?? ''],
  ]
  const link = portalUrl(`/admin/diary/${a.id}`)
  const text = [heading[kind], '', ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), '', `Open in the portal: ${link}`].join('\n')
  const sequence = Math.floor(new Date(a.updatedAt).getTime() / 1000) % 2147483647
  const ics = kind === 'reminder' ? undefined : {
    filename: 'appointment.ics',
    method: kind === 'cancelled' ? ('CANCEL' as const) : ('PUBLISH' as const),
    content: icsEvent({
      uid: a.id, start: a.startsAt, end: endIso(a.startsAt, a.durationMin), sequence, cancel: kind === 'cancelled',
      summary: `${what}${a.contactName ? ` with ${a.contactName}` : ''} (${a.staffName})`,
      location: a.location, description: rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n'),
    }),
  }
  await sendMail({
    to: staff.map((s) => s.email), subject: subjectBits[kind], text, appointmentId: a.id, ics,
    html: staffEmailHtml({
      kicker: kind === 'reminder' ? 'Appointment reminder' : 'Diary update',
      heading: heading[kind], rows,
      note: kind === 'reminder' ? `${a.staffName} is responsible. Record the outcome in the portal straight after.` : undefined,
      button: { label: 'Open in the portal', href: link },
    }),
  })
}

/**
 * Raises reminders that have come due. Safe to call from every poll and from cron at the same time:
 * the conditional UPDATE means only one caller wins each appointment.
 */
export async function runDueReminders(): Promise<number> {
  await ready()
  const nowIso = new Date().toISOString()
  const horizon = new Date(Date.now() + 3 * 3600000).toISOString()
  const candidates = await db.select({ id: appointments.id, startsAt: appointments.startsAt, reminderMin: appointments.reminderMin })
    .from(appointments)
    .where(and(eq(appointments.status, 'scheduled'), isNull(appointments.remindedAt), gt(appointments.startsAt, nowIso), lt(appointments.startsAt, horizon)))
  let sent = 0
  for (const c of candidates) {
    if (new Date(c.startsAt).getTime() - c.reminderMin * 60000 > Date.now()) continue
    const res = await db.update(appointments).set({ remindedAt: now() })
      .where(and(eq(appointments.id, c.id), isNull(appointments.remindedAt)))
    if (res.rowsAffected !== 1) continue
    await announce('reminder', c.id, null)
    sent++
  }
  return sent
}

export type Alert = {
  id: string
  kind: string
  title: string
  body: string | null
  createdAt: string
  createdBy: string | null
  appointment: { id: string; kind: string; startsAt: string; durationMin: number; location: string; staffName: string; staffId: string; contactName: string | null } | null
}

/** Unread alerts for one person: anything from the last 12 hours they haven't acknowledged and didn't cause themselves. */
export async function unreadAlerts(userId: string): Promise<Alert[]> {
  await ready()
  const since = new Date(Date.now() - 12 * 3600000).toISOString()
  const read = db.select({ id: notificationReads.notificationId }).from(notificationReads).where(eq(notificationReads.adminId, userId))
  const rows = await db.select({ n: notifications }).from(notifications)
    .where(and(
      gt(notifications.createdAt, since),
      notInArray(notifications.id, read),
      sql`(${notifications.createdBy} IS NULL OR ${notifications.createdBy} <> ${userId})`,
    ))
    .orderBy(desc(notifications.createdAt)).limit(20)
  const ids = [...new Set(rows.map((r) => r.n.appointmentId).filter(Boolean))] as string[]
  const appts = ids.length ? (await base().where(inArray(appointments.id, ids))).map(shape) : []
  const byId = new Map(appts.map((a) => [a.id, a]))
  return rows.map(({ n }) => {
    const a = n.appointmentId ? byId.get(n.appointmentId) : undefined
    return {
      id: n.id, kind: n.kind, title: n.title, body: n.body, createdAt: n.createdAt, createdBy: n.createdBy,
      appointment: a ? { id: a.id, kind: a.kind, startsAt: a.startsAt, durationMin: a.durationMin, location: a.location, staffName: a.staffName, staffId: a.staffId, contactName: a.contactName } : null,
    }
  })
}

export async function markAlertsRead(userId: string, ids: string[]) {
  if (!ids.length) return
  await ready()
  await db.insert(notificationReads)
    .values(ids.slice(0, 50).map((id) => ({ notificationId: id, adminId: userId, readAt: now() })))
    .onConflictDoNothing()
}

export type PendingOutcome = { id: string; kind: string; startsAt: string; durationMin: number; location: string; contactName: string | null; contactPhone: string | null; propertyRef: string | null }

export const toPending = (a: ApptRow): PendingOutcome => ({
  id: a.id, kind: a.kind, startsAt: a.startsAt, durationMin: a.durationMin, location: a.location,
  contactName: a.contactName, contactPhone: a.contactPhone, propertyRef: a.propertyRef,
})
