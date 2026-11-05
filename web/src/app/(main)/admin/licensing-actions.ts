'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { contacts, licences, licensingSchemes, rentals, type Rental } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { after } from 'next/server'
import { fillAreas, fmtPostcode, refreshArea } from '@/lib/licensing'
import { KINDS, LICENCE_STATUS, OCCUPANCY, WARDS, normWard } from '@/lib/licensing-rules'
import { normPostcode, normText } from '@/lib/licensing-extract'
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

/** Which of our properties a spreadsheet row was matched to. `choice` is what Import does unless you change it: a property id, 'new' or 'skip'. */
export type ImportMatch = { kind: 'matched' | 'likely' | 'choose' | 'none'; id: string | null; label: string | null; archived: boolean; how: string | null; choice: string; candidates: { id: string; label: string }[] }
export type ImportRow = RentalInput & {
  licenceKind: string | null; licenceNumber: string | null; licenceStatus: string | null; licenceStart: string | null; licenceExpiry: string | null; appliedOn: string | null; licenceNote: string | null
  postcodeFound: boolean; postcodeHow: string | null; resolvedAddress: string | null; problems: string[]; existing: boolean
  rentmanRef: string | null; landlordRef: string | null; rentPcm: number | null; rentmanArchived: boolean | null; match: ImportMatch | null
}
export type ImportKind = 'rentman' | 'sheet'
export type Mapping = Partial<Record<ImportField, number | null>>
type ImportField = 'address' | 'address2' | 'town' | 'postcode' | 'council' | 'ward' | 'occupancy' | 'landlordName' | 'landlordEmail' | 'landlordPhone'
  | 'licenceKind' | 'licenceNumber' | 'licenceStatus' | 'licenceStart' | 'licenceExpiry' | 'gasExpires' | 'eicrExpires' | 'epcExpires' | 'epcRating' | 'notes'
  | 'rentmanRef' | 'number' | 'street' | 'rent' | 'landlordRef' | 'rentmanArchived'

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
  // Rentman's property export: Propref, Number, Street, Town, City, Postcode, Rental, Telephone, Available, Archived, Llord.
  rentmanRef: ['propref', 'prop ref', 'property ref', 'property reference', 'property id', 'rentman ref'],
  number: ['number', 'house number', 'house no', 'no', 'no.', 'building number', 'flat/house number'],
  street: ['street', 'street name'],
  rent: ['rental', 'rent', 'rent pcm', 'monthly rent', 'rent amount'],
  landlordRef: ['llord', 'llord ref', 'landlord ref', 'landlord id', 'landlord number', 'landlord no'],
  rentmanArchived: ['archived', 'archive', 'inactive', 'withdrawn'],
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
  ['landlordName', (h) => /(landlord|owner)/.test(h) && !/mail|phone|mobile|tel|address|ref|id\b|\bno\b|number/.test(h)],
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

const normHead = (head: string[]) => head.map((x) => x.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' '))
/** Rentman's property list (all our properties), rather than a licensing spreadsheet. */
const isRentman = (head: string[]) => { const h = normHead(head); return h.includes('propref') || h.includes('llord') || (h.includes('number') && h.includes('street') && !h.some((x) => /address/.test(x))) }
const isRentmanMap = (map: Mapping) => map.rentmanRef != null || (map.number != null && map.street != null && map.address == null)

function guessMapping(head: string[], rows: string[][] = []): Mapping {
  const h = normHead(head)
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
  // In Rentman's list "Telephone" is the property's own line, not the landlord's.
  if (isRentman(head) && map.landlordPhone != null && h[map.landlordPhone] === 'telephone') map.landlordPhone = null
  return map
}

/** Reads an uploaded CSV or Excel file (any sheet) into a table, with a first guess at which column is which. */
export async function readImportFile(name: string, base64: string, sheet = 0): Promise<{ sheets: string[]; sheet: number; head: string[]; rows: string[][]; mapping: Mapping; kind: ImportKind; error?: string }> {
  await requireAdmin()
  const fail = (error: string) => ({ sheets: [], sheet: 0, head: [], rows: [], mapping: {}, kind: 'sheet' as ImportKind, error })
  const buf = Buffer.from(base64, 'base64')
  if (buf.length > 15 * 1024 * 1024) return fail('That file is too big (15 MB at most).')
  let sheets: { name: string; rows: string[][] }[]
  try {
    if (/\.xlsx$/i.test(name) || buf.subarray(0, 2).toString() === 'PK') { const { readXlsxSheets } = await import('@/lib/xlsx'); sheets = readXlsxSheets(buf) }
    else if (/\.xls$/i.test(name) || (buf.length >= 4 && buf.readUInt32LE(0) === 0xe011cfd0)) {
      // Rentman's "XLS": an Excel 97–2003 workbook, a web page or Excel XML, or tab-separated text, depending on version.
      const { readXlsSheets, decodeText } = await import('@/lib/xls')
      sheets = readXlsSheets(buf)
      if (!sheets.length) sheets = [{ name: 'Sheet 1', rows: splitCsv(decodeText(buf)) }]
    }
    else sheets = [{ name: 'CSV', rows: splitCsv(buf.toString('utf8')) }]
  } catch (e) { console.error('import file not readable', name, (e as Error).message); return fail('Couldn’t read that file. Open it in Excel and choose File → Save As → Excel Workbook (.xlsx), then choose the new file here.') }
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
  return { sheets: sheets.map((x) => x.name), sheet: n, head: fullHead, rows, mapping: guessMapping(fullHead, rows), kind: isRentman(fullHead) ? 'rentman' : 'sheet' }
}

const keyOf = (address: string, postcode: string | null) => `${address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${(postcode ?? '').replace(/\s/g, '')}`
const firstDate = async (t: string) => { const m = /(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/.exec(t); return m ? parseDay(m[1]) : null }
const yes = (s: string) => /^(true|yes|y|1|x|archived)$/i.test(s.trim())
const labelOf = (r: Pick<Rental, 'address' | 'postcode' | 'rentmanRef' | 'archived'>) => `${r.address}${r.postcode ? `, ${r.postcode}` : ''}${r.rentmanRef ? ` · Rentman ${r.rentmanRef}` : ''}${r.archived ? ' · archived' : ''}`

/** "Flat 2" + "58 Elmsleigh Avenue" → "Flat 2, 58 Elmsleigh Avenue"; "58" + "Elmsleigh Avenue" → "58 Elmsleigh Avenue". */
function joinNumber(num: string, street: string) {
  if (!street) return num
  if (!num || normText(street).trim().startsWith(normText(num).trim())) return street
  // "Flat 100, Premier House, 112" + "Station Rd" → "Flat 100, Premier House, 112 Station Rd"
  return `${num}${/^\d/.test(street) || !/\d+[a-z]?$/i.test(num.trim()) ? ', ' : ' '}${street}`
}

async function rowsFrom(rows: string[][], map: Mapping): Promise<ImportRow[]> {
  const rentman = isRentmanMap(map)
  const have = await db.select().from(rentals)
  const byId = new Map(have.map((r) => [r.id, r]))
  const byRef = new Map(have.filter((r) => r.rentmanRef).map((r) => [r.rentmanRef!, r]))
  const { indexByNumber, matchAddress } = await import('@/lib/property-match')
  const known = (list: Rental[]) => list.map((r) => ({ id: r.id, address: r.address, postcode: r.postcode, other: [r.resolvedAddress, r.sheetAddress], trustedPostcode: r.postcodeSource !== 'land_registry' && r.postcodeSource !== 'online' }))
  // Rentman rows join properties that came from a licensing spreadsheet (not ones already linked to Rentman);
  // spreadsheet rows are matched against everything, archived included.
  const pool = known(rentman ? have.filter((r) => !r.rentmanRef) : have)
  const index = indexByNumber(pool)
  // Street names in the Land Registry list, to tell a slip ("Harkett Road" for Harkett Close) from a real other street.
  const streets = new Set(((await getClient().execute("SELECT DISTINCT street FROM address_keys WHERE kind = 'st'")).rows as unknown as { street: string }[]).map((x) => x.street))
  const streetExists = (st: string) => (streets.size ? streets.has(st) : undefined)
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
    const first = g('address') || joinNumber(g('number'), g('street'))
    // Rentman's town and street fields often repeat each other ("4 Derek Avenue, Wembley, Wembley"): say each part once.
    const parts = [first, g('address2'), g('town')].join(',').split(',').map((x) => x.trim()).filter(Boolean)
    const raw = parts.filter((x, i) => parts.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).join(', ')
    const bracket = /\(([^)]*)\)/.exec(raw)?.[1]?.trim()
    const line = raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim()
    let pc = fmtPostcode(g('postcode')) ?? fmtPostcode(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.exec(line)?.[0])
    const address = tidy(line.replace(/,?\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\s*$/i, '').slice(0, 200))
    const rentmanRef = g('rentmanRef') || null
    const rentPcm = Number(g('rent').replace(/[£,\s]/g, '').replace(/\.\d*$/, '')) || null

    // Which of our properties this is.
    let match: ImportMatch | null = null
    const byRefHit = rentmanRef ? byRef.get(rentmanRef) : undefined
    if (byRefHit) match = { kind: 'matched', id: byRefHit.id, label: labelOf(byRefHit), archived: byRefHit.archived, how: 'Already in from Rentman', choice: byRefHit.id, candidates: [] }
    else if (address && have.length) {
      let m = matchAddress(address, pc, pool, index, streetExists)
      let dupNote: string | null = null
      if (m.kind === 'choose') {
        // Rentman often holds one address several times (each letting, or old records). For the same address, take
        // the one that's current there, or the latest if all are archived; for different flats, the only current one.
        const top = m.candidates.filter((c) => c.score === m.candidates[0].score).map((c) => byId.get(c.id)).filter(Boolean) as Rental[]
        const same = new Set(top.map((t) => `${normText(t.address).trim()}|${normPostcode(t.postcode)}`)).size === 1
        const live = top.filter((t) => !t.archived)
        const latest = [...top].sort((a, b) => Number(b.rentmanRef ?? 0) - Number(a.rentmanRef ?? 0))[0]
        const one = same ? (live.length === 1 ? live[0] : !live.length ? latest : null) : !rentman && live.length === 1 ? live[0] : null
        if (one) {
          m = { kind: same ? 'matched' : 'likely', id: one.id, candidates: m.candidates }
          dupNote = same ? `Rentman has this address ${top.length} times: matched to the ${live.length ? 'current' : 'latest'} one` : 'Several fit: matched to the one that’s current on Rentman'
        }
      }
      const hit = m.id ? byId.get(m.id) : undefined
      const candidates = m.candidates.map((c) => byId.get(c.id)).filter(Boolean).map((c) => ({ id: c!.id, label: labelOf(c!) }))
      const choice = hit ? hit.id : m.kind === 'choose' && !rentman ? 'skip' : 'new'
      const how = !hit ? (m.kind === 'choose' ? 'More than one property fits: choose which' : rentman ? null : have.some((x) => x.rentmanRef) ? 'Not found in the Rentman list' : null)
        : dupNote ?? (rentman ? 'Joins the property from your licensing spreadsheet' : m.kind === 'likely' ? 'Spelt differently: check it’s the right one' : null)
      match = { kind: m.kind, id: hit?.id ?? null, label: hit ? labelOf(hit) : null, archived: !!hit?.archived, how, choice, candidates }
    }
    const target = match?.id ? byId.get(match.id) : undefined
    let postcodeFound = false, postcodeHow: string | null = null, resolvedAddress: string | null = null
    if (!pc && target?.postcode) pc = target.postcode
    if (!pc && address && !target) {
      const gp = await guessPostcode(address, council === 'auto' || council === 'other' ? null : council).catch(() => null)
      if (gp) { pc = gp.postcode; postcodeFound = true; postcodeHow = `Found from the ${gp.how}`; resolvedAddress = gp.resolved }
    }
    if (!address) problems.push('No address')
    if (!pc) problems.push('No postcode yet: after import the portal will try a map look-up')
    out.push({
      address, postcode: pc, council, ward: g('ward') || null, occupancy, management: null,
      landlordName: g('landlordName') || null, landlordEmail: (/\S+@\S+\.\S+/.exec(g('landlordEmail'))?.[0] ?? '').toLowerCase() || null, landlordPhone: g('landlordPhone') || null,
      gasExpires: dates.gasExpires, eicrExpires: dates.eicrExpires, epcExpires: dates.epcExpires, epcRating: (g('epcRating').match(/\b[A-G]\b/i)?.[0] ?? '').toUpperCase() || null,
      notes: [g('notes'), bracket ? `Area: ${bracket}` : '', licenceNote ?? ''].filter(Boolean).join('\n') || null,
      licenceKind, licenceNumber: g('licenceNumber') || null, licenceStatus, licenceStart: dates.licenceStart, licenceExpiry: expiry, appliedOn, licenceNote, postcodeFound, postcodeHow, resolvedAddress, problems,
      existing: !!target, rentmanRef, landlordRef: g('landlordRef') || null, rentPcm: rentPcm && rentPcm > 0 && rentPcm < 1_000_000 ? rentPcm : null,
      rentmanArchived: rentman && map.rentmanArchived != null ? yes(g('rentmanArchived')) : null, match,
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
 * Adds new properties and updates the ones each row was matched to (`choices` overrides the match for a row:
 * a property id, 'new' or 'skip'). Nothing already filled in is overwritten, except that Rentman's address and
 * postcode replace ones typed on a spreadsheet or worked out by the portal. A certificate date only moves later.
 */
export type ImportResult = { added: number; updated: number; skipped: number; joined: number; tracked: number; error?: string }
export type LastImport = { status: 'running' | 'done' | 'failed'; at: string; by: string; label: string; rows: number } & Partial<ImportResult>

async function noteImport(v: LastImport) {
  const { settings } = await import('@/db/schema')
  const value = JSON.stringify(v)
  await db.insert(settings).values({ key: 'licensing_last_import', value, updatedAt: now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now() } })
}
export async function lastImport(): Promise<LastImport | null> {
  const { settings } = await import('@/db/schema')
  const r = await db.query.settings.findFirst({ where: eq(settings.key, 'licensing_last_import') })
  try { return r ? (JSON.parse(r.value) as LastImport) : null } catch { return null }
}

/** Imports the rows, and records how it went (shown on the Licensing page), so a failed import is never silent. */
export async function commitImport(rows: string[][], map: Mapping, update: boolean, choices: Record<number, string> = {}, label = 'Spreadsheet'): Promise<ImportResult> {
  const me = await requireAdmin()
  await ready()
  const base = { at: now(), by: me.name, label: label.slice(0, 120), rows: rows.length }
  await noteImport({ ...base, status: 'running' })
  try {
    const r = await importRows(me, rows, map, update, choices)
    await noteImport({ ...base, ...r, status: 'done', at: now() })
    return r
  } catch (e) {
    console.error('licensing import failed', label, e)
    const error = (e as Error).message?.slice(0, 300) || 'unknown error'
    await noteImport({ ...base, status: 'failed', error, at: now() }).catch(() => {})
    return { added: 0, updated: 0, skipped: 0, joined: 0, tracked: 0, error }
  }
}

async function importRows(me: { id: string; name: string }, rows: string[][], map: Mapping, update: boolean, choices: Record<number, string>): Promise<ImportResult> {
  const list = await rowsFrom(rows, map)
  const byId = new Map((await db.select().from(rentals)).map((r) => [r.id, r]))
  const madeNow = new Map<string, string>()
  let added = 0, updated = 0, skipped = 0, joined = 0
  const later = (a: string | null, b: string | null) => (a && (!b || a > b) ? a : b)
  for (const [i, r] of list.entries()) {
    const choice = choices[i] ?? r.match?.choice ?? 'new'
    if (!r.address || choice === 'skip') { skipped++; continue }
    let have = choice !== 'new' ? byId.get(choice) : undefined
    // One Rentman property per register entry: a second Rentman row for the same one is added on its own.
    if (have && r.rentmanRef && have.rentmanRef && have.rentmanRef !== r.rentmanRef) have = undefined
    // The same address twice on one spreadsheet is one property; on Rentman, two refs are two lettings (rooms, flats).
    if (!have && !r.rentmanRef && madeNow.has(keyOf(r.address, r.postcode))) have = byId.get(madeNow.get(keyOf(r.address, r.postcode))!)
    const area = areaFields(r)
    let id: string
    if (have) {
      if (!update && !r.rentmanRef) { skipped++; continue }
      id = have.id
      const patch: Partial<typeof rentals.$inferInsert> = {
        postcode: have.postcode ?? r.postcode,
        ...(!have.postcode && r.postcode ? { postcodeSource: r.rentmanRef ? 'rentman' : r.postcodeFound ? 'land_registry' : 'import', postcodeNote: r.postcodeHow, resolvedAddress: have.resolvedAddress ?? r.resolvedAddress } : {}), landlordName: have.landlordName ?? r.landlordName, landlordEmail: have.landlordEmail ?? r.landlordEmail, landlordPhone: have.landlordPhone ?? r.landlordPhone,
        landlordContactId: have.landlordContactId ?? await landlordContact(r.landlordEmail, r.landlordPhone),
        gasExpires: later(r.gasExpires, have.gasExpires), eicrExpires: later(r.eicrExpires, have.eicrExpires), epcExpires: later(r.epcExpires, have.epcExpires),
        epcRating: have.epcRating ?? r.epcRating, occupancy: have.occupancy !== 'single' ? have.occupancy : r.occupancy, updatedAt: now(),
        notes: [have.notes, r.notes && !(have.notes ?? '').includes(r.notes) ? r.notes : null].filter(Boolean).join('\n') || null,
        ...(!have.council && r.council !== 'auto' ? areaFields(r) : {}),
        ...(r.licenceNote === 'Spreadsheet said no licence required' && !have.noLicenceNeeded ? { noLicenceNeeded: true } : {}),
      }
      if (r.rentmanRef) {
        // Rentman is the master list: its address and postcode win over ones typed on a spreadsheet or worked out.
        if (!have.rentmanRef) joined++
        Object.assign(patch, { rentmanRef: r.rentmanRef, landlordRef: r.landlordRef ?? have.landlordRef, rentPcm: r.rentPcm ?? have.rentPcm, rentmanArchived: r.rentmanArchived })
        if (have.address !== r.address) Object.assign(patch, { address: r.address, sheetAddress: have.rentmanRef ? have.sheetAddress : have.sheetAddress ?? have.address, resolvedAddress: null })
        if (r.postcode && have.postcodeSource !== 'manual' && normPostcode(r.postcode) !== normPostcode(have.postcode)) {
          Object.assign(patch, { postcode: r.postcode, postcodeSource: 'rentman', postcodeNote: null, resolvedAddress: null, epcCheckedAt: null, ...(have.wardSource !== 'manual' ? { council: null, ward: null, wardSource: 'auto' } : {}) })
        } else if (r.postcode && have.postcodeSource !== 'manual') Object.assign(patch, { postcodeSource: 'rentman', postcodeNote: null }) // Rentman confirms it
        // Archived follows Rentman when it changes there; a property on the licensing sheet isn't archived just
        // because Rentman has it archived the first time they're joined.
        if (have.rentmanRef && have.rentmanArchived !== r.rentmanArchived && r.rentmanArchived != null) patch.archived = r.rentmanArchived
      } else {
        // On the licensing sheet, so it's one we look after now.
        if (have.archived) patch.archived = false
        if (normText(r.address).trim() !== normText(have.address).trim()) patch.sheetAddress = r.address
      }
      await db.update(rentals).set(patch).where(eq(rentals.id, id))
      updated++
    } else {
      id = uid()
      await db.insert(rentals).values({
        id, address: r.address, postcode: r.postcode, postcodeSource: r.postcode ? (r.rentmanRef ? 'rentman' : r.postcodeFound ? 'land_registry' : 'import') : null, postcodeNote: r.postcodeHow, resolvedAddress: r.resolvedAddress, occupancy: r.occupancy, management: r.management, landlordName: r.landlordName, landlordEmail: r.landlordEmail, landlordPhone: r.landlordPhone,
        landlordContactId: await landlordContact(r.landlordEmail, r.landlordPhone), gasExpires: r.gasExpires, eicrExpires: r.eicrExpires, epcExpires: r.epcExpires, epcRating: r.epcRating, notes: r.notes,
        noLicenceNeeded: r.licenceNote === 'Spreadsheet said no licence required',
        rentmanRef: r.rentmanRef, landlordRef: r.landlordRef, rentPcm: r.rentPcm, rentmanArchived: r.rentmanArchived, archived: !!r.rentmanArchived,
        ...(area.council ? area : { wardSource: 'auto' }), createdBy: me.id, createdAt: now(), updatedAt: now(),
      })
      madeNow.set(keyOf(r.address, r.postcode), id)
      added++
    }
    const fresh = await db.query.rentals.findFirst({ where: eq(rentals.id, id) })
    if (fresh) byId.set(id, fresh)
    if (r.licenceKind && r.licenceStatus && (r.licenceExpiry || r.licenceStatus !== 'granted' || r.licenceNumber)) {
      const mine = await db.select().from(licences).where(eq(licences.rentalId, id))
      const dup = mine.some((l) => (r.licenceNumber && l.number?.toUpperCase() === r.licenceNumber.toUpperCase()) || (r.licenceExpiry && l.expiresOn === r.licenceExpiry) || (r.licenceStatus === 'applied' && l.status === 'applied' && l.appliedOn === r.appliedOn))
      if (!dup) await db.insert(licences).values({
        id: uid(), rentalId: id, kind: r.licenceKind, council: area.council ?? fresh?.council ?? null, number: r.licenceNumber, status: r.licenceStatus ?? 'granted',
        startsOn: r.licenceStatus === 'applied' ? null : r.licenceStart, expiresOn: r.licenceStatus === 'applied' ? null : r.licenceExpiry, appliedOn: r.licenceStatus === 'applied' ? r.appliedOn ?? r.licenceStart : null,
        notes: 'Imported from spreadsheet', createdBy: me.id, createdAt: now(), updatedAt: now(),
      })
    }
  }
  await audit(me.id, 'rental_import', 'rental', 'import', `${added} added, ${updated} updated${joined ? `, ${joined} joined to Rentman` : ''}`)
  // Then everything else happens on its own: postcodes, wards, EPCs, emails, council registers.
  after(async () => { const { fillInEverything } = await import('@/lib/licensing'); await fillInEverything(me.id) })
  done()
  const tracked = (await db.select({ id: rentals.id }).from(rentals).where(eq(rentals.archived, false))).length
  return { added, updated, skipped, joined, tracked }
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
