'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, licences, licensingSchemes, rentals } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { after } from 'next/server'
import { fillAreas, fmtPostcode, refreshArea } from '@/lib/licensing'
import { KINDS, LICENCE_STATUS, OCCUPANCY, WARDS, type Council } from '@/lib/licensing-rules'
import { now, uid } from '@/lib/util'

const str = (f: FormData, k: string, max = 300) => String(f.get(k) ?? '').trim().slice(0, max)
const opt = (f: FormData, k: string, max = 300) => str(f, k, max) || null
const day = (f: FormData, k: string) => { const v = str(f, k, 20); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null }
const int = (f: FormData, k: string) => { const n = Number(str(f, k, 6)); return Number.isFinite(n) && n > 0 ? Math.round(n) : null }
const done = (id?: string) => { revalidatePath('/admin/licensing', 'layout'); revalidatePath('/admin') ; if (id) revalidatePath(`/admin/licensing/${id}`) }

/** Links a rental to the landlord's contact record when the email or phone matches one we hold. */
async function landlordContact(email: string | null, phone: string | null) {
  if (email) { const c = await db.query.contacts.findFirst({ where: eq(contacts.emailNorm, email.toLowerCase()) }); if (c) return c.id }
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length >= 10) { const c = await db.query.contacts.findFirst({ where: eq(contacts.phoneNorm, digits) }); if (c) return c.id }
  return null
}

export type RentalInput = {
  address: string; postcode: string | null; council: string; ward: string | null; occupancy: string; management: string | null
  landlordName: string | null; landlordEmail: string | null; landlordPhone: string | null
  gasExpires: string | null; eicrExpires: string | null; epcExpires: string | null; epcRating: string | null; notes: string | null
}
function fromForm(f: FormData): RentalInput {
  return {
    address: str(f, 'address', 200), postcode: fmtPostcode(str(f, 'postcode', 12)) ?? (opt(f, 'postcode', 12)?.toUpperCase() ?? null),
    council: str(f, 'council', 10) || 'auto', ward: opt(f, 'ward', 60), occupancy: OCCUPANCY.some((o) => o.value === str(f, 'occupancy')) ? str(f, 'occupancy') : 'single',
    management: opt(f, 'management', 20), landlordName: opt(f, 'landlordName', 120), landlordEmail: opt(f, 'landlordEmail', 200)?.toLowerCase() ?? null, landlordPhone: opt(f, 'landlordPhone', 40),
    gasExpires: day(f, 'gasExpires'), eicrExpires: day(f, 'eicrExpires'), epcExpires: day(f, 'epcExpires'), epcRating: (opt(f, 'epcRating', 1) ?? '').toUpperCase() || null, notes: opt(f, 'notes', 4000),
  }
}
/** "auto" means look the council and ward up from the postcode; anything else is a choice made by hand. */
function areaFields(i: RentalInput) {
  if (i.council === 'auto') return { wardSource: 'auto', council: null as string | null, ward: null as string | null }
  const council = (['brent', 'harrow', 'other'] as Council[]).includes(i.council as Council) ? i.council : 'other'
  const ward = council === 'brent' || council === 'harrow' ? (WARDS[council].find((w) => w === i.ward) ?? null) : i.ward
  return { wardSource: 'manual', council, ward }
}

export async function saveRental(_prev: { error?: string } | undefined, f: FormData): Promise<{ error?: string }> {
  const me = await requireAdmin()
  await ready()
  const id = str(f, 'id', 64)
  const i = fromForm(f)
  if (!i.address) return { error: 'Add the address.' }
  if (i.landlordEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.landlordEmail)) return { error: 'The landlord’s email doesn’t look right.' }
  const area = areaFields(i)
  const values = {
    address: i.address, postcode: i.postcode, occupancy: i.occupancy, management: i.management,
    landlordName: i.landlordName, landlordEmail: i.landlordEmail, landlordPhone: i.landlordPhone, landlordContactId: await landlordContact(i.landlordEmail, i.landlordPhone),
    gasExpires: i.gasExpires, eicrExpires: i.eicrExpires, epcExpires: i.epcExpires, epcRating: i.epcRating, notes: i.notes, updatedAt: now(),
    ...(area.wardSource === 'manual' ? area : { wardSource: 'auto' }),
  }
  let rid = id
  if (id) await db.update(rentals).set(values).where(eq(rentals.id, id))
  else { rid = uid(); await db.insert(rentals).values({ id: rid, ...values, createdBy: me.id, createdAt: now() }) }
  const r = await db.query.rentals.findFirst({ where: eq(rentals.id, rid) })
  if (r && r.wardSource === 'auto') await refreshArea(r).catch(() => false)
  await audit(me.id, id ? 'rental_update' : 'rental_create', 'rental', rid, i.address.slice(0, 80))
  done(rid)
  redirect(`/admin/licensing/${rid}${id ? '?saved=1' : ''}`)
}

export async function archiveRental(f: FormData) {
  const me = await requireAdmin()
  await ready()
  const id = str(f, 'id', 64), on = str(f, 'on') === '1'
  await db.update(rentals).set({ archived: on, updatedAt: now() }).where(eq(rentals.id, id))
  await audit(me.id, on ? 'rental_archive' : 'rental_restore', 'rental', id)
  done(id)
  if (on) redirect('/admin/licensing')
}

export async function lookUpArea(f: FormData) {
  await requireAdmin()
  await ready()
  const id = str(f, 'id', 64)
  const r = await db.query.rentals.findFirst({ where: eq(rentals.id, id) })
  if (r) { await db.update(rentals).set({ wardSource: 'auto' }).where(eq(rentals.id, id)); await refreshArea({ ...r, wardSource: 'auto' }) }
  done(id)
}

export async function markChecked(f: FormData) {
  const me = await requireAdmin()
  await ready()
  const id = str(f, 'id', 64)
  await db.update(rentals).set({ lastCheckedAt: now(), lastCheckedBy: me.name }).where(eq(rentals.id, id))
  await audit(me.id, 'rental_checked', 'rental', id)
  done(id)
}

export async function saveLicence(_prev: { error?: string; ok?: number } | undefined, f: FormData): Promise<{ error?: string; ok?: number }> {
  const me = await requireAdmin()
  await ready()
  const rentalId = str(f, 'rentalId', 64), id = str(f, 'id', 64)
  const kind = KINDS.some((k) => k.value === str(f, 'kind')) ? str(f, 'kind') : 'selective'
  const status = LICENCE_STATUS.some((k) => k.value === str(f, 'status')) ? str(f, 'status') : 'granted'
  const v = {
    kind, status, council: opt(f, 'council', 20), number: opt(f, 'number', 80), holder: opt(f, 'holder', 120),
    appliedOn: day(f, 'appliedOn'), startsOn: day(f, 'startsOn'), expiresOn: day(f, 'expiresOn'),
    maxOccupants: int(f, 'maxOccupants'), maxHouseholds: int(f, 'maxHouseholds'), conditions: opt(f, 'conditions', 4000), notes: opt(f, 'notes', 2000), updatedAt: now(),
  }
  if (status === 'granted' && !v.expiresOn) return { error: 'Add the expiry date: it’s what the reminders are based on.' }
  if (v.startsOn && v.expiresOn && v.expiresOn < v.startsOn) return { error: 'The expiry date is before the start date.' }
  if (status === 'applied' && !v.appliedOn) return { error: 'Add the date it was applied for.' }
  if (!(await db.query.rentals.findFirst({ where: eq(rentals.id, rentalId) }))) return { error: 'That property no longer exists.' }
  if (id) await db.update(licences).set(v).where(and(eq(licences.id, id), eq(licences.rentalId, rentalId)))
  else await db.insert(licences).values({ id: uid(), rentalId, ...v, createdBy: me.id, createdAt: now() })
  await audit(me.id, id ? 'licence_update' : 'licence_add', 'rental', rentalId, `${kind} ${v.number ?? ''} ${v.expiresOn ?? ''}`)
  done(rentalId)
  return { ok: Date.now() }
}

export async function deleteLicence(f: FormData) {
  const me = await requireAdmin()
  await ready()
  const id = str(f, 'id', 64), rentalId = str(f, 'rentalId', 64)
  await db.delete(licences).where(and(eq(licences.id, id), eq(licences.rentalId, rentalId)))
  await audit(me.id, 'licence_delete', 'rental', rentalId)
  done(rentalId)
}

export async function saveScheme(f: FormData) {
  const me = await requireAdmin()
  await ready()
  const id = str(f, 'id', 64)
  if (str(f, 'delete') === '1') { await db.delete(licensingSchemes).where(eq(licensingSchemes.id, id)); done(); return }
  const council = ['brent', 'harrow', 'other'].includes(str(f, 'council')) ? str(f, 'council') : 'brent'
  const wards = f.getAll('wards').map(String).filter(Boolean)
  const v = {
    council, kind: KINDS.some((k) => k.value === str(f, 'kind')) ? str(f, 'kind') : 'selective', name: str(f, 'name', 160) || 'Licensing scheme',
    wards: JSON.stringify(str(f, 'whole') === '1' ? ['*'] : wards), startsOn: day(f, 'startsOn') ?? new Date().toISOString().slice(0, 10), endsOn: day(f, 'endsOn') ?? '2099-12-31',
    sourceUrl: opt(f, 'sourceUrl', 400), checkedOn: new Date().toISOString().slice(0, 10), notes: opt(f, 'notes', 1000), updatedAt: now(),
  }
  if (id) await db.update(licensingSchemes).set(v).where(eq(licensingSchemes.id, id))
  else await db.insert(licensingSchemes).values({ id: uid(), ...v })
  await audit(me.id, 'scheme_save', 'licensing_scheme', id || 'new', v.name)
  done()
}

// ---------- importing an existing spreadsheet ----------

export type ImportRow = RentalInput & { licenceKind: string | null; licenceNumber: string | null; licenceStatus: string | null; licenceStart: string | null; licenceExpiry: string | null; problems: string[] }

const HEADERS: Record<string, string[]> = {
  address: ['address', 'property', 'property address', 'address line 1', 'street address'],
  postcode: ['postcode', 'post code', 'zip'],
  council: ['council', 'borough', 'local authority'],
  ward: ['ward'],
  occupancy: ['type', 'occupancy', 'property type', 'hmo'],
  landlordName: ['landlord', 'landlord name', 'owner'],
  landlordEmail: ['landlord email', 'email', 'owner email'],
  landlordPhone: ['landlord phone', 'phone', 'landlord mobile', 'mobile', 'telephone'],
  licenceKind: ['licence type', 'license type', 'scheme'],
  licenceNumber: ['licence number', 'license number', 'licence no', 'license no', 'licence ref', 'licence', 'license'],
  licenceStatus: ['licence status', 'license status', 'status'],
  licenceStart: ['licence start', 'license start', 'start date', 'issued', 'granted', 'date issued'],
  licenceExpiry: ['licence expiry', 'license expiry', 'expiry', 'expiry date', 'expires', 'licence end', 'end date', 'valid until'],
  gasExpires: ['gas', 'gas safety', 'gas expiry', 'gas certificate', 'cp12'],
  eicrExpires: ['eicr', 'eicr expiry', 'electrical', 'electrical certificate'],
  epcExpires: ['epc', 'epc expiry'],
  epcRating: ['epc rating', 'rating'],
  notes: ['notes', 'comments'],
}

function splitCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false
  const t = text.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch; continue }
    if (ch === '"') q = true
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim()))
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** Dates as people type them in UK spreadsheets: 31/03/2026, 31-3-26, 2026-03-31, 31 March 2026, or an Excel day number. */
export async function parseDay(raw: string): Promise<string | null> {
  const s = raw.trim()
  if (!s) return null
  let y: number, m: number, d: number
  let mt: RegExpMatchArray | null
  if ((mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [+mt[1], +mt[2], +mt[3]]
  else if ((mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) [d, m, y] = [+mt[1], +mt[2], +mt[3] < 100 ? 2000 + +mt[3] : +mt[3]]
  else if ((mt = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{2,4})$/i)) && MONTHS.includes(mt[2].slice(0, 3).toLowerCase())) [d, m, y] = [+mt[1], MONTHS.indexOf(mt[2].slice(0, 3).toLowerCase()) + 1, +mt[3] < 100 ? 2000 + +mt[3] : +mt[3]]
  else if (/^\d{5}$/.test(s)) { const dt = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return dt.toISOString().slice(0, 10) }
  else return null
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

async function rowsFrom(text: string): Promise<{ rows: ImportRow[]; unknown: string[] }> {
  const table = splitCsv(text)
  if (table.length < 2) return { rows: [], unknown: [] }
  const head = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '))
  const col: Record<string, number> = {}
  for (const [k, names] of Object.entries(HEADERS)) { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) col[k] = i }
  const unknown = table[0].filter((_, i) => !Object.values(col).includes(i) && table[0][i].trim())
  const rows: ImportRow[] = []
  for (const r of table.slice(1, 2001)) {
    const g = (k: string) => (col[k] != null ? (r[col[k]] ?? '').trim() : '')
    const problems: string[] = []
    const dates: Record<string, string | null> = {}
    for (const k of ['licenceStart', 'licenceExpiry', 'gasExpires', 'eicrExpires', 'epcExpires']) { dates[k] = await parseDay(g(k)); if (g(k) && !dates[k]) problems.push(`Couldn’t read the date “${g(k)}”`) }
    const typeText = g('occupancy').toLowerCase()
    const occupancy = /5\+|large|mandatory|5 or more/.test(typeText) ? 'hmo_large' : /\bhmo\b|shared house|house share|small hmo/.test(typeText) ? 'hmo_small' : 'single'
    const kt = g('licenceKind').toLowerCase()
    const licenceKind = /mandatory/.test(kt) ? 'mandatory_hmo' : /additional|hmo/.test(kt) ? 'additional_hmo' : g('licenceNumber') || dates.licenceExpiry ? (occupancy === 'hmo_large' ? 'mandatory_hmo' : occupancy === 'hmo_small' ? 'additional_hmo' : 'selective') : null
    const st = g('licenceStatus').toLowerCase()
    const council = /brent/i.test(g('council')) ? 'brent' : /harrow/i.test(g('council')) ? 'harrow' : g('council') ? 'other' : 'auto'
    const pc = fmtPostcode(g('postcode')) ?? fmtPostcode(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.exec(g('address'))?.[0])
    if (!g('address')) problems.push('No address')
    if (!pc) problems.push('No postcode, so the council and ward can’t be looked up')
    rows.push({
      address: g('address').slice(0, 200), postcode: pc, council, ward: g('ward') || null, occupancy, management: null,
      landlordName: g('landlordName') || null, landlordEmail: g('landlordEmail').toLowerCase() || null, landlordPhone: g('landlordPhone') || null,
      gasExpires: dates.gasExpires, eicrExpires: dates.eicrExpires, epcExpires: dates.epcExpires, epcRating: (g('epcRating').match(/^[A-G]$/i)?.[0] ?? '').toUpperCase() || null, notes: g('notes') || null,
      licenceKind, licenceNumber: g('licenceNumber') || null, licenceStatus: /appl|pending|submitted/.test(st) ? 'applied' : /exempt/.test(st) ? 'exempt' : licenceKind ? 'granted' : null,
      licenceStart: dates.licenceStart, licenceExpiry: dates.licenceExpiry, problems,
    })
  }
  return { rows, unknown }
}

export async function previewImport(text: string) {
  await requireAdmin()
  return rowsFrom(text.slice(0, 2_000_000))
}

export async function commitImport(text: string): Promise<{ added: number; skipped: number; error?: string }> {
  const me = await requireAdmin()
  await ready()
  const { rows } = await rowsFrom(text.slice(0, 2_000_000))
  const existing = new Set((await db.select({ a: rentals.address, p: rentals.postcode }).from(rentals)).map((r) => `${r.a.toLowerCase()}|${r.p ?? ''}`))
  let added = 0, skipped = 0
  for (const r of rows) {
    if (!r.address || existing.has(`${r.address.toLowerCase()}|${r.postcode ?? ''}`)) { skipped++; continue }
    const id = uid()
    const area = areaFields(r)
    await db.insert(rentals).values({
      id, address: r.address, postcode: r.postcode, occupancy: r.occupancy, management: r.management, landlordName: r.landlordName, landlordEmail: r.landlordEmail, landlordPhone: r.landlordPhone,
      landlordContactId: await landlordContact(r.landlordEmail, r.landlordPhone), gasExpires: r.gasExpires, eicrExpires: r.eicrExpires, epcExpires: r.epcExpires, epcRating: r.epcRating, notes: r.notes,
      ...(area.wardSource === 'manual' ? area : { wardSource: 'auto' }), createdBy: me.id, createdAt: now(), updatedAt: now(),
    })
    if (r.licenceKind && (r.licenceExpiry || r.licenceStatus === 'applied' || r.licenceNumber)) {
      await db.insert(licences).values({
        id: uid(), rentalId: id, kind: r.licenceKind, council: area.council, number: r.licenceNumber, status: r.licenceStatus ?? 'granted',
        startsOn: r.licenceStart, expiresOn: r.licenceExpiry, appliedOn: r.licenceStatus === 'applied' ? r.licenceStart : null, createdBy: me.id, createdAt: now(), updatedAt: now(),
      })
    }
    existing.add(`${r.address.toLowerCase()}|${r.postcode ?? ''}`)
    added++
  }
  await audit(me.id, 'rental_import', 'rental', 'import', `${added} added`)
  // Look up every new council and ward straight away (100 postcodes per request), after the reply.
  after(() => fillAreas(500).catch((e) => console.error('ward look-up after import failed', e)))
  done()
  return { added, skipped }
}
