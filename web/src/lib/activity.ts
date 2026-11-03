import 'server-only'
import { enquiryLabel } from './enquiry-labels'
import { and, desc, eq, gte, isNotNull, lt } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins, appointments, calls, contacts, enquiries, properties, tasks } from '@/db/schema'
import { kindLabel, outcomeLabel } from './appointment-options'
import { isEmailDirection, nextLabel, roleLabel } from './crm-options'
import { fmtWhen } from './time'

export type ActivityType = 'call' | 'email' | 'walk_in' | 'enquiry' | 'booking' | 'outcome' | 'callback_done'

export type ActivityItem = {
  id: string
  at: string
  type: ActivityType
  /** e.g. "Incoming call", "Website viewing request" */
  label: string
  title: string
  body: string | null
  contactId: string | null
  contactName: string | null
  contactPhone: string | null
  staffId: string | null
  staffName: string | null
  href: string | null
  /** Only for website enquiries that nobody has dealt with yet. */
  open?: boolean
  enquiry?: { id: string; kind: string; name: string; phone: string | null; email: string | null; propertyId: string | null; intent: string | null; channel: string | null }
}

export const ACTIVITY_FILTERS = [
  { value: 'call', label: 'Calls' },
  { value: 'email', label: 'Emails' },
  { value: 'walk_in', label: 'Walk-ins' },
  { value: 'enquiry', label: 'Website' },
  { value: 'booking', label: 'Bookings' },
  { value: 'outcome', label: 'Outcomes' },
] as const

/** Everything that happened in the office between two instants, newest first. */
export async function activityBetween(fromIso: string, toIso: string, opts: { staffId?: string; types?: string[] } = {}): Promise<ActivityItem[]> {
  await ready()
  const want = (t: ActivityType) => !opts.types?.length || opts.types.includes(t === 'callback_done' ? 'call' : t)

  const callWhere = [gte(calls.createdAt, fromIso), lt(calls.createdAt, toIso)]
  if (opts.staffId) callWhere.push(eq(calls.createdBy, opts.staffId))
  const apptWhere = [gte(appointments.createdAt, fromIso), lt(appointments.createdAt, toIso)]
  if (opts.staffId) apptWhere.push(eq(appointments.staffId, opts.staffId))
  const outWhere = [isNotNull(appointments.outcomeAt), gte(appointments.outcomeAt, fromIso), lt(appointments.outcomeAt, toIso)]
  if (opts.staffId) outWhere.push(eq(appointments.staffId, opts.staffId))
  const taskWhere = [isNotNull(tasks.doneAt), gte(tasks.doneAt, fromIso), lt(tasks.doneAt, toIso)]
  if (opts.staffId) taskWhere.push(eq(tasks.doneBy, opts.staffId))

  const [callRows, enqRows, apptRows, outRows, taskRows, people] = await Promise.all([
    db.select({ c: calls, name: contacts.name, phone: contacts.phone, ref: properties.ref }).from(calls)
      .innerJoin(contacts, eq(calls.contactId, contacts.id)).leftJoin(properties, eq(calls.propertyId, properties.id))
      .where(and(...callWhere)).orderBy(desc(calls.createdAt)).limit(500),
    // Website enquiries belong to the whole office, so they show whoever is filtered.
    db.select({ e: enquiries, ref: properties.ref, channel: properties.channel }).from(enquiries)
      .leftJoin(properties, eq(enquiries.propertyId, properties.id))
      .where(and(gte(enquiries.createdAt, fromIso), lt(enquiries.createdAt, toIso))).orderBy(desc(enquiries.createdAt)).limit(300),
    db.select().from(appointments).where(and(...apptWhere)).limit(300),
    db.select().from(appointments).where(and(...outWhere)).limit(300),
    db.select({ t: tasks, name: contacts.name, phone: contacts.phone }).from(tasks)
      .leftJoin(contacts, eq(tasks.contactId, contacts.id)).where(and(...taskWhere)).limit(300),
    db.select({ id: admins.id, name: admins.name }).from(admins),
  ])
  const who = new Map(people.map((p) => [p.id, p.name]))
  const items: ActivityItem[] = []

  for (const { c, name, phone, ref } of callRows) {
    const type: ActivityType = isEmailDirection(c.direction) ? 'email' : c.direction === 'walk_in' ? 'walk_in' : 'call'
    if (!want(type)) continue
    const label = ({ in: 'Incoming call', out: 'Outgoing call', walk_in: 'Walk-in', email_in: 'Email received', email_out: 'Email sent' } as Record<string, string>)[c.direction] ?? 'Call'
    items.push({
      id: c.id, at: c.createdAt, type, label,
      title: `${name} · ${roleLabel(c.callerType)}${ref ? ` · about ${ref}` : ''}`,
      body: [c.notes, `Next: ${nextLabel(c.nextStep)}`].filter(Boolean).join('\n'),
      contactId: c.contactId, contactName: name, contactPhone: phone,
      staffId: c.createdBy, staffName: who.get(c.createdBy) ?? null, href: `/admin/contacts/${c.contactId}`,
    })
  }
  if (want('enquiry')) for (const r of enqRows) items.push(enquiryItem(r.e, r.ref, r.channel))
  if (want('booking')) {
    for (const a of apptRows) {
      items.push({
        id: `b-${a.id}`, at: a.createdAt, type: 'booking', label: `${kindLabel(a.kind)} booked`,
        title: `${a.contactName ?? 'No name'} · ${fmtWhen(a.startsAt)}${a.status === 'cancelled' ? ' · cancelled' : ''}`,
        body: `${who.get(a.staffId) ?? 'Someone'} going${a.notes ? `\n${a.notes}` : ''}`,
        contactId: a.contactId, contactName: a.contactName, contactPhone: a.contactPhone,
        staffId: a.createdBy, staffName: a.createdBy ? who.get(a.createdBy) ?? null : null, href: `/admin/diary/${a.id}`,
      })
    }
  }
  if (want('outcome')) {
    for (const a of outRows) {
      items.push({
        id: `o-${a.id}`, at: a.outcomeAt!, type: 'outcome', label: `${kindLabel(a.kind)} outcome`,
        title: `${a.contactName ?? 'No name'} · ${outcomeLabel(a.outcome)}`,
        body: [a.outcomeNotes, a.outcomeNext ? `Next: ${a.outcomeNext}` : ''].filter(Boolean).join('\n'),
        contactId: a.contactId, contactName: a.contactName, contactPhone: a.contactPhone,
        staffId: a.outcomeBy, staffName: a.outcomeBy ? who.get(a.outcomeBy) ?? null : null, href: `/admin/diary/${a.id}`,
      })
    }
  }
  if (want('callback_done')) {
    // Callbacks closed by logging the call already appear as that call.
    for (const { t, name, phone } of taskRows) {
      if (t.doneNote === 'Called them back') continue
      items.push({
        id: `t-${t.id}`, at: t.doneAt!, type: 'callback_done', label: 'Callback ticked off',
        title: `${name ?? t.title}`, body: t.doneNote,
        contactId: t.contactId, contactName: name, contactPhone: phone,
        staffId: t.doneBy, staffName: t.doneBy ? who.get(t.doneBy) ?? null : null, href: t.contactId ? `/admin/contacts/${t.contactId}` : null,
      })
    }
  }
  return items.sort((x, y) => (x.at < y.at ? 1 : -1))
}

type EnquiryRow = typeof enquiries.$inferSelect

export function enquiryItem(e: EnquiryRow, ref: string | null, channel: string | null): ActivityItem {
  return {
    id: e.id, at: e.createdAt, type: 'enquiry',
    label: enquiryLabel(e),
    title: e.kind === 'buyer' ? `${e.name} · looking to buy` : e.kind === 'email' ? `${e.name}${ref ? ` · ${ref}` : ''}` : `${e.name}${e.kind === 'valuation' ? ` · ${e.postcode ?? ''} · ${e.intent === 'letting' ? 'thinking of letting' : e.intent === 'selling' ? 'thinking of selling' : 'not sure yet'}` : ref ? ` · ${ref}` : ''}`,
    body: e.message, contactId: e.contactId, contactName: e.name, contactPhone: e.phone,
    staffId: null, staffName: null, href: e.contactId ? `/admin/contacts/${e.contactId}` : '/admin/enquiries', open: !e.handled,
    enquiry: { id: e.id, kind: e.kind, name: e.name, phone: e.phone, email: e.email, propertyId: e.propertyId, intent: e.intent, channel },
  }
}

/** Website enquiries nobody has dealt with yet, newest first. */
export async function openEnquiryItems(limit = 30): Promise<ActivityItem[]> {
  await ready()
  const rows = await db.select({ e: enquiries, ref: properties.ref, channel: properties.channel }).from(enquiries)
    .leftJoin(properties, eq(enquiries.propertyId, properties.id))
    .where(eq(enquiries.handled, false)).orderBy(desc(enquiries.createdAt)).limit(limit)
  return rows.map((r) => enquiryItem(r.e, r.ref, r.channel))
}

export function activityCounts(items: ActivityItem[]) {
  const n = (t: ActivityType) => items.filter((i) => i.type === t).length
  return { calls: n('call'), emails: n('email'), walkIns: n('walk_in'), enquiries: n('enquiry'), bookings: n('booking'), outcomes: n('outcome') }
}
