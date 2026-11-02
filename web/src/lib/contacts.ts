import 'server-only'
import { after } from 'next/server'
import { and, asc, desc, eq, inArray, isNull, like, lte, or, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins, appointments, auditLog, calls, contacts, enquiries, notifications, properties, tasks, type Contact } from '@/db/schema'
import { addRole, normEmail, normPhone, prettyPhone, roleLabel, rolesOf } from './crm-options'
import { portalUrl, sendMail, staffEmailHtml } from './mailer'
import { fmtWhen } from './time'
import { now, uid } from './util'

export async function audit(adminId: string, action: string, entity: string, entityId: string, detail?: string) {
  await db.insert(auditLog).values({ id: uid(), adminId, action, entity, entityId, detail: detail ?? null, at: now() }).catch(() => {})
}

export type ContactMatch = {
  id: string
  name: string
  phone: string | null
  email: string | null
  roles: string[]
  lastContactAt: string | null
  ownerName: string | null
  openTasks: number
  address: string | null
}

/** Live search while someone types a number or a name in the call log. */
export async function findMatches(q: string, limit = 6): Promise<ContactMatch[]> {
  await ready()
  const digits = normPhone(q)
  const text = q.trim().toLowerCase()
  const conds = []
  if (digits.length >= 4) conds.push(like(contacts.phoneNorm, `%${digits}%`), like(sql`replace(coalesce(${contacts.phone2}, ''), ' ', '')`, `%${digits}%`))
  if (/[a-z@]/i.test(text) && text.length >= 2) {
    conds.push(like(sql`lower(${contacts.name})`, `%${text}%`), like(contacts.emailNorm, `%${text}%`), like(sql`lower(coalesce(${contacts.address}, ''))`, `%${text}%`))
  }
  if (!conds.length) return []
  const rows = await db.select({ c: contacts, ownerName: admins.name }).from(contacts)
    .leftJoin(admins, eq(contacts.ownerId, admins.id))
    .where(and(eq(contacts.archived, false), or(...conds)))
    .orderBy(desc(contacts.lastContactAt)).limit(limit)
  const ids = rows.map((r) => r.c.id)
  const counts = ids.length
    ? await db.select({ id: tasks.contactId, n: sql<number>`count(*)` }).from(tasks)
      .where(and(inArray(tasks.contactId, ids), isNull(tasks.doneAt))).groupBy(tasks.contactId)
    : []
  return rows.map(({ c, ownerName }) => ({
    id: c.id, name: c.name, phone: c.phone, email: c.email, roles: rolesOf(c.roles), lastContactAt: c.lastContactAt,
    ownerName, openTasks: Number(counts.find((x) => x.id === c.id)?.n ?? 0), address: c.address,
  }))
}

/**
 * Finds the person by phone or email, or creates them. Fills in anything missing and adds the role,
 * so the same caller never ends up as two records.
 */
export async function upsertContact(input: {
  name: string; phone?: string | null; email?: string | null; role?: string | null; source?: string | null
  address?: string | null; by?: string | null; touch?: boolean
}): Promise<string> {
  await ready()
  const phoneNorm = normPhone(input.phone)
  const emailNorm = normEmail(input.email)
  const where = [
    phoneNorm.length >= 7 ? eq(contacts.phoneNorm, phoneNorm) : undefined,
    emailNorm ? eq(contacts.emailNorm, emailNorm) : undefined,
  ].filter(Boolean)
  const existing = where.length
    ? await db.query.contacts.findFirst({ where: and(or(...where), eq(contacts.archived, false)), orderBy: desc(contacts.lastContactAt) })
    : undefined
  const ts = now()
  if (existing) {
    await db.update(contacts).set({
      name: existing.name || input.name,
      phone: existing.phone || (input.phone ? prettyPhone(input.phone) : null),
      phoneNorm: existing.phoneNorm || phoneNorm || null,
      // A second, different number goes in phone2 rather than being lost.
      phone2: existing.phone2 || (phoneNorm && existing.phoneNorm && phoneNorm !== existing.phoneNorm ? prettyPhone(input.phone) : null),
      email: existing.email || input.email?.trim() || null,
      emailNorm: existing.emailNorm || emailNorm || null,
      roles: input.role ? addRole(existing.roles, input.role) : existing.roles,
      source: existing.source || input.source || null,
      address: existing.address || input.address || null,
      lastContactAt: input.touch === false ? existing.lastContactAt : ts,
      updatedAt: ts,
    }).where(eq(contacts.id, existing.id))
    return existing.id
  }
  const id = uid()
  await db.insert(contacts).values({
    id, name: input.name.trim() || 'Unknown caller',
    phone: input.phone ? prettyPhone(input.phone) : null, phoneNorm: phoneNorm || null,
    email: input.email?.trim() || null, emailNorm: emailNorm || null,
    roles: input.role ?? '', source: input.source ?? null, address: input.address ?? null,
    lastContactAt: ts, createdBy: input.by ?? null, createdAt: ts, updatedAt: ts,
  })
  return id
}

export async function getContact(id: string): Promise<(Contact & { ownerName: string | null }) | null> {
  await ready()
  const [r] = await db.select({ c: contacts, ownerName: admins.name }).from(contacts)
    .leftJoin(admins, eq(contacts.ownerId, admins.id)).where(eq(contacts.id, id)).limit(1)
  return r ? { ...r.c, ownerName: r.ownerName } : null
}

export type TimelineItem = {
  at: string
  type: 'call' | 'task' | 'task_done' | 'enquiry' | 'appointment' | 'outcome' | 'created'
  title: string
  body?: string | null
  by?: string | null
  href?: string
  id: string
}

/** Everything that has happened with one person, newest first. */
export async function timelineFor(contact: Contact): Promise<TimelineItem[]> {
  const people = new Map((await db.select({ id: admins.id, name: admins.name }).from(admins)).map((a) => [a.id, a.name]))
  const who = (id: string | null) => (id ? people.get(id) ?? 'Someone' : null)
  const [callRows, taskRows, enqRows, apptRows] = await Promise.all([
    db.select({ c: calls, ref: properties.ref }).from(calls).leftJoin(properties, eq(calls.propertyId, properties.id))
      .where(eq(calls.contactId, contact.id)).orderBy(desc(calls.createdAt)).limit(200),
    db.select().from(tasks).where(eq(tasks.contactId, contact.id)).limit(200),
    db.select({ e: enquiries, ref: properties.ref }).from(enquiries).leftJoin(properties, eq(enquiries.propertyId, properties.id))
      .where(eq(enquiries.contactId, contact.id)).limit(100),
    db.select().from(appointments).where(eq(appointments.contactId, contact.id)).limit(100),
  ])
  const items: TimelineItem[] = []
  for (const { c, ref } of callRows) {
    items.push({
      id: c.id, at: c.createdAt, type: 'call', by: who(c.createdBy),
      title: `${({ in: 'Called in', out: 'We called', walk_in: 'Came into the office' } as Record<string, string>)[c.direction] ?? 'Call'} as ${roleLabel(c.callerType).toLowerCase()}${ref ? ` about ${ref}` : ''}`,
      body: c.notes,
    })
  }
  for (const t of taskRows) {
    items.push({ id: t.id, at: t.createdAt, type: 'task', by: who(t.createdBy), title: `${t.title} set for ${who(t.assignedTo)}, ${fmtWhen(t.dueAt)}` })
    if (t.doneAt) items.push({ id: `${t.id}-done`, at: t.doneAt, type: 'task_done', by: who(t.doneBy), title: `Done: ${t.title}`, body: t.doneNote })
  }
  for (const { e, ref } of enqRows) {
    items.push({
      id: e.id, at: e.createdAt, type: 'enquiry',
      title: e.kind === 'valuation' ? `Asked for a valuation on the website (${e.postcode})` : `Sent a viewing request on the website${ref ? ` for ${ref}` : ''}`,
      body: e.message,
    })
  }
  for (const a of apptRows) {
    items.push({
      id: a.id, at: a.createdAt, type: 'appointment', by: who(a.createdBy), href: `/admin/diary/${a.id}`,
      title: `${a.kind === 'valuation' ? 'Valuation' : a.kind === 'viewing' ? 'Viewing' : 'Appointment'} booked for ${fmtWhen(a.startsAt)}${a.status === 'cancelled' ? ' (cancelled)' : ''}`,
    })
    if (a.outcomeAt) items.push({ id: `${a.id}-o`, at: a.outcomeAt, type: 'outcome', by: who(a.outcomeBy), href: `/admin/diary/${a.id}`, title: `Outcome: ${a.outcomeNext}`, body: a.outcomeNotes })
  }
  items.push({ id: `${contact.id}-c`, at: contact.createdAt, type: 'created', by: who(contact.createdBy), title: 'Added to contacts' })
  return items.sort((x, y) => (x.at < y.at ? 1 : -1))
}

export type TaskRow = {
  id: string; title: string; dueAt: string; assignedTo: string; assigneeName: string; doneAt: string | null
  contactId: string | null; contactName: string | null; contactPhone: string | null; note: string | null
}

/** Open callbacks, optionally for one person, due before a cut-off. */
export async function openTasks(opts: { assignedTo?: string; dueBefore?: string; contactId?: string } = {}): Promise<TaskRow[]> {
  await ready()
  const where = [isNull(tasks.doneAt)]
  if (opts.assignedTo) where.push(eq(tasks.assignedTo, opts.assignedTo))
  if (opts.dueBefore) where.push(lte(tasks.dueAt, opts.dueBefore))
  if (opts.contactId) where.push(eq(tasks.contactId, opts.contactId))
  const rows = await db.select({ t: tasks, assigneeName: admins.name, contactName: contacts.name, contactPhone: contacts.phone, note: calls.notes })
    .from(tasks).innerJoin(admins, eq(tasks.assignedTo, admins.id))
    .leftJoin(contacts, eq(tasks.contactId, contacts.id))
    .leftJoin(calls, eq(tasks.callId, calls.id))
    .where(and(...where)).orderBy(asc(tasks.dueAt)).limit(300)
  return rows.map(({ t, assigneeName, contactName, contactPhone, note }) => ({
    id: t.id, title: t.title, dueAt: t.dueAt, assignedTo: t.assignedTo, assigneeName, doneAt: t.doneAt,
    contactId: t.contactId, contactName, contactPhone, note,
  }))
}

/** Pops up (and emails) a callback for the person it's assigned to, once it falls due. Called from every poll and from cron. */
export async function runDueTasks(): Promise<number> {
  await ready()
  const due = await db.select({ id: tasks.id }).from(tasks)
    .where(and(isNull(tasks.doneAt), isNull(tasks.notifiedAt), lte(tasks.dueAt, new Date().toISOString()))).limit(50)
  let n = 0
  for (const d of due) {
    const res = await db.update(tasks).set({ notifiedAt: now() }).where(and(eq(tasks.id, d.id), isNull(tasks.notifiedAt)))
    if (res.rowsAffected !== 1) continue
    await notifyTask(d.id, 'due', null)
    n++
  }
  return n
}

/** "due": the callback time has come. "assigned": someone else has given you a callback. */
export async function notifyTask(taskId: string, why: 'due' | 'assigned', actorId: string | null) {
  const [r] = await db.select({ t: tasks, c: contacts, a: admins }).from(tasks)
    .innerJoin(admins, eq(tasks.assignedTo, admins.id)).leftJoin(contacts, eq(tasks.contactId, contacts.id))
    .where(eq(tasks.id, taskId)).limit(1)
  if (!r) return
  const { t, c, a } = r
  const actor = actorId ? (await db.query.admins.findFirst({ where: eq(admins.id, actorId) }))?.name : null
  const title = why === 'due' ? `Call back ${c?.name ?? ''}`.trim() : `${actor ?? 'Someone'} gave you a callback`
  const body = [`${c?.name ?? ''}${c?.phone ? ` · ${c.phone}` : ''}`, `Due ${fmtWhen(t.dueAt)}`].join('\n')
  await db.insert(notifications).values({
    id: uid(), kind: why === 'due' ? 'callback' : 'callback_assigned', appointmentId: null, taskId: t.id, targetAdminId: t.assignedTo,
    title, body, createdBy: actorId, createdAt: now(),
  })
  const link = portalUrl(c ? `/admin/contacts/${c.id}` : '/admin/my-day')
  after(() => sendMail({
    to: [a.email],
    subject: why === 'due' ? `Callback due now: ${c?.name ?? t.title}` : `New callback for you: ${c?.name ?? t.title}, ${fmtWhen(t.dueAt)}`,
    text: `${title}\n\n${body}\n\n${link}`,
    html: staffEmailHtml({
      kicker: why === 'due' ? 'Callback due' : 'New callback',
      heading: title,
      rows: [['Who', c?.name ?? ''], ['Phone', c?.phone ?? ''], ['Due', fmtWhen(t.dueAt)], ['Task', t.title]],
      button: { label: 'Open their record', href: link },
    }),
  }))
}
