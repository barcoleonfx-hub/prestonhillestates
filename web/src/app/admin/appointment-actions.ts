'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins, appointments, enquiries, properties } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { APPT_KINDS, DURATIONS, INTEREST, NEXT_STEPS, OUTCOMES, REMINDERS } from '@/lib/appointment-options'
import { announce, clashesFor, getAppointment } from '@/lib/appointments'
import { upsertContact } from '@/lib/contacts'
import { contacts } from '@/db/schema'
import { durationLabel, fmtTime, fmtWhen, londonToIso } from '@/lib/time'
import { now, uid } from '@/lib/util'

export type BookingState = {
  error?: string
  field?: string
  clashes?: string[]
}

const str = (form: FormData, k: string, max = 500) => String(form.get(k) ?? '').trim().slice(0, max)

export async function saveAppointment(_prev: BookingState, form: FormData): Promise<BookingState> {
  const me = await requireAdmin()
  await ready()

  const id = str(form, 'id', 64)
  const existing = id ? await db.query.appointments.findFirst({ where: eq(appointments.id, id) }) : undefined
  if (id && !existing) return { error: 'That appointment no longer exists.' }
  if (existing && existing.status !== 'scheduled') return { error: 'This appointment is closed and can’t be changed.' }

  const kind = APPT_KINDS.some((k) => k.value === str(form, 'kind')) ? str(form, 'kind') : 'viewing'
  const propertyId = str(form, 'propertyId', 64) || null
  const address = str(form, 'address', 300) || null
  const date = str(form, 'date', 10)
  const time = str(form, 'time', 5)
  const durationMin = Number(str(form, 'durationMin'))
  const staffId = str(form, 'staffId', 64)
  const contactName = str(form, 'contactName', 120) || null
  const contactPhone = str(form, 'contactPhone', 40) || null
  const contactEmail = str(form, 'contactEmail', 200).toLowerCase() || null
  const notes = str(form, 'notes', 2000) || null
  const reminderMin = Number(str(form, 'reminderMin')) || 30
  const enquiryId = str(form, 'enquiryId', 64) || null
  const force = form.get('force') === '1'
  const givenContactId = str(form, 'contactId', 64) || null

  if (propertyId && !(await db.query.properties.findFirst({ where: eq(properties.id, propertyId) }))) return { error: 'Pick the property again, that one wasn’t found.', field: 'propertyId' }
  if (!propertyId && !address) return { error: 'Choose a property or type the address.', field: 'address' }
  const startsAt = londonToIso(date, time)
  if (!startsAt) return { error: 'Pick a date and a time.', field: 'date' }
  if (!existing && new Date(startsAt).getTime() < Date.now() - 10 * 60000) return { error: 'That time has already passed. Pick a time later than now.', field: 'time' }
  if (!DURATIONS.includes(durationMin as (typeof DURATIONS)[number]) && !(durationMin >= 10 && durationMin <= 480)) return { error: 'Pick how long it will take.', field: 'durationMin' }
  if (!REMINDERS.some((r) => r.value === reminderMin)) return { error: 'Pick when to send the reminder.' }
  const staff = await db.query.admins.findFirst({ where: and(eq(admins.id, staffId), eq(admins.active, true)) })
  if (!staff) return { error: 'Choose who is going. Every appointment needs one person responsible.', field: 'staffId' }
  if (kind !== 'other' && !contactName) return { error: 'Add the name of the person you’re meeting.', field: 'contactName' }
  if (kind !== 'other' && !contactPhone && !contactEmail) return { error: 'Add a phone number or email for them, in case plans change.', field: 'contactPhone' }
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return { error: 'That email address doesn’t look right.', field: 'contactEmail' }

  if (!force) {
    const clashes = await clashesFor(staffId, startsAt, durationMin, existing?.id)
    if (clashes.length) {
      return {
        error: `${staff.name} is already booked then.`,
        field: 'staffId',
        clashes: clashes.map((c) => `${fmtTime(c.startsAt)} for ${durationLabel(c.durationMin)}: ${c.location || 'no address'}${c.contactName ? ` with ${c.contactName}` : ''}`),
      }
    }
  }

  // If the reminder time has already passed (booked at short notice) the booking alert does the job.
  const reminderDue = new Date(startsAt).getTime() - reminderMin * 60000 <= Date.now()
  const ts = now()
  // Link the appointment to the person's contact record (found or created by phone/email) so it shows in their history.
  let contactId = givenContactId && (await db.query.contacts.findFirst({ where: eq(contacts.id, givenContactId) })) ? givenContactId : null
  if (!contactId && contactName && (contactPhone || contactEmail)) {
    contactId = await upsertContact({ name: contactName, phone: contactPhone, email: contactEmail, role: kind === 'valuation' ? 'seller' : kind === 'viewing' ? 'buyer' : null, by: me.id, touch: false })
  }
  const values = { contactId, kind, propertyId, address: propertyId ? null : address, startsAt, durationMin, staffId, contactName, contactPhone, contactEmail, notes, reminderMin, updatedAt: ts }

  let apptId: string
  if (existing) {
    apptId = existing.id
    const changes: string[] = []
    if (existing.startsAt !== startsAt) changes.push(`time moved from ${fmtWhen(existing.startsAt)}`)
    if (existing.durationMin !== durationMin) changes.push(`now ${durationLabel(durationMin)}`)
    if (existing.staffId !== staffId) {
      const prev = await db.query.admins.findFirst({ where: eq(admins.id, existing.staffId) })
      changes.push(`${staff.name} going instead of ${prev?.name ?? 'someone else'}`)
    }
    if (existing.propertyId !== propertyId || (existing.address ?? null) !== values.address) changes.push('new address')
    const timingChanged = existing.startsAt !== startsAt || existing.reminderMin !== reminderMin
    await db.update(appointments).set({ ...values, remindedAt: timingChanged ? (reminderDue ? ts : null) : existing.remindedAt })
      .where(eq(appointments.id, existing.id))
    await announce('changed', apptId, me.id, { changes: changes.join(', ') || 'details updated' })
  } else {
    apptId = uid()
    await db.insert(appointments).values({ id: apptId, ...values, status: 'scheduled', remindedAt: reminderDue ? ts : null, enquiryId, createdBy: me.id, createdAt: ts })
    if (enquiryId) await db.update(enquiries).set({ handled: true }).where(eq(enquiries.id, enquiryId))
    await announce('booked', apptId, me.id)
  }

  revalidatePath('/admin', 'layout')
  redirect(`/admin/diary/${apptId}?saved=${existing ? 'changed' : 'booked'}`)
}

export type SimpleState = { ok?: boolean; error?: string }

export async function cancelAppointment(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  const me = await requireAdmin()
  await ready()
  const id = str(form, 'id', 64)
  const reason = str(form, 'reason', 500)
  if (reason.length < 3) return { error: 'Say why it’s cancelled so everyone knows.' }
  const res = await db.update(appointments).set({ status: 'cancelled', cancelReason: reason, updatedAt: now() })
    .where(and(eq(appointments.id, id), eq(appointments.status, 'scheduled')))
  if (res.rowsAffected !== 1) return { error: 'It’s already closed.' }
  await announce('cancelled', id, me.id, { reason })
  revalidatePath('/admin', 'layout')
  return { ok: true }
}

export async function recordOutcome(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  const me = await requireAdmin()
  await ready()
  const id = str(form, 'id', 64)
  const a = await getAppointment(id)
  if (!a) return { error: 'That appointment no longer exists.' }
  if (a.status !== 'scheduled') return { ok: true } // someone already filled it in
  if (a.staffId !== me.id && me.role !== 'admin') return { error: `Only ${a.staffName} or an admin can record this outcome.` }
  if (new Date(a.startsAt).getTime() > Date.now()) return { error: 'You can record the outcome once the appointment has started.' }

  const outcome = str(form, 'outcome', 40)
  if (!OUTCOMES.some((o) => o.value === outcome)) return { error: 'Say whether it went ahead.' }
  const went = outcome === 'attended'
  const interest = str(form, 'interest', 40)
  if (went && !(INTEREST[a.kind] ?? INTEREST.other).some((o) => o.value === interest)) {
    return { error: a.kind === 'valuation' ? 'Say how the valuation went.' : 'Say how interested they were.' }
  }
  const figure = str(form, 'figure', 60)
  const notes = str(form, 'notes', 4000)
  if (notes.length < 10) return { error: 'Write a short note about what happened (at least a sentence).' }
  const nextChoice = str(form, 'next', 80)
  const nextOther = str(form, 'nextOther', 200)
  const next = nextChoice === 'other' ? nextOther : nextChoice
  if (!next || (nextChoice !== 'other' && !NEXT_STEPS.includes(nextChoice as (typeof NEXT_STEPS)[number]))) return { error: 'Choose the next step.' }

  const res = await db.update(appointments).set({
    status: 'completed', outcome, outcomeInterest: went ? interest : null,
    outcomeNotes: figure ? `Valuation figure: ${figure}\n${notes}` : notes,
    outcomeNext: next, outcomeAt: now(), outcomeBy: me.id, updatedAt: now(),
  }).where(and(eq(appointments.id, id), eq(appointments.status, 'scheduled')))
  if (res.rowsAffected !== 1) return { ok: true }
  revalidatePath('/admin', 'layout')
  return { ok: true }
}
