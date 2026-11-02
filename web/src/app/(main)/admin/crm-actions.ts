'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins, calls, contacts, enquiries, properties, tasks } from '@/db/schema'
import { requireAdmin, requireRole } from '@/lib/auth'
import { audit, notifyTask, upsertContact } from '@/lib/contacts'
import { CALL_NEXT, CALLER_TYPES, DIRECTIONS, addRole, normEmail, normPhone, parseMoney, prettyPhone, SOURCES } from '@/lib/crm-options'
import { londonToIso } from '@/lib/time'
import { now, uid } from '@/lib/util'

const str = (form: FormData, k: string, max = 500) => String(form.get(k) ?? '').trim().slice(0, max)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type CallState = { ok?: boolean; error?: string; field?: string; contactId?: string; go?: string; savedAt?: number }

export async function logCall(_prev: CallState, form: FormData): Promise<CallState> {
  const me = await requireAdmin()
  await ready()

  let contactId = str(form, 'contactId', 64) || null
  const name = str(form, 'name', 120)
  const phone = str(form, 'phone', 40)
  const email = str(form, 'email', 200)
  const callerType = str(form, 'callerType', 20)
  const direction = DIRECTIONS.some((d) => d.value === str(form, 'direction')) ? str(form, 'direction') : 'in'
  const propertyId = str(form, 'propertyId', 64) || null
  const notes = str(form, 'notes', 4000) || null
  const next = str(form, 'next', 20)
  const source = SOURCES.includes(str(form, 'source') as (typeof SOURCES)[number]) ? str(form, 'source') : null
  const enquiryId = str(form, 'enquiryId', 64) || null

  if (!contactId && !name && !phone && !email) return { error: 'Add their name, number or email.', field: direction.startsWith('email') ? 'email' : 'phone' }
  if (phone && normPhone(phone).length < 7) return { error: 'That phone number looks too short.', field: 'phone' }
  if (email && !EMAIL.test(email)) return { error: 'That email address doesn’t look right.', field: 'email' }
  if (!CALLER_TYPES.some((c) => c.value === callerType)) return { error: 'Choose who’s calling: buyer, tenant, seller, landlord or other.', field: 'callerType' }
  if (!CALL_NEXT.some((n) => n.value === next)) return { error: 'Choose the next step, even if it’s “No action needed”.', field: 'next' }
  if (propertyId && !(await db.query.properties.findFirst({ where: eq(properties.id, propertyId) }))) return { error: 'Pick the property again.', field: 'propertyId' }

  let dueAt: string | null = null
  let assignTo = ''
  if (next === 'callback') {
    dueAt = londonToIso(str(form, 'cbDate', 10), str(form, 'cbTime', 5))
    if (!dueAt) return { error: 'Pick when to call them back.', field: 'cb' }
    assignTo = str(form, 'assignTo', 64) || me.id
    if (!(await db.query.admins.findFirst({ where: and(eq(admins.id, assignTo), eq(admins.active, true)) }))) return { error: 'Choose who will call them back.', field: 'cb' }
  }

  // Requirements and address, only kept when given so a quick call never wipes earlier detail.
  const areas = str(form, 'areas', 200) || null
  const minBeds = Number(str(form, 'minBeds')) || null
  const maxPriceRaw = str(form, 'maxPrice', 30)
  const maxPrice = maxPriceRaw ? parseMoney(maxPriceRaw) : null
  if (maxPriceRaw && maxPrice == null) return { error: 'Write the budget as a number, like 450k or 1500.', field: 'maxPrice' }
  const position = str(form, 'position', 80) || null
  const address = str(form, 'address', 300) || null

  if (contactId) {
    const c = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) })
    if (!c) return { error: 'That contact no longer exists. Clear it and search again.' }
    const pn = normPhone(phone)
    await db.update(contacts).set({
      name: name || c.name,
      phone: c.phone || (phone ? prettyPhone(phone) : null),
      phoneNorm: c.phoneNorm || pn || null,
      phone2: c.phone2 || (pn && c.phoneNorm && pn !== c.phoneNorm ? prettyPhone(phone) : null),
      email: c.email || email || null,
      emailNorm: c.emailNorm || normEmail(email) || null,
      roles: addRole(c.roles, callerType),
      source: c.source || source,
      lastContactAt: now(), updatedAt: now(),
    }).where(eq(contacts.id, c.id))
  } else {
    contactId = await upsertContact({ name: name || 'Unknown caller', phone, email, role: callerType, source, by: me.id })
  }
  const patch: Partial<typeof contacts.$inferInsert> = {}
  if (areas) patch.areas = areas
  if (minBeds) patch.minBeds = minBeds
  if (maxPrice) patch.maxPrice = maxPrice
  if (position) patch.position = position
  if (address) patch.address = address
  if (Object.keys(patch).length) await db.update(contacts).set(patch).where(eq(contacts.id, contactId))

  const callId = uid()
  await db.insert(calls).values({ id: callId, contactId, direction, callerType, propertyId, notes, nextStep: next, createdBy: me.id, createdAt: now() })

  // Ticking "this was the callback" closes those tasks.
  const closeIds = form.getAll('closeTask').map(String).filter(Boolean).slice(0, 20)
  if (closeIds.length) {
    await db.update(tasks).set({ doneAt: now(), doneBy: me.id, doneNote: 'Called them back' })
      .where(and(inArray(tasks.id, closeIds), eq(tasks.contactId, contactId), isNull(tasks.doneAt)))
  }

  if (next === 'callback' && dueAt) {
    const taskId = uid()
    const who = name || (await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) }))?.name || 'caller'
    await db.insert(tasks).values({
      id: taskId, contactId, callId, kind: 'callback', title: `Call back ${who}`, dueAt, assignedTo: assignTo,
      // Already due (e.g. "call back in 5 minutes")? Let the next poll raise it.
      notifiedAt: null, createdBy: me.id, createdAt: now(),
    })
    if (assignTo !== me.id) await notifyTask(taskId, 'assigned', me.id)
  }

  if (enquiryId) await db.update(enquiries).set({ handled: true, contactId }).where(eq(enquiries.id, enquiryId))
  await audit(me.id, 'log_call', 'contact', contactId, `${direction} ${callerType} → ${next}`)

  revalidatePath('/admin', 'layout')
  const go = next === 'viewing' || next === 'valuation'
    ? `/admin/diary/new?${new URLSearchParams({ contact: contactId, kind: next, ...(propertyId ? { property: propertyId } : {}) })}`
    : undefined
  return { ok: true, contactId, go, savedAt: Date.now() }
}

export type SimpleState = { ok?: boolean; error?: string }

export async function addCallback(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  const me = await requireAdmin()
  await ready()
  const contactId = str(form, 'contactId', 64)
  const c = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) })
  if (!c) return { error: 'That contact no longer exists.' }
  const dueAt = londonToIso(str(form, 'date', 10), str(form, 'time', 5))
  if (!dueAt) return { error: 'Pick a date and time.' }
  const assignTo = str(form, 'assignTo', 64) || me.id
  if (!(await db.query.admins.findFirst({ where: and(eq(admins.id, assignTo), eq(admins.active, true)) }))) return { error: 'Choose who will call.' }
  const title = str(form, 'title', 160) || `Call back ${c.name}`
  const id = uid()
  await db.insert(tasks).values({ id, contactId, kind: 'callback', title, dueAt, assignedTo: assignTo, createdBy: me.id, createdAt: now() })
  if (assignTo !== me.id) await notifyTask(id, 'assigned', me.id)
  revalidatePath('/admin', 'layout')
  return { ok: true }
}

export async function completeTask(form: FormData) {
  const me = await requireAdmin()
  await ready()
  const id = str(form, 'id', 64)
  await db.update(tasks).set({ doneAt: now(), doneBy: me.id, doneNote: str(form, 'note', 500) || null })
    .where(and(eq(tasks.id, id), isNull(tasks.doneAt)))
  revalidatePath('/admin', 'layout')
}

export async function updateContact(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  const me = await requireAdmin()
  await ready()
  const id = str(form, 'id', 64)
  const c = await db.query.contacts.findFirst({ where: eq(contacts.id, id) })
  if (!c) return { error: 'That contact no longer exists.' }
  const name = str(form, 'name', 120)
  const phone = str(form, 'phone', 40)
  const phone2 = str(form, 'phone2', 40)
  const email = str(form, 'email', 200)
  if (!name) return { error: 'Add their name.' }
  if (email && !EMAIL.test(email)) return { error: 'That email address doesn’t look right.' }
  const pn = normPhone(phone)
  if (pn) {
    const dupe = await db.query.contacts.findFirst({ where: and(eq(contacts.phoneNorm, pn), eq(contacts.archived, false)) })
    if (dupe && dupe.id !== id) return { error: `${dupe.name} already has that number. Open their record instead.` }
  }
  const roles = form.getAll('roles').map(String).filter((r) => CALLER_TYPES.some((t) => t.value === r))
  const maxPriceRaw = str(form, 'maxPrice', 30)
  const maxPrice = maxPriceRaw ? parseMoney(maxPriceRaw) : null
  if (maxPriceRaw && maxPrice == null) return { error: 'Write the budget as a number, like 450k or 1500.' }
  const ownerId = str(form, 'ownerId', 64) || null
  const source = str(form, 'source', 60)
  await db.update(contacts).set({
    name, phone: phone ? prettyPhone(phone) : null, phoneNorm: pn || null, phone2: phone2 ? prettyPhone(phone2) : null,
    email: email || null, emailNorm: normEmail(email) || null, roles: roles.join(','),
    source: SOURCES.includes(source as (typeof SOURCES)[number]) ? source : null,
    areas: str(form, 'areas', 200) || null, minBeds: Number(str(form, 'minBeds')) || null, maxPrice,
    position: str(form, 'position', 80) || null, address: str(form, 'address', 300) || null,
    notes: str(form, 'notes', 4000) || null, ownerId, updatedAt: now(),
  }).where(eq(contacts.id, id))
  await audit(me.id, 'update', 'contact', id)
  revalidatePath(`/admin/contacts/${id}`)
  return { ok: true }
}

export async function archiveContact(form: FormData) {
  const me = await requireRole('admin')
  await ready()
  const id = str(form, 'id', 64)
  const archived = form.get('archived') === '1'
  await db.update(contacts).set({ archived, updatedAt: now() }).where(eq(contacts.id, id))
  await audit(me.id, archived ? 'archive' : 'restore', 'contact', id)
  revalidatePath('/admin', 'layout')
}
