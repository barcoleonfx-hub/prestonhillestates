import 'server-only'
import { and, desc, eq, gte, inArray, isNotNull, like, ne, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, media, properties, soldPrices } from '@/db/schema'
import { cached } from './lookup-cache'
import { metresBetween, osgbToLatLon, type LatLon } from './geo'
import { fmtPostcode, positionsOf } from './postcode-geo'
import { displayAddressFor, priceLabel, withUrl } from './properties'

// A home's own story, from public records and our own files:
//  - every sale since 1995 (HM Land Registry Price Paid, via its free linked-data API, kept for 30 days);
//  - its energy certificates (the EPC register; only if an EPC key is set: EPC_API_EMAIL and EPC_API_KEY);
//  - sales on its street in the last three years (our copy of Land Registry's data);
//  - how many people asked us about homes nearby lately, and homes we've sold or let nearby.

export type HomeAddress = { saon: string | null; paon: string | null; street: string | null }
export type Sale = { date: string; price: number; tenure: string | null; newBuild: boolean; type: string | null }
export type Epc = { date: string; rating: string | null; potential: string | null; floorArea: number | null; ageBand: string | null; extensions: number | null; rooms: number | null; propertyType: string | null }

const up = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** "Flat 2, 12 Carlton Avenue East, Wembley" → { saon: "FLAT 2", paon: "12", street: "CARLTON AVENUE EAST" }. */
export function parseHomeAddress(address: string | null): HomeAddress | null {
  if (!address) return null
  const parts = address.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, '').split(',').map((s) => s.trim()).filter(Boolean)
  let saon: string | null = null
  if (parts[0] && /^(flat|apartment|apt|unit|maisonette)\b/i.test(parts[0]) && !/\d+[a-z]?\s+\D/i.test(parts[0].replace(/^(flat|apartment|apt|unit|maisonette)\s+\w+/i, ''))) saon = up(parts.shift()!)
  const first = parts[0] ?? ''
  const m = /^((?:flat|apartment|apt|unit)\s+\w+\s*,?\s*)?(\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?)\s+(.+)$/i.exec(first)
  if (m) return { saon: saon ?? (m[1] ? up(m[1]) : null), paon: up(m[2]), street: up(m[3]) }
  // A named house: "Rose Cottage, Uxendon Hill".
  return parts.length >= 2 ? { saon, paon: up(first), street: up(parts[1]) } : null
}

const sameHome = (a: HomeAddress, paon: string | null, saon: string | null) => {
  if (up(paon) !== a.paon) return false
  if (!a.saon) return !saon
  // Compare the flat's own number or name: "FLAT 3 WOODCOCK COURT" and "FLAT 3" are the same flat.
  const n = (s: string | null) => up(s).replace(/^(FLAT|APARTMENT|APT|UNIT|MAISONETTE)\s+/, '').split(' ')[0]
  return n(saon) === n(a.saon)
}

type LrItem = { pricePaid?: number; transactionDate?: string; newBuild?: boolean; estateType?: { label?: { _value?: string }[] | { _value?: string } }; propertyType?: { label?: { _value?: string }[] | { _value?: string } }; propertyAddress?: { paon?: string; saon?: string; street?: string } }
const label = (l: LrItem['estateType']) => { const v = Array.isArray(l?.label) ? l?.label[0]?._value : (l?.label as { _value?: string } | undefined)?._value; return v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : null }
const isoDate = (s: string | undefined) => { if (!s) return null; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : `${s} 12:00 UTC`); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) }

/** Land Registry's linked-data answer for one postcode: every recorded sale, as plain rows. */
export function parseLandRegistry(body: { result?: { items?: LrItem[] } }) {
  return (body.result?.items ?? []).map((i) => ({
    date: isoDate(i.transactionDate), price: Number(i.pricePaid) || 0, newBuild: !!i.newBuild, tenure: label(i.estateType), type: label(i.propertyType),
    paon: i.propertyAddress?.paon ?? null, saon: i.propertyAddress?.saon ?? null, street: i.propertyAddress?.street ?? null,
  })).filter((r): r is typeof r & { date: string } => !!r.date && r.price > 0)
}

async function landRegistryPostcode(postcode: string) {
  const url = `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${encodeURIComponent(postcode)}&_pageSize=200`
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`Land Registry answered ${res.status}`)
  return parseLandRegistry((await res.json()) as { result?: { items?: LrItem[] } })
}

/** Every sale of this home on record: Land Registry back to 1995, plus our own copy of the latest months. */
export async function saleHistory(postcode: string, home: HomeAddress): Promise<{ sales: Sale[]; error: string | null }> {
  const r = await cached(`lr-sales:${postcode}`, 30, () => landRegistryPostcode(postcode))
  const fromLr = (r.data ?? []).filter((s) => sameHome(home, s.paon, s.saon))
  await ready()
  const local = await db.select().from(soldPrices).where(and(eq(soldPrices.postcode, postcode), eq(sql`upper(${soldPrices.paon})`, home.paon ?? '')))
  const all = [...fromLr.map((s) => ({ date: s.date, price: s.price, tenure: s.tenure, newBuild: s.newBuild, type: s.type })),
    ...local.filter((s) => sameHome(home, s.paon, s.saon)).map((s) => ({ date: s.soldOn, price: s.price, tenure: s.tenure === 'F' ? 'Freehold' : s.tenure === 'L' ? 'Leasehold' : null, newBuild: s.newBuild, type: null }))]
  const seen = new Set<string>()
  const sales = all.filter((s) => { const k = `${s.date}|${s.price}`; if (seen.has(k)) return false; seen.add(k); return true }).sort((a, b) => a.date.localeCompare(b.date))
  return { sales, error: r.error }
}

type EpcRow = Record<string, string | undefined>
/** The EPC register's answer for one postcode, as plain rows. */
export function parseEpc(body: { rows?: EpcRow[] }): (Epc & { address: string })[] {
  const num = (v: string | undefined) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null }
  return (body.rows ?? []).map((r) => ({
    address: [r.address1, r.address2, r.address3].filter(Boolean).join(', ') || r.address || '',
    date: (r['lodgement-date'] ?? r['inspection-date'] ?? '').slice(0, 10), rating: r['current-energy-rating'] || null, potential: r['potential-energy-rating'] || null,
    floorArea: num(r['total-floor-area']), ageBand: r['construction-age-band'] && !/^(NO DATA|INVALID)/i.test(r['construction-age-band']) ? r['construction-age-band'].replace(/^England and Wales:\s*/i, '') : null,
    extensions: num(r['extension-count']), rooms: num(r['number-habitable-rooms']), propertyType: r['property-type'] || null,
  })).filter((e) => e.date)
}

export const epcConfigured = () => !!(process.env.EPC_API_EMAIL && process.env.EPC_API_KEY)

async function epcPostcode(postcode: string) {
  const auth = Buffer.from(`${process.env.EPC_API_EMAIL}:${process.env.EPC_API_KEY}`).toString('base64')
  const res = await fetch(`https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(postcode.replace(/\s+/g, ''))}&size=200`, {
    headers: { Accept: 'application/json', Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(12_000),
  })
  if (res.status === 204) return []
  if (!res.ok) throw new Error(`The EPC register answered ${res.status}`)
  return parseEpc((await res.json()) as { rows?: EpcRow[] })
}

/** This home's energy certificates, oldest first (empty without an EPC key). */
export async function epcHistory(postcode: string, home: HomeAddress): Promise<{ certs: Epc[]; error: string | null }> {
  if (!epcConfigured()) return { certs: [], error: 'no EPC key set' }
  const r = await cached(`epc:${postcode}`, 30, () => epcPostcode(postcode))
  const mine = (r.data ?? []).filter((e) => {
    const a = up(e.address)
    const flat = home.saon?.replace(/^(FLAT|APARTMENT|APT|UNIT|MAISONETTE)\s+/, '')
    return new RegExp(`(^|\\s)${home.paon?.replace(/[^A-Z0-9 ]/g, '')}\\s`).test(a) && (!flat || new RegExp(`(FLAT|APARTMENT|UNIT)?\\s*${flat}\\b`).test(a))
  })
  return { certs: mine.map(({ address: _a, ...e }) => e).sort((a, b) => a.date.localeCompare(b.date)), error: r.error }
}

/** Sales on the same street (same postcode district) in our copy of Land Registry's data: the last three years. */
export async function streetRecord(postcode: string, street: string | null) {
  if (!street) return null
  await ready()
  const out = postcode.split(' ')[0]
  const rows = await db.select({ price: soldPrices.price, soldOn: soldPrices.soldOn, paon: soldPrices.paon }).from(soldPrices)
    .where(and(eq(soldPrices.outward, out), eq(sql`upper(${soldPrices.street})`, street))).orderBy(desc(soldPrices.soldOn))
  if (!rows.length) return null
  return { count: rows.length, highest: Math.max(...rows.map((r) => r.price)), latest: { price: rows[0].price, date: rows[0].soldOn }, since: rows[rows.length - 1].soldOn }
}

/** How many people asked us about homes to buy (or rent) in this postcode district in the last 90 days. */
export async function demandNear(postcode: string, rent: boolean): Promise<{ district: number; all: number }> {
  await ready()
  const since = new Date(Date.now() - 90 * 86400_000).toISOString()
  const out = postcode.split(' ')[0]
  const rows = await db.select({ email: enquiries.email, phone: enquiries.phone, contactId: enquiries.contactId, pc: properties.postcode }).from(enquiries)
    .innerJoin(properties, eq(enquiries.propertyId, properties.id))
    .where(and(gte(enquiries.createdAt, since), eq(properties.channel, rent ? 'let' : 'sale'), ne(enquiries.kind, 'valuation')))
  const who = (r: (typeof rows)[number]) => r.contactId ?? r.email ?? r.phone ?? Math.random().toString()
  return { district: new Set(rows.filter((r) => (r.pc ?? '').toUpperCase().startsWith(`${out} `)).map(who)).size, all: new Set(rows.map(who)).size }
}

export type OurHome = { id: string; address: string; price: string; status: string; photo: string | null; metres: number }
/** Homes we've sold or let (or agreed) within about a mile, nearest first. */
export async function ourHomesNear(home: LatLon, rent: boolean, limit = 3): Promise<OurHome[]> {
  await ready()
  const done = rent ? ['let_agreed', 'let'] : ['under_offer', 'sold_stc', 'sold']
  const rows = await db.select().from(properties).where(and(eq(properties.channel, rent ? 'let' : 'sale'), inArray(properties.status, done), isNotNull(properties.postcode)))
  if (!rows.length) return []
  const pos = await positionsOf([...new Set(rows.map((r) => fmtPostcode(r.postcode!)))])
  const near = rows.map((r) => { const p = pos.get(fmtPostcode(r.postcode!)); return { r, metres: p ? metresBetween(home, osgbToLatLon(p.e, p.n)) : Infinity } })
    .filter((x) => x.metres <= 1800).sort((a, b) => a.metres - b.metres).slice(0, limit)
  const photos = near.length ? await db.select().from(media).where(and(inArray(media.propertyId, near.map((x) => x.r.id)), like(media.contentType, 'image/%'))).orderBy(desc(media.isCover), media.position) : []
  const label: Record<string, string> = { under_offer: 'Under offer', sold_stc: 'Sold STC', sold: 'Sold', let_agreed: 'Let agreed', let: 'Let' }
  return near.map(({ r, metres }) => {
    const ph = photos.find((m) => m.propertyId === r.id && m.kind === 'photo') ?? photos.find((m) => m.propertyId === r.id)
    return { id: r.id, address: displayAddressFor(r), price: priceLabel(r), status: label[r.status] ?? r.status, photo: ph ? withUrl(ph).url : null, metres: Math.round(metres) }
  })
}
