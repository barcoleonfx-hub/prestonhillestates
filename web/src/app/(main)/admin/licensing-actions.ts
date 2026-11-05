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
  after(async () => { const { matchDocs } = await import('@/lib/licensing-scan'); await matchDocs([rid]).catch(() => 0) })
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

// ---------- importing an existing spreadsheet (e.g. a Rentman export) ----------

export type ImportRow = RentalInput & { licenceKind: string | null; licenceNumber: string | null; licenceStatus: string | null; licenceStart: string | null; licenceExpiry: string | null; problems: string[]; existing: boolean }
export type Mapping = Partial<Record<ImportField, number | null>>
type ImportField = 'address' | 'address2' | 'town' | 'postcode' | 'council' | 'ward' | 'occupancy' | 'landlordName' | 'landlordEmail' | 'landlordPhone'
  | 'licenceKind' | 'licenceNumber' | 'licenceStatus' | 'licenceStart' | 'licenceExpiry' | 'gasExpires' | 'eicrExpires' | 'epcExpires' | 'epcRating' | 'notes'

// Exact headings first, then a looser rule for each field (Rentman, Excel lists, other agency software).
const HEADERS: Record<ImportField, string[]> = {
  address: ['address', 'property', 'property address', 'address line 1', 'address 1', 'address1', 'street address', 'line 1', 'house name/number and street'],
  address2: ['address line 2', 'address 2', 'address2', 'line 2', 'locality', 'area'],
  town: ['town', 'city', 'town/city', 'post town'],
  postcode: ['postcode', 'post code', 'zip', 'postal code'],
  council: ['council', 'borough', 'local authority'],
  ward: ['ward'],
  occupancy: ['type', 'occupancy', 'property type', 'hmo', 'letting type'],
  landlordName: ['landlord', 'landlord name', 'owner', 'owner name', 'landlord full name'],
  landlordEmail: ['landlord email', 'owner email', 'landlord e-mail', 'email'],
  landlordPhone: ['landlord phone', 'landlord mobile', 'landlord telephone', 'owner phone', 'mobile', 'phone', 'telephone'],
  licenceKind: ['licence type', 'license type', 'scheme', 'licensing scheme'],
  licenceNumber: ['licence number', 'license number', 'licence no', 'license no', 'licence ref', 'licence reference', 'licence', 'license'],
  licenceStatus: ['licence status', 'license status'],
  licenceStart: ['licence start', 'license start', 'licence start date', 'licence issued', 'licence granted', 'date issued'],
  licenceExpiry: ['licence expiry', 'license expiry', 'licence expiry date', 'licence end', 'licence end date', 'licence valid until'],
  gasExpires: ['gas', 'gas safety', 'gas expiry', 'gas safety expiry', 'gas certificate', 'gas cert expiry', 'cp12', 'gas safety certificate expiry'],
  eicrExpires: ['eicr', 'eicr expiry', 'electrical', 'electrical certificate', 'electrical safety', 'electrical expiry', 'electrical safety expiry'],
  epcExpires: ['epc', 'epc expiry', 'epc expiry date', 'epc valid until', 'energy performance certificate expiry'],
  epcRating: ['epc rating', 'energy rating', 'epc grade', 'energy efficiency rating', 'rating'],
  notes: ['notes', 'comments', 'note'],
}
const LOOSE: [ImportField, (h: string) => boolean][] = [
  ['licenceExpiry', (h) => /licen[cs]/.test(h) && /expir|end|until|renew/.test(h)],
  ['licenceStart', (h) => /licen[cs]/.test(h) && /start|issue|grant|from/.test(h)],
  ['licenceNumber', (h) => /licen[cs]/.test(h) && /no\b|num|ref/.test(h)],
  ['licenceKind', (h) => /licen[cs]/.test(h) && /type|scheme/.test(h)],
  ['epcRating', (h) => /(epc|energy)/.test(h) && /rating|grade|band/.test(h)],
  ['epcExpires', (h) => /\bepc\b|energy performance/.test(h)],
  ['gasExpires', (h) => /\bgas\b|cp12|lgsr/.test(h)],
  ['eicrExpires', (h) => /eicr|electric/.test(h)],
  ['landlordEmail', (h) => /(landlord|owner)/.test(h) && /mail/.test(h)],
  ['landlordPhone', (h) => /(landlord|owner)/.test(h) && /phone|mobile|tel/.test(h)],
  ['landlordName', (h) => /(landlord|owner)/.test(h) && !/mail|phone|mobile|tel|address|ref|id\b/.test(h)],
  ['postcode', (h) => /post ?code/.test(h)],
  ['address2', (h) => /(address|line) ?2/.test(h)],
  ['address', (h) => /(address|line) ?1|^property address|^address$/.test(h)],
]

function splitCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false
  const t = text.replace(/^\ufeff/, '')
  const sep = (t.split('\n')[0].match(/\t/g)?.length ?? 0) > (t.split('\n')[0].match(/,/g)?.length ?? 0) ? '\t' : ','
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch; continue }
    if (ch === '"') q = true
    else if (ch === sep) { row.push(cell); cell = '' }
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
  else if ((mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) [d, m, y] = [+mt[1], +mt[2], +mt[3] < 100 ? 2000 + +mt[3] : +mt[3]]
  else if ((mt = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)\.?,?[\s-]+(\d{2,4})$/i)) && MONTHS.includes(mt[2].slice(0, 3).toLowerCase())) [d, m, y] = [+mt[1], MONTHS.indexOf(mt[2].slice(0, 3).toLowerCase()) + 1, +mt[3] < 100 ? 2000 + +mt[3] : +mt[3]]
  else if (/^\d{5}(\.\d+)?$/.test(s)) { const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000); return dt.toISOString().slice(0, 10) }
  else return null
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function guessMapping(head: string[]): Mapping {
  const h = head.map((x) => x.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' '))
  const map: Mapping = {}, used = new Set<number>()
  for (const [k, names] of Object.entries(HEADERS) as [ImportField, string[]][]) { const i = h.findIndex((x, j) => !used.has(j) && names.includes(x)); if (i >= 0) { map[k] = i; used.add(i) } }
  for (const [k, test] of LOOSE) { if (map[k] != null) continue; const i = h.findIndex((x, j) => !used.has(j) && test(x)); if (i >= 0) { map[k] = i; used.add(i) } }
  return map
}

/** Reads an uploaded CSV or Excel file into a table, with a first guess at which column is which. */
export async function readImportFile(name: string, base64: string): Promise<{ head: string[]; rows: string[][]; mapping: Mapping; error?: string }> {
  await requireAdmin()
  const buf = Buffer.from(base64, 'base64')
  if (buf.length > 15 * 1024 * 1024) return { head: [], rows: [], mapping: {}, error: 'That file is too big (15 MB at most).' }
  let table: string[][]
  try {
    if (/\.xlsx$/i.test(name) || buf.subarray(0, 2).toString() === 'PK') { const { readXlsx } = await import('@/lib/xlsx'); table = readXlsx(buf) }
    else if (/\.xls$/i.test(name)) return { head: [], rows: [], mapping: {}, error: 'Old Excel files (.xls) can’t be read. In Excel, choose File → Save As → Excel Workbook (.xlsx) or CSV.' }
    else table = splitCsv(buf.toString('utf8'))
  } catch { return { head: [], rows: [], mapping: {}, error: 'Couldn’t read that file. Save it as .xlsx or .csv and try again.' } }
  if (table.length < 2) return { head: [], rows: [], mapping: {}, error: 'No rows found. The first row should be the column headings.' }
  // Some exports start with a title line: use the first row that looks like headings.
  const hi = table.findIndex((r) => r.filter((c) => c.trim()).length >= 2 && r.some((c) => /address|postcode|property/i.test(c)))
  const start = hi >= 0 ? hi : 0
  const head = table[start].map((c) => c.trim())
  return { head, rows: table.slice(start + 1, start + 3001).map((r) => head.map((_, i) => (r[i] ?? '').trim())), mapping: guessMapping(head) }
}

const keyOf = (address: string, postcode: string | null) => `${address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${(postcode ?? '').replace(/\s/g, '')}`

async function rowsFrom(rows: string[][], map: Mapping): Promise<ImportRow[]> {
  const existing = new Set((await db.select({ a: rentals.address, p: rentals.postcode }).from(rentals)).map((r) => keyOf(r.a, r.p)))
  const out: ImportRow[] = []
  for (const r of rows.slice(0, 3000)) {
    const g = (k: ImportField) => (map[k] != null ? (r[map[k]!] ?? '').trim() : '')
    const problems: string[] = []
    const dates: Record<string, string | null> = {}
    for (const k of ['licenceStart', 'licenceExpiry', 'gasExpires', 'eicrExpires', 'epcExpires'] as ImportField[]) { dates[k] = await parseDay(g(k)); if (g(k) && !dates[k] && !/^(n\/?a|none|-|tbc|no)$/i.test(g(k))) problems.push(`Couldn’t read the date “${g(k)}”`) }
    const typeText = g('occupancy').toLowerCase()
    const occupancy = /5\+|large|mandatory|5 or more/.test(typeText) ? 'hmo_large' : /\bhmo\b|shared house|house share|small hmo/.test(typeText) ? 'hmo_small' : 'single'
    const kt = g('licenceKind').toLowerCase()
    const licenceKind = /mandatory/.test(kt) ? 'mandatory_hmo' : /additional|hmo/.test(kt) ? 'additional_hmo' : g('licenceNumber') || dates.licenceExpiry ? (occupancy === 'hmo_large' ? 'mandatory_hmo' : occupancy === 'hmo_small' ? 'additional_hmo' : 'selective') : null
    const st = g('licenceStatus').toLowerCase()
    const council = /brent/i.test(g('council')) ? 'brent' : /harrow/i.test(g('council')) ? 'harrow' : g('council') ? 'other' : 'auto'
    const line = [g('address'), g('address2'), g('town')].filter(Boolean).join(', ').replace(/,\s*,/g, ',')
    const pc = fmtPostcode(g('postcode')) ?? fmtPostcode(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.exec(line)?.[0])
    const address = line.replace(/,?\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\s*$/i, '').slice(0, 200)
    if (!address) problems.push('No address')
    if (!pc) problems.push('No postcode, so the council and ward can’t be looked up')
    out.push({
      address, postcode: pc, council, ward: g('ward') || null, occupancy, management: null,
      landlordName: g('landlordName') || null, landlordEmail: (/\S+@\S+\.\S+/.exec(g('landlordEmail'))?.[0] ?? '').toLowerCase() || null, landlordPhone: g('landlordPhone') || null,
      gasExpires: dates.gasExpires, eicrExpires: dates.eicrExpires, epcExpires: dates.epcExpires, epcRating: (g('epcRating').match(/\b[A-G]\b/i)?.[0] ?? '').toUpperCase() || null, notes: g('notes') || null,
      licenceKind, licenceNumber: g('licenceNumber') || null, licenceStatus: /appl|pending|submitted/.test(st) ? 'applied' : /exempt/.test(st) ? 'exempt' : licenceKind ? 'granted' : null,
      licenceStart: dates.licenceStart, licenceExpiry: dates.licenceExpiry, problems, existing: existing.has(keyOf(address, pc)),
    })
  }
  return out
}

export async function previewImport(rows: string[][], map: Mapping) {
  await requireAdmin()
  await ready()
  return rowsFrom(rows, map)
}

/**
 * Adds new properties. With `update`, properties already in the register get their blanks filled in
 * (and a certificate date moved later if the spreadsheet's is newer); nothing already there is overwritten.
 */
export async function commitImport(rows: string[][], map: Mapping, update: boolean): Promise<{ added: number; updated: number; skipped: number }> {
  const me = await requireAdmin()
  await ready()
  const list = await rowsFrom(rows, map)
  const all = await db.select().from(rentals)
  const byKey = new Map(all.map((r) => [keyOf(r.address, r.postcode), r]))
  let added = 0, updated = 0, skipped = 0
  const later = (a: string | null, b: string | null) => (a && (!b || a > b) ? a : b)
  for (const r of list) {
    if (!r.address) { skipped++; continue }
    const area = areaFields(r)
    const have = byKey.get(keyOf(r.address, r.postcode))
    let id: string
    if (have) {
      if (!update) { skipped++; continue }
      id = have.id
      await db.update(rentals).set({
        postcode: have.postcode ?? r.postcode, landlordName: have.landlordName ?? r.landlordName, landlordEmail: have.landlordEmail ?? r.landlordEmail, landlordPhone: have.landlordPhone ?? r.landlordPhone,
        landlordContactId: have.landlordContactId ?? await landlordContact(r.landlordEmail, r.landlordPhone),
        gasExpires: later(r.gasExpires, have.gasExpires), eicrExpires: later(r.eicrExpires, have.eicrExpires), epcExpires: later(r.epcExpires, have.epcExpires),
        epcRating: have.epcRating ?? r.epcRating, notes: have.notes ?? r.notes, occupancy: have.occupancy !== 'single' ? have.occupancy : r.occupancy, updatedAt: now(),
      }).where(eq(rentals.id, id))
      updated++
    } else {
      id = uid()
      await db.insert(rentals).values({
        id, address: r.address, postcode: r.postcode, occupancy: r.occupancy, management: r.management, landlordName: r.landlordName, landlordEmail: r.landlordEmail, landlordPhone: r.landlordPhone,
        landlordContactId: await landlordContact(r.landlordEmail, r.landlordPhone), gasExpires: r.gasExpires, eicrExpires: r.eicrExpires, epcExpires: r.epcExpires, epcRating: r.epcRating, notes: r.notes,
        ...(area.wardSource === 'manual' ? area : { wardSource: 'auto' }), createdBy: me.id, createdAt: now(), updatedAt: now(),
      })
      byKey.set(keyOf(r.address, r.postcode), { id } as typeof all[number])
      added++
    }
    if (r.licenceKind && (r.licenceExpiry || r.licenceStatus === 'applied' || r.licenceNumber)) {
      const mine = await db.select().from(licences).where(eq(licences.rentalId, id))
      const dup = mine.some((l) => (r.licenceNumber && l.number?.toUpperCase() === r.licenceNumber.toUpperCase()) || (r.licenceExpiry && l.expiresOn === r.licenceExpiry))
      if (!dup) await db.insert(licences).values({
        id: uid(), rentalId: id, kind: r.licenceKind, council: area.council, number: r.licenceNumber, status: r.licenceStatus ?? 'granted',
        startsOn: r.licenceStatus === 'applied' ? null : r.licenceStart, expiresOn: r.licenceExpiry, appliedOn: r.licenceStatus === 'applied' ? r.licenceStart : null, notes: 'Imported', createdBy: me.id, createdAt: now(), updatedAt: now(),
      })
    }
  }
  await audit(me.id, 'rental_import', 'rental', 'import', `${added} added, ${updated} updated`)
  // Look up every new council and ward straight away (100 postcodes per request), then match stored emails.
  after(async () => {
    await fillAreas(1000).catch((e) => console.error('ward look-up after import failed', e))
    const { matchDocs } = await import('@/lib/licensing-scan')
    await matchDocs().catch((e) => console.error('matching emails after import failed', e))
  })
  done()
  return { added, updated, skipped }
}

// ---------- details found in the mailbox ----------

export async function startEmailScan() {
  const me = await requireAdmin()
  const { startScan, runLicenceScan } = await import('@/lib/licensing-scan')
  await startScan(me.id)
  await audit(me.id, 'licence_scan_start', 'rental', 'scan')
  after(() => runLicenceScan({ force: true }).catch((e) => console.error('licence scan failed', e)))
  done()
}

export async function useSuggestions(ids: string[]): Promise<{ applied: number; notes: string[] }> {
  const me = await requireAdmin()
  const { applySuggestion } = await import('@/lib/licensing-scan')
  let applied = 0
  const notes: string[] = []
  for (const id of ids.slice(0, 1000)) { const r = await applySuggestion(id, me.id); if (r.ok) applied++; if (r.note) notes.push(r.note) }
  await audit(me.id, 'licence_suggestions_use', 'rental', 'scan', `${applied}`)
  done()
  return { applied, notes: [...new Set(notes)] }
}

export async function dismissFound(ids: string[]) {
  const me = await requireAdmin()
  const { dismissSuggestions } = await import('@/lib/licensing-scan')
  await dismissSuggestions(ids.slice(0, 1000), me.id)
  done()
}
