'use server'

import { and, eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, properties } from '@/db/schema'
import { now, uid } from '@/lib/util'
import { upsertContact } from '@/lib/contacts'

export type EnquiryState = { ok?: boolean; error?: string }

const recent = new Map<string, number[]>()

export async function sendEnquiry(_prev: EnquiryState, form: FormData): Promise<EnquiryState> {
  // Bots fill every field; people never see this one.
  if (String(form.get('company') || '')) return { ok: true }

  const name = String(form.get('name') || '').trim().slice(0, 120)
  const phone = String(form.get('phone') || '').trim().slice(0, 40)
  const email = String(form.get('email') || '').trim().slice(0, 200)
  const message = String(form.get('message') || '').trim().slice(0, 2000)
  const propertyId = String(form.get('propertyId') || '')

  if (!name) return { error: 'Please tell us your name.' }
  if (!phone && !email) return { error: 'Add a phone number or email so we can reply.' }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email address doesn’t look right.' }

  // Simple flood protection: at most 5 enquiries per contact detail per hour.
  const key = (phone || email).toLowerCase()
  const times = (recent.get(key) || []).filter((t) => t > Date.now() - 3600_000)
  if (times.length >= 5) return { error: 'We’ve already received your requests. The branch will be in touch shortly.' }
  recent.set(key, [...times, Date.now()])

  await ready()
  const property = propertyId
    ? await db.query.properties.findFirst({ where: and(eq(properties.id, propertyId), eq(properties.published, true)) })
    : null

  // Every website enquiry lands on the person's contact record, so a later phone call shows it.
  const contactId = await upsertContact({ name, phone, email, role: property?.channel === 'let' ? 'tenant' : 'buyer', source: 'Our website' }).catch(() => null)
  await db.insert(enquiries).values({
    id: uid(), propertyId: property?.id ?? null, kind: 'viewing', contactId,
    name, phone: phone || null, email: email || null, message: message || null, createdAt: now(),
  })
  return { ok: true }
}

export type ValuationState = { ok?: boolean; error?: string; field?: string }

const INTENTS = ['selling', 'letting', 'unsure']

export async function sendValuationRequest(_prev: ValuationState, form: FormData): Promise<ValuationState> {
  if (String(form.get('company') || '')) return { ok: true }

  const name = String(form.get('name') || '').trim().slice(0, 120)
  const phone = String(form.get('phone') || '').trim().slice(0, 40)
  const email = String(form.get('email') || '').trim().slice(0, 200)
  const postcode = String(form.get('postcode') || '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 10)
  const intentRaw = String(form.get('intent') || '')
  const intent = INTENTS.includes(intentRaw) ? intentRaw : 'unsure'
  // Extra detail from the full valuation page; all optional so the short forms keep working.
  const address = String(form.get('address') || '').trim().slice(0, 200)
  const details = [
    address ? `Address: ${address}, ${postcode}` : '',
    String(form.get('propertyType') || '').trim().slice(0, 40) ? `Type: ${String(form.get('propertyType')).trim().slice(0, 40)}` : '',
    String(form.get('bedrooms') || '').trim().slice(0, 10) ? `Bedrooms: ${String(form.get('bedrooms')).trim().slice(0, 10)}` : '',
    String(form.get('timescale') || '').trim().slice(0, 60) ? `Timescale: ${String(form.get('timescale')).trim().slice(0, 60)}` : '',
    String(form.get('contactTime') || '').trim().slice(0, 60) ? `Best time to call: ${String(form.get('contactTime')).trim().slice(0, 60)}` : '',
    String(form.get('notes') || '').trim().slice(0, 1000),
  ].filter(Boolean).join('\n') || null

  if (!name) return { error: 'Please tell us your name.', field: 'name' }
  if (!phone) return { error: 'Add a phone number so the branch can call you.', field: 'phone' }
  if (!/^[0-9+()\s-]{7,20}$/.test(phone)) return { error: 'That phone number doesn’t look right.', field: 'phone' }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email address doesn’t look right.', field: 'email' }
  if (!/^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/.test(postcode)) return { error: 'Enter the full postcode of the property, e.g. HA3 0PS.', field: 'postcode' }

  const key = phone.replace(/\D/g, '')
  const times = (recent.get(key) || []).filter((t) => t > Date.now() - 3600_000)
  if (times.length >= 5) return { ok: true }
  recent.set(key, [...times, Date.now()])

  await ready()
  const contactId = await upsertContact({
    name, phone, email, role: intent === 'letting' ? 'landlord' : 'seller', source: 'Our website', address: address ? `${address}, ${postcode}` : postcode,
  }).catch(() => null)
  await db.insert(enquiries).values({
    id: uid(), propertyId: null, kind: 'valuation', name, phone, email: email || null, contactId,
    postcode, intent, message: details, createdAt: now(),
  })
  return { ok: true }
}

export type BuyerState = { ok?: boolean; error?: string; field?: string }

/** "Register as a buyer" from the borrowing calculator: becomes a buyer contact with a budget, and a lead to call. */
export async function registerBuyer(_prev: BuyerState, form: FormData): Promise<BuyerState> {
  if (String(form.get('company') || '')) return { ok: true }
  const name = String(form.get('name') || '').trim().slice(0, 120)
  const phone = String(form.get('phone') || '').trim().slice(0, 40)
  const email = String(form.get('email') || '').trim().slice(0, 200)
  const areas = String(form.get('areas') || '').trim().slice(0, 200)
  const budget = Math.round(Number(form.get('budget')) || 0)
  const summary = String(form.get('summary') || '').trim().slice(0, 600)

  if (!name) return { error: 'Please tell us your name.', field: 'name' }
  if (!phone && !email) return { error: 'Add a phone number or email so we can send you homes.', field: 'phone' }
  if (phone && !/^[0-9+()\s-]{7,20}$/.test(phone)) return { error: 'That phone number doesn’t look right.', field: 'phone' }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email address doesn’t look right.', field: 'email' }

  const key = (phone.replace(/\D/g, '') || email.toLowerCase())
  const times = (recent.get(key) || []).filter((t) => t > Date.now() - 3600_000)
  if (times.length >= 5) return { ok: true }
  recent.set(key, [...times, Date.now()])

  await ready()
  const contactId = await upsertContact({ name, phone, email, role: 'buyer', source: 'Our website' }).catch(() => null)
  if (contactId) {
    const patch: { maxPrice?: number; areas?: string } = {}
    if (budget >= 10_000 && budget <= 50_000_000) patch.maxPrice = budget
    if (areas) patch.areas = areas
    if (Object.keys(patch).length) await db.update(contacts).set(patch).where(eq(contacts.id, contactId)).catch(() => {})
  }
  await db.insert(enquiries).values({
    id: uid(), propertyId: null, kind: 'buyer', contactId, name, phone: phone || null, email: email || null,
    message: [summary, areas ? `Areas: ${areas}` : ''].filter(Boolean).join('\n') || null, createdAt: now(),
  })
  return { ok: true }
}
