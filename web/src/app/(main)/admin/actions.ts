'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db, ready } from '@/db/client'
import { enquiries, media, properties, rooms } from '@/db/schema'
import {
  clearLoginFailures, endSession, loginLocked, recordLoginFailure, requireAdmin, startSession, verifyLogin,
} from '@/lib/auth'
import { nextRef } from '@/lib/properties'
import { storage } from '@/lib/storage'
import { now, uid } from '@/lib/util'
import {
  CHANNELS, COUNCIL_TAX_BANDS, EPC_RATINGS, FURNISHING, LET_TYPES, PRICE_QUALIFIERS, PROPERTY_TYPES,
  RENT_FREQUENCIES, STATUSES, TENURES, type Option,
} from '@/lib/options'

// ---------------- auth ----------------

export async function login(_prev: { error: string; email?: string }, form: FormData): Promise<{ error: string; email?: string }> {
  const email = String(form.get('email') || '').trim()
  const password = String(form.get('password') || '')
  if (!email || !password) return { error: 'Enter your email and password.', email }
  if (loginLocked(email)) return { error: 'Too many attempts. Wait 15 minutes and try again.', email }
  const user = await verifyLogin(email, password)
  if (!user) {
    recordLoginFailure(email)
    return { error: 'That email and password don’t match an account.', email }
  }
  clearLoginFailures(email)
  await startSession(user)
  redirect('/admin')
}

export async function logout() {
  await endSession()
  redirect('/admin/login')
}

// ---------------- properties ----------------

export async function createProperty(form: FormData) {
  const admin = await requireAdmin()
  await ready()
  const channel = form.get('channel') === 'let' ? 'let' : 'sale'
  const id = uid()
  const ts = now()
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.insert(properties).values({
        id, ref: await nextRef(), channel, status: 'available', published: false,
        rentFrequency: channel === 'let' ? 'pcm' : null,
        keyFeatures: [], createdAt: ts, updatedAt: ts, updatedBy: admin.email,
      })
      break
    } catch (e) {
      if (attempt === 4) throw e
    }
  }
  redirect(`/admin/properties/${id}`)
}

const text = z.string().trim().max(20000).transform((v) => (v === '' ? null : v))
const shortText = z.string().trim().max(300).transform((v) => (v === '' ? null : v))
const wholeNumber = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : Number(v.replace(/[£,\s]/g, ''))))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 0), 'Enter a whole number')
const decimal = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : Number(v)))
  .refine((v) => v === null || Number.isFinite(v), 'Enter a number')
const oneOf = (opts: Option[]) =>
  z.string().refine((v) => opts.some((o) => o.value === v), 'Choose an option').transform((v) => (v === '' ? null : v))
const date = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date')
  .transform((v) => (v === '' ? null : v))
const url = z
  .string()
  .trim()
  .refine((v) => v === '' || /^https:\/\/\S+$/i.test(v), 'Use a full link starting with https://')
  .transform((v) => (v === '' ? null : v))

const PropertyForm = z.object({
  channel: oneOf(CHANNELS),
  status: oneOf(STATUSES),
  headline: shortText,
  addressLine1: shortText, street: shortText, locality: shortText, town: shortText,
  postcode: z.string().trim().max(10).transform((v) => (v === '' ? null : v.toUpperCase().replace(/\s+/g, ' '))),
  displayAddress: shortText,
  latitude: decimal, longitude: decimal,
  price: wholeNumber, priceQualifier: oneOf(PRICE_QUALIFIERS), rentFrequency: oneOf([{ value: '', label: '' }, ...RENT_FREQUENCIES]),
  deposit: wholeNumber, availableFrom: date, furnishing: oneOf(FURNISHING), letType: oneOf(LET_TYPES),
  minTenancyMonths: wholeNumber,
  propertyType: oneOf([{ value: '', label: '' }, ...PROPERTY_TYPES]), tenure: oneOf(TENURES),
  leaseYearsRemaining: wholeNumber, groundRent: wholeNumber, serviceCharge: wholeNumber,
  bedrooms: wholeNumber, bathrooms: wholeNumber, receptions: wholeNumber, floorAreaSqft: wholeNumber,
  councilTaxBand: oneOf(COUNCIL_TAX_BANDS), epcCurrent: oneOf(EPC_RATINGS), epcPotential: oneOf(EPC_RATINGS),
  parking: text, outsideSpace: text, heating: text, electricity: text, water: text, sewerage: text,
  broadband: text, mobileSignal: text, construction: text, buildingSafety: text, restrictions: text,
  rightsEasements: text, floodRisk: text, planning: text, accessibility: text,
  summary: z.string().trim().max(1000).transform((v) => (v === '' ? null : v)),
  description: text,
  videoUrl: url, virtualTourUrl: url,
  negotiator: shortText, internalNotes: text,
})

export type SaveState = { ok?: boolean; message?: string; errors?: Record<string, string>; at?: number }

const FIELD_NAMES = Object.keys(PropertyForm.shape)

export async function saveProperty(_prev: SaveState, form: FormData): Promise<SaveState> {
  const admin = await requireAdmin()
  await ready()
  const id = String(form.get('id') || '')
  const intent = String(form.get('intent') || 'save')
  const existing = await db.query.properties.findFirst({ where: eq(properties.id, id) })
  if (!existing) return { ok: false, message: 'This property no longer exists.' }

  const raw: Record<string, string> = {}
  for (const name of FIELD_NAMES) raw[name] = String(form.get(name) ?? '')
  const parsed = PropertyForm.safeParse(raw)
  if (!parsed.success) {
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] = issue.message
    return { ok: false, message: 'Some fields need attention.', errors, at: Date.now() }
  }
  const v = parsed.data
  const status = STATUSES.find((s) => s.value === v.status)
  if (status && !status.channels.includes(v.channel!)) {
    return { ok: false, message: 'Some fields need attention.', errors: { status: `“${status.label}” doesn’t apply to this listing type` }, at: Date.now() }
  }

  const keyFeatures = form.getAll('keyFeature').map((f) => String(f).trim()).filter(Boolean).slice(0, 12)
  const roomNames = form.getAll('roomName').map(String)
  const roomDims = form.getAll('roomDims').map(String)
  const roomDescs = form.getAll('roomDesc').map(String)
  const roomRows = roomNames
    .map((name, i) => ({ name: name.trim(), dimensions: (roomDims[i] || '').trim() || null, description: (roomDescs[i] || '').trim() || null }))
    .filter((r) => r.name)

  const featured = form.get('featured') === 'on'
  const newBuild = form.get('newBuild') === 'on'
  const sharedOwnership = form.get('sharedOwnership') === 'on'

  let published = existing.published
  let publishedAt = existing.publishedAt
  if (intent === 'publish') {
    const photoCount = (
      await db.query.media.findMany({ where: and(eq(media.propertyId, id), eq(media.kind, 'photo'), eq(media.status, 'ready')) })
    ).length
    const missing: Record<string, string> = {}
    if (!v.street && !v.displayAddress) missing.street = 'Add the street or a display address'
    if (!v.postcode) missing.postcode = 'Add the postcode'
    if (v.price == null && v.priceQualifier !== 'poa') missing.price = 'Add a price, or choose “Price on application”'
    if (!v.propertyType) missing.propertyType = 'Choose the property type'
    if (v.bedrooms == null) missing.bedrooms = 'Add the number of bedrooms (0 for a studio)'
    if (!v.summary && !v.description) missing.summary = 'Add a summary or full description'
    if (v.channel === 'sale' && !v.tenure) missing.tenure = 'Add the tenure (required material information for sales)'
    if (!v.councilTaxBand) missing.councilTaxBand = 'Add the council tax band (required material information)'
    if (photoCount === 0) missing.media = 'Upload at least one photo'
    if (Object.keys(missing).length) {
      return { ok: false, message: 'Before this can go live:', errors: missing, at: Date.now() }
    }
    published = true
    publishedAt = existing.publishedAt ?? now()
  } else if (intent === 'unpublish') {
    published = false
  }

  await db.batch([
    db
      .update(properties)
      .set({ ...v, channel: v.channel!, status: v.status!, keyFeatures, featured, newBuild, sharedOwnership, published, publishedAt, updatedAt: now(), updatedBy: admin.email })
      .where(eq(properties.id, id)),
    db.delete(rooms).where(eq(rooms.propertyId, id)),
    ...roomRows.map((r, i) => db.insert(rooms).values({ id: uid(), propertyId: id, position: i, ...r })),
  ])

  const message =
    intent === 'publish' ? (existing.published ? 'Saved. Changes are live.' : 'Published. This property is now on the website.')
      : intent === 'unpublish' ? 'Taken off the website. Saved as a draft.'
        : existing.published ? 'Saved. Changes are live.' : 'Draft saved.'
  return { ok: true, message, at: Date.now() }
}

export async function deleteProperty(form: FormData) {
  await requireAdmin()
  await ready()
  const id = String(form.get('id') || '')
  const items = await db.query.media.findMany({ where: eq(media.propertyId, id) })
  await Promise.all(items.map((m) => storage().remove(m.storageKey)))
  await db.batch([
    db.delete(media).where(eq(media.propertyId, id)),
    db.delete(rooms).where(eq(rooms.propertyId, id)),
    db.update(enquiries).set({ propertyId: null }).where(eq(enquiries.propertyId, id)),
    db.delete(properties).where(eq(properties.id, id)),
  ])
  redirect('/admin/properties')
}

// ---------------- media ----------------

async function touch(propertyId: string, email: string) {
  await db.update(properties).set({ updatedAt: now(), updatedBy: email }).where(eq(properties.id, propertyId))
}

export async function updateMediaCaption(id: string, caption: string) {
  const admin = await requireAdmin()
  await ready()
  const m = await db.query.media.findFirst({ where: eq(media.id, id) })
  if (!m) return
  await db.update(media).set({ caption: caption.trim().slice(0, 200) || null }).where(eq(media.id, id))
  await touch(m.propertyId, admin.email)
}

export async function setCoverPhoto(id: string) {
  const admin = await requireAdmin()
  await ready()
  const m = await db.query.media.findFirst({ where: eq(media.id, id) })
  if (!m || m.kind !== 'photo') return
  await db.batch([
    db.update(media).set({ isCover: false }).where(and(eq(media.propertyId, m.propertyId), eq(media.kind, 'photo'))),
    db.update(media).set({ isCover: true }).where(eq(media.id, id)),
  ])
  await touch(m.propertyId, admin.email)
}

export async function reorderMedia(propertyId: string, orderedIds: string[]) {
  const admin = await requireAdmin()
  await ready()
  const owned = await db.query.media.findMany({ where: and(eq(media.propertyId, propertyId), inArray(media.id, orderedIds)) })
  const ownedIds = new Set(owned.map((m) => m.id))
  const ids = orderedIds.filter((i) => ownedIds.has(i))
  if (!ids.length) return
  await db.batch(ids.map((mid, i) => db.update(media).set({ position: i }).where(eq(media.id, mid))) as [never, ...never[]])
  await touch(propertyId, admin.email)
}

export async function deleteMedia(id: string) {
  const admin = await requireAdmin()
  await ready()
  const m = await db.query.media.findFirst({ where: eq(media.id, id) })
  if (!m) return
  await storage().remove(m.storageKey)
  await db.delete(media).where(eq(media.id, id))
  if (m.isCover) {
    const next = await db.query.media.findFirst({
      where: and(eq(media.propertyId, m.propertyId), eq(media.kind, 'photo'), eq(media.status, 'ready')),
      orderBy: (t, { asc }) => [asc(t.position)],
    })
    if (next) await db.update(media).set({ isCover: true }).where(eq(media.id, next.id))
  }
  await touch(m.propertyId, admin.email)
}

// ---------------- enquiries ----------------

export async function setEnquiryHandled(form: FormData) {
  await requireAdmin()
  await ready()
  const id = String(form.get('id') || '')
  const handled = form.get('handled') === '1'
  await db.update(enquiries).set({ handled }).where(eq(enquiries.id, id))
  revalidatePath('/admin', 'layout')
}
