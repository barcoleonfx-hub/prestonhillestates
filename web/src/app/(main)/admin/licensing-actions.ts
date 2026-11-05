'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, licences, licensingSchemes, rentals } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { after } from 'next/server'
import { fillAreas, fmtPostcode, refreshArea } from '@/lib/licensing'
import { KINDS, LICENCE_STATUS, OCCUPANCY, WARDS, normWard } from '@/lib/licensing-rules'
import { normText } from '@/lib/licensing-extract'
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
    council: str(f, 'council', 40) || 'auto', ward: opt(f, 'ward', 60), occupancy: OCCUPANCY.some((o) => o.value === str(f, 'occupancy')) ? str(f, 'occupancy') : 'single',
    management: opt(f, 'management', 20), landlordName: opt(f, 'landlordName', 120), landlordEmail: opt(f, 'landlordEmail', 200)?.toLowerCase() ?? null, landlordPhone: opt(f, 'landlordPhone', 40),
    gasExpires: day(f, 'gasExpires'), eicrExpires: day(f, 'eicrExpires'), epcExpires: day(f, 'epcExpires'), epcRating: (opt(f, 'epcRating', 1) ?? '').toUpperCase() || null, notes: opt(f, 'notes', 4000),
  }
}
/**
 * "auto" means look the council and ward up from the postcode. Brent or Harrow with a ward is a choice made by
 * hand; without a ward we keep the council and still look the ward up. Any other council is kept by name.
 */
function areaFields(i: RentalInput): { wardSource: string; council: string | null; ward: string | null } {
  const c = (i.council || 'auto').toLowerCase().trim()
  if (c === 'auto') return { wardSource: 'auto', council: null, ward: null }
  if (c === 'brent' || c === 'harrow') {
    const ward = WARDS[c].find((w) => normWard(w) === normWard(i.ward)) ?? null
    return ward ? { wardSource: 'manual', council: c, ward } : { wardSource: 'auto', council: c, ward: null }
  }
  return { wardSource: 'manual', council: /^[a-z][a-z .'&-]{1,40}$/.test(c) ? c : 'other', ward: i.ward }
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
    noLicenceNeeded: str(f, 'noLicenceNeeded') === '1',
    ...(id ? {} : { postcodeSource: i.postcode ? 'manual' : null }),
    ...(area.council ? area : { wardSource: 'auto' }),
  }
  let rid = id
  if (id) {
    // A postcode typed or changed by staff counts as checked.
    const before = await db.query.rentals.findFirst({ where: eq(rentals.id, id) })
    const pcChanged = before && (before.postcode ?? '') !== (i.postcode ?? '')
    await db.update(rentals).set({ ...values, ...(pcChanged ? { postcodeSource: i.postcode ? 'manual' : null, postcodeNote: null } : {}) }).where(eq(rentals.id, id))
  }
  else { rid = uid(); await db.insert(rentals).values({ id: rid, ...values, createdBy: me.id, createdAt: now() }) }
  const r = await db.query.rentals.findFirst({ where: eq(rentals.id, rid) })
  if (r && r.wardSource === 'auto') await refreshArea(r).catch(() => false)
  if (!id) after(async () => { const { fillInEverything } = await import('@/lib/licensing'); await fillInEverything(me.id, { registers: false }) })
  else after(async () => { const { matchDocs, autoApply } = await import('@/lib/licensing-scan'); await matchDocs([rid]).catch(() => 0); await autoApply([rid]).catch(() => 0) })
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
  const council = ['brent', 'harrow'].includes(str(f, 'council')) ? str(f, 'council') : 'brent'
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

export type ImportRow = RentalInput & { licenceKind: string | null; licenceNumber: string | null; licenceStatus: string | null; licenceStart: string | null; licenceExpiry: string | null; appliedOn: string | null; licenceNote: string | null; postcodeFound: boolean; postcodeHow: string | null; resolvedAddress: string | null; problems: string[]; existing: boolean }
export type Mapping = Partial<Record<ImportField, number | null>>
type ImportField = 'address' | 'address2' | 'town' | 'postcode' | 'council' | 'ward' | 'occupancy' | 'landlordName' | 'landlordEmail' | 'landlordPhone'
  | 'licenceKind' | 'licenceNumber' | 'licenceStatus' | 'licenceStart' | 'licenceExpiry' | 'gasExpires' | 'eicrExpires' | 'epcExpires' | 'epcRating' | 'notes'

// Exact headings first, then a looser rule for each field (Rentman, Excel lists, other agency software).
const HEADERS: Record<ImportField, string[]> = {
  address: ['address', 'property', 'properties', 'property name', 'property address', 'address line 1', 'address 1', 'address1', 'street address', 'line 1', 'house name/number and street'],
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
  licenceStatus: ['licence status', 'license status', 'no required/found', 'found', 'licence found', 'license found'],
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

const BOROUGHS = /^(brent|harrow|ealing|barnet|hillingdon|hounslow|camden|westminster|kensington|hammersmith|fulham|islington|hackney|haringey|enfield|waltham forest|redbridge|newham|tower hamlets|southwark|lambeth|wandsworth|merton|sutton|croydon|bromley|lewisham|greenwich|bexley|havering|barking|dagenham|kingston|richmond|luton|watford|hertsmere|three rivers|slough|newcastle|birmingham|manchester|leeds|other)\b/i
const STATUSY = /\b(found|applied|application|licen[cs]e req|not req|no licen|granted|pending|expired|exp\b)/i

function guessMapping(head: string[], rows: string[][] = []): Mapping {
  const h = head.map((x) => x.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' '))
  const map: Mapping = {}, used = new Set<number>()
  for (const [k, names] of Object.entries(HEADERS) as [ImportField, string[]][]) { const i = h.findIndex((x, j) => !used.has(j) && names.includes(x)); if (i >= 0) { map[k] = i; used.add(i) } }
  for (const [k, test] of LOOSE) { if (map[k] != null) continue; const i = h.findIndex((x, j) => !used.has(j) && test(x)); if (i >= 0) { map[k] = i; used.add(i) } }
  // Then by what's in the column: a column of borough names is the council, one of "Found" / "Applied" is the status.
  const share = (i: number, re: RegExp) => { const vs = rows.slice(0, 200).map((r) => (r[i] ?? '').trim()).filter(Boolean); return vs.length ? vs.filter((v) => re.test(v)).length / vs.length : 0 }
  for (const [k, re, min] of [['council', BOROUGHS, 0.6], ['licenceStatus', STATUSY, 0.4]] as [ImportField, RegExp, number][]) {
    if (map[k] != null) continue
    const i = h.findIndex((_, j) => !used.has(j) && share(j, re) >= min)
    if (i >= 0) { map[k] = i; used.add(i) }
  }
  return map
}

/** Reads an uploaded CSV or Excel file (any sheet) into a table, with a first guess at which column is which. */
export async function readImportFile(name: string, base64: string, sheet = 0): Promise<{ sheets: string[]; sheet: number; head: string[]; rows: string[][]; mapping: Mapping; error?: string }> {
  await requireAdmin()
  const fail = (error: string) => ({ sheets: [], sheet: 0, head: [], rows: [], mapping: {}, error })
  const buf = Buffer.from(base64, 'base64')
  if (buf.length > 15 * 1024 * 1024) return fail('That file is too big (15 MB at most).')
  let sheets: { name: string; rows: string[][] }[]
  try {
    if (/\.xlsx$/i.test(name) || buf.subarray(0, 2).toString() === 'PK') { const { readXlsxSheets } = await import('@/lib/xlsx'); sheets = readXlsxSheets(buf) }
    else if (/\.xls$/i.test(name)) return fail('Old Excel files (.xls) can’t be read. In Excel, choose File → Save As → Excel Workbook (.xlsx) or CSV.')
    else sheets = [{ name: 'CSV', rows: splitCsv(buf.toString('utf8')) }]
  } catch { return fail('Couldn’t read that file. Save it as .xlsx or .csv and try again.') }
  const n = Math.min(Math.max(0, sheet), sheets.length - 1)
  const table = sheets[n]?.rows ?? []
  if (table.length < 2) return { ...fail('No rows found on that sheet. The first row should be the column headings.'), sheets: sheets.map((x) => x.name), sheet: n }
  // Some exports start with a title line: use the first row that looks like headings.
  const hi = table.findIndex((r) => r.filter((c) => c.trim()).length >= 2 && r.some((c) => /address|postcode|propert/i.test(c)))
  const start = hi >= 0 ? hi : 0
  const head = table[start].map((c) => c.trim())
  const width = Math.max(head.length, ...table.slice(start + 1, start + 50).map((r) => r.length))
  const fullHead = Array.from({ length: width }, (_, i) => head[i] ?? '')
  const rows = table.slice(start + 1, start + 3001).map((r) => fullHead.map((_, i) => (r[i] ?? '').trim()))
  return { sheets: sheets.map((x) => x.name), sheet: n, head: fullHead, rows, mapping: guessMapping(fullHead, rows) }
}

/** "Flat 5, 10 High Rd" and "flat 5 10 high road london" both become "5|10|high": enough to match shortened addresses. */
function looseKey(address: string): string | null {
  const a = normText(address)
  const flat = /\b(?:flat|apartment|apt|unit)\s+([0-9]+[a-z]?)\b/.exec(a)?.[1] ?? ''
  const rest = flat ? a.replace(/\b(?:flat|apartment|apt|unit)\s+[0-9]+[a-z]?\b/, ' ') : a
  const m = /\b(\d+[a-z]?)\s+([a-z]{3,})/.exec(rest)
  return m ? `${flat}|${m[1]}|${m[2]}` : null
}

const keyOf = (address: string, postcode: string | null) => `${address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${(postcode ?? '').replace(/\s/g, '')}`
const firstDate = async (t: string) => { const m = /(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/.exec(t); return m ? parseDay(m[1]) : null }

async function rowsFrom(rows: string[][], map: Mapping): Promise<ImportRow[]> {
  const have = await db.select({ a: rentals.address, p: rentals.postcode }).from(rentals)
  const existing = new Set(have.map((r) => keyOf(r.a, r.p)))
  const loose = new Map<string, number>()
  for (const r of have) { const k = looseKey(r.a); if (k) loose.set(k, (loose.get(k) ?? 0) + 1) }
  const { guessPostcode } = await import('@/lib/address-match')
  const out: ImportRow[] = []
  for (const r of rows.slice(0, 3000)) {
    const g = (k: ImportField) => (map[k] != null ? (r[map[k]!] ?? '').trim() : '')
    const problems: string[] = []
    const dates: Record<string, string | null> = {}
    for (const k of ['licenceStart', 'licenceExpiry', 'gasExpires', 'eicrExpires', 'epcExpires'] as ImportField[]) { dates[k] = await parseDay(g(k)); if (g(k) && !dates[k] && !/^(n\/?a|none|-|tbc|no)$/i.test(g(k))) problems.push(`Couldn’t read the date “${g(k)}”`) }
    // Type: words like "HMO" or "5+"; a column headed "HMO" with anything in it means an HMO.
    const typeText = g('occupancy').toLowerCase()
    const occupancy = /5\+|large|mandatory|5 or more/.test(typeText) ? 'hmo_large' : /\bhmo\b|shared house|house share|small hmo|^(y|yes|x|true)$/.test(typeText) ? 'hmo_small' : 'single'
    // Status in words, as people write it: "Found", "Applied 08/10/26", "No License Req", "Found(Exp-27/10/26)", "No found".
    const st = g('licenceStatus'), stl = st.toLowerCase()
    let licenceStatus: string | null = null, appliedOn: string | null = null, licenceNote: string | null = null
    let expiry = dates.licenceExpiry
    if (/no\s*licen[cs]e\s*req|not\s*req|not\s*needed|no\s*need|not\s*required/.test(stl)) licenceNote = 'Spreadsheet said no licence required'
    else if (/\b(no|not)\s*found\b|\bnone\b|\bmissing\b/.test(stl)) licenceNote = 'Spreadsheet said no licence found'
    else if (/appl|pending|submitted/.test(stl) && !/found|granted/.test(stl)) { licenceStatus = 'applied'; appliedOn = await firstDate(st) }
    else if (/found|granted|licensed|issued|yes|on portal|valid/.test(stl) || g('licenceNumber') || expiry) {
      licenceStatus = 'granted'
      if (!expiry && /exp/.test(stl)) expiry = await firstDate(st)
      if (/appl/.test(stl)) licenceNote = `Spreadsheet: ${st}`
    } else if (/exempt/.test(stl)) licenceStatus = 'exempt'
    if (licenceStatus === 'granted' && !expiry) problems.push('Licence found but no expiry date: add it on the property')
    const kt = g('licenceKind').toLowerCase()
    const licenceKind = licenceStatus ? (/mandatory/.test(kt) ? 'mandatory_hmo' : /additional|hmo/.test(kt) ? 'additional_hmo' : occupancy === 'hmo_large' ? 'mandatory_hmo' : occupancy === 'hmo_small' ? 'additional_hmo' : 'selective') : null
    const cv = g('council').toLowerCase().trim()
    const council = !cv ? 'auto' : /^brent\b/.test(cv) ? 'brent' : /^harrow\b/.test(cv) ? 'harrow' : cv.replace(/[^a-z .'&-]/g, '').trim() || 'other'
    // "53 KENMORE AVENUE (Preston)": the bracketed note goes in the notes.
    const raw = [g('address'), g('address2'), g('town')].filter(Boolean).join(', ').replace(/,\s*,/g, ',')
    const bracket = /\(([^)]*)\)/.exec(raw)?.[1]?.trim()
    const line = raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim()
    let pc = fmtPostcode(g('postcode')) ?? fmtPostcode(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.exec(line)?.[0])
    const address = line.replace(/,?\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\s*$/i, '').slice(0, 200)
    let postcodeFound = false, postcodeHow: string | null = null, resolvedAddress: string | null = null
    if (!pc && address) {
      const g = await guessPostcode(address, council === 'auto' || council === 'other' ? null : council).catch(() => null)
      if (g) { pc = g.postcode; postcodeFound = true; postcodeHow = `Found from the ${g.how}`; resolvedAddress = g.resolved }
    }
    if (!address) problems.push('No address')
    if (!pc) problems.push('No postcode yet: after import the portal will try a map look-up')
    const lk = looseKey(address)
    out.push({
      address: tidy(address), postcode: pc, council, ward: g('ward') || null, occupancy, management: null,
      landlordName: g('landlordName') || null, landlordEmail: (/\S+@\S+\.\S+/.exec(g('landlordEmail'))?.[0] ?? '').toLowerCase() || null, landlordPhone: g('landlordPhone') || null,
      gasExpires: dates.gasExpires, eicrExpires: dates.eicrExpires, epcExpires: dates.epcExpires, epcRating: (g('epcRating').match(/\b[A-G]\b/i)?.[0] ?? '').toUpperCase() || null,
      notes: [g('notes'), bracket ? `Area: ${bracket}` : '', licenceNote ?? ''].filter(Boolean).join('\n') || null,
      licenceKind, licenceNumber: g('licenceNumber') || null, licenceStatus, licenceStart: dates.licenceStart, licenceExpiry: expiry, appliedOn, licenceNote, postcodeFound, postcodeHow, resolvedAddress, problems,
      existing: existing.has(keyOf(address, pc)) || (!!lk && loose.get(lk) === 1),
    })
  }
  return out
}

/** "70 VICTORIA AVENUE" → "70 Victoria Avenue"; mixed-case text is left as it is. */
const tidy = (a: string) => (a === a.toUpperCase() ? a.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()) : a.replace(/^\s*(\d+[a-z]?)\b/i, (m) => m.toUpperCase()).replace(/\b([a-z])(?=[a-z]{2,})/g, (c) => c.toUpperCase()))

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
  // Shortened addresses ("369 Westcroft") still find "369 Westcroft Way" when only one property fits.
  const byLoose = new Map<string, typeof all>()
  for (const r of all) { const k = looseKey(r.address); if (k) byLoose.set(k, [...(byLoose.get(k) ?? []), r]) }
  let added = 0, updated = 0, skipped = 0
  const later = (a: string | null, b: string | null) => (a && (!b || a > b) ? a : b)
  for (const r of list) {
    if (!r.address) { skipped++; continue }
    const area = areaFields(r)
    const lk = looseKey(r.address)
    const have = byKey.get(keyOf(r.address, r.postcode)) ?? (lk && byLoose.get(lk)?.length === 1 ? byLoose.get(lk)![0] : undefined)
    let id: string
    if (have) {
      if (!update) { skipped++; continue }
      id = have.id
      await db.update(rentals).set({
        postcode: have.postcode ?? r.postcode,
        ...(!have.postcode && r.postcode ? { postcodeSource: r.postcodeFound ? 'land_registry' : 'import', postcodeNote: r.postcodeHow, resolvedAddress: have.resolvedAddress ?? r.resolvedAddress } : {}), landlordName: have.landlordName ?? r.landlordName, landlordEmail: have.landlordEmail ?? r.landlordEmail, landlordPhone: have.landlordPhone ?? r.landlordPhone,
        landlordContactId: have.landlordContactId ?? await landlordContact(r.landlordEmail, r.landlordPhone),
        gasExpires: later(r.gasExpires, have.gasExpires), eicrExpires: later(r.eicrExpires, have.eicrExpires), epcExpires: later(r.epcExpires, have.epcExpires),
        epcRating: have.epcRating ?? r.epcRating, occupancy: have.occupancy !== 'single' ? have.occupancy : r.occupancy, updatedAt: now(),
        notes: [have.notes, r.notes && !(have.notes ?? '').includes(r.notes) ? r.notes : null].filter(Boolean).join('\n') || null,
        ...(!have.council && r.council !== 'auto' ? areaFields(r) : {}),
        ...(r.licenceNote === 'Spreadsheet said no licence required' && !have.noLicenceNeeded ? { noLicenceNeeded: true } : {}),
      }).where(eq(rentals.id, id))
      updated++
    } else {
      id = uid()
      await db.insert(rentals).values({
        id, address: r.address, postcode: r.postcode, postcodeSource: r.postcode ? (r.postcodeFound ? 'land_registry' : 'import') : null, postcodeNote: r.postcodeHow, resolvedAddress: r.resolvedAddress, occupancy: r.occupancy, management: r.management, landlordName: r.landlordName, landlordEmail: r.landlordEmail, landlordPhone: r.landlordPhone,
        landlordContactId: await landlordContact(r.landlordEmail, r.landlordPhone), gasExpires: r.gasExpires, eicrExpires: r.eicrExpires, epcExpires: r.epcExpires, epcRating: r.epcRating, notes: r.notes,
        noLicenceNeeded: r.licenceNote === 'Spreadsheet said no licence required',
        ...(area.council ? area : { wardSource: 'auto' }), createdBy: me.id, createdAt: now(), updatedAt: now(),
      })
      byKey.set(keyOf(r.address, r.postcode), { id } as typeof all[number])
      added++
    }
    if (r.licenceKind && r.licenceStatus && (r.licenceExpiry || r.licenceStatus !== 'granted' || r.licenceNumber)) {
      const mine = await db.select().from(licences).where(eq(licences.rentalId, id))
      const dup = mine.some((l) => (r.licenceNumber && l.number?.toUpperCase() === r.licenceNumber.toUpperCase()) || (r.licenceExpiry && l.expiresOn === r.licenceExpiry) || (r.licenceStatus === 'applied' && l.status === 'applied' && l.appliedOn === r.appliedOn))
      if (!dup) await db.insert(licences).values({
        id: uid(), rentalId: id, kind: r.licenceKind, council: area.council, number: r.licenceNumber, status: r.licenceStatus ?? 'granted',
        startsOn: r.licenceStatus === 'applied' ? null : r.licenceStart, expiresOn: r.licenceStatus === 'applied' ? null : r.licenceExpiry, appliedOn: r.licenceStatus === 'applied' ? r.appliedOn ?? r.licenceStart : null,
        notes: 'Imported from spreadsheet', createdBy: me.id, createdAt: now(), updatedAt: now(),
      })
    }
  }
  await audit(me.id, 'rental_import', 'rental', 'import', `${added} added, ${updated} updated`)
  // Then everything else happens on its own: postcodes, wards, EPCs, emails, council registers.
  after(async () => { const { fillInEverything } = await import('@/lib/licensing'); await fillInEverything(me.id) })
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

// ---------- postcodes and council registers ----------

export async function findPostcodesNow() {
  const me = await requireAdmin()
  const { fillPostcodes, fillAreas } = await import('@/lib/licensing')
  // Clear "tried" so everything missing is tried again now, then work through them after the reply.
  await db.update(rentals).set({ postcodeTriedAt: null }).where(isNull(rentals.postcode))
  await audit(me.id, 'postcodes_find', 'rental', 'all')
  after(async () => { await fillPostcodes({ seconds: 600 }).catch((e) => console.error('postcode finding failed', e)); await fillAreas(1000).catch(() => 0) })
  done()
}

export async function checkRegistersNow() {
  const me = await requireAdmin()
  const { checkRegisters } = await import('@/lib/council-registers')
  await audit(me.id, 'registers_check', 'rental', 'all')
  after(() => checkRegisters({ force: true }).catch((e) => console.error('register check failed', e)))
  done()
}

export async function saveRegister(f: FormData) {
  const me = await requireAdmin()
  await ready()
  const { councilRegisters } = await import('@/db/schema')
  const id = str(f, 'id', 64)
  const url = str(f, 'url', 600), pageUrl = opt(f, 'pageUrl', 600)
  if (!/^https?:\/\//.test(url)) return
  await db.update(councilRegisters).set({ url, pageUrl, enabled: str(f, 'enabled') === '1', updatedAt: now() }).where(eq(councilRegisters.id, id))
  await audit(me.id, 'register_update', 'council_register', id, url.slice(0, 120))
  done()
}

export async function confirmPostcode(f: FormData) {
  await requireAdmin()
  await ready()
  const id = str(f, 'id', 64)
  await db.update(rentals).set({ postcodeSource: 'manual', postcodeNote: 'Checked by staff' }).where(eq(rentals.id, id))
  done(id)
}

export async function undoFound(id: string) {
  const me = await requireAdmin()
  const { undoSuggestion } = await import('@/lib/licensing-scan')
  await undoSuggestion(id, me.id)
  await audit(me.id, 'licence_suggestion_undo', 'rental', id)
  done()
}

export async function setAutofill(f: FormData) {
  await requireAdmin()
  await ready()
  const { settings } = await import('@/db/schema')
  const value = str(f, 'on') === '1' ? 'on' : 'off'
  await db.insert(settings).values({ key: 'licensing_autofill', value, updatedAt: now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now() } })
  if (value === 'on') after(async () => { const { autoApply } = await import('@/lib/licensing-scan'); await autoApply().catch(() => 0) })
  done()
}
