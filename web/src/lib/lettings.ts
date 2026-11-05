import 'server-only'
import { and, eq, gte, inArray, isNotNull, or } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, properties } from '@/db/schema'
import { fmtPostcode, positionOf, positionsOf } from './postcode-geo'

// The rent estimate on the Landlords page: the official average for the borough (ONS Price Index of Private
// Rents) and what we've let nearby. No made-up figures: where neither is known, we say so and offer a visit.

/**
 * Average monthly private rents by borough, from the ONS "Housing prices in your area" pages (Price Index of
 * Private Rents). Update when ONS publishes new figures (monthly); `beds` holds only figures ONS publishes.
 */
export const ONS_RENTS: Record<string, { name: string; month: string; all: number; beds: Partial<Record<1 | 2 | 3 | 4, number>>; url: string }> = {
  harrow: { name: 'Harrow', month: 'September 2026', all: 1781, beds: { 2: 1718, 3: 2069, 4: 2795 }, url: 'https://www.ons.gov.uk/visualisations/housingpriceslocal/E09000015/' },
  brent: { name: 'Brent', month: 'August 2026', all: 2014, beds: {}, url: 'https://www.ons.gov.uk/visualisations/housingpriceslocal/E09000005/' },
}

// When postcodes.io can't be reached: districts that sit (almost) entirely in one borough.
const DISTRICT_BOROUGH: Record<string, string> = { HA0: 'brent', HA9: 'brent', NW10: 'brent', HA1: 'harrow', HA2: 'harrow', HA5: 'harrow' }

async function boroughOf(postcode: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}?filter=admin_district`, { signal: AbortSignal.timeout(3000) })
    if (r.ok) {
      const d = ((await r.json()) as { result?: { admin_district?: string } }).result?.admin_district
      if (d) return d.toLowerCase()
    }
  } catch { /* fall back below */ }
  return DISTRICT_BOROUGH[postcode.split(' ')[0]] ?? null
}

const pcm = (price: number, freq: string | null) => Math.round(freq === 'pw' ? (price * 52) / 12 : freq === 'pa' ? price / 12 : price)
const round25 = (n: number) => Math.round(n / 25) * 25

export type RentEstimate = {
  postcode: string
  beds: number
  borough: string | null
  ons: { name: string; month: string; figure: number; forBeds: boolean; url: string } | null
  nearby: { area: string; beds: number; rent: number; status: string; km: number }[]
  range: [number, number] | null
  basis: 'nearby' | 'ons' | null
}

/** A rent range for a home of `beds` bedrooms at `postcode`, and the evidence behind it. */
export async function rentEstimate(rawPostcode: string, beds: number): Promise<RentEstimate | null> {
  await ready()
  const postcode = fmtPostcode(rawPostcode)
  if (!/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(postcode)) return null
  const b = Math.min(Math.max(Math.round(beds) || 1, 0), 6)
  const [here, borough] = await Promise.all([positionOf(postcode), boroughOf(postcode)])

  // Homes we've let (or are letting) within 2 km, same size first.
  const lets = await db.select({ street: properties.street, town: properties.town, postcode: properties.postcode, bedrooms: properties.bedrooms, price: properties.price, rentFrequency: properties.rentFrequency, status: properties.status })
    .from(properties).where(and(eq(properties.channel, 'let'), isNotNull(properties.price), isNotNull(properties.postcode), isNotNull(properties.bedrooms)))
  const pos = await positionsOf([...new Set(lets.map((l) => fmtPostcode(l.postcode!)))])
  const nearby = here ? lets.map((l) => {
    const p = pos.get(fmtPostcode(l.postcode!))
    const km = p ? Math.hypot(p.e - here.e, p.n - here.n) / 1000 : Infinity
    return { area: [l.street, l.town].filter(Boolean).join(', ') || fmtPostcode(l.postcode!).split(' ')[0], beds: l.bedrooms!, rent: pcm(l.price!, l.rentFrequency), status: l.status, km: Math.round(km * 10) / 10 }
  }).filter((l) => l.km <= 2 && l.rent > 300 && l.rent < 20000) : []
  const same = nearby.filter((l) => l.beds === b).sort((x, y) => x.km - y.km)
  const shown = [...same, ...nearby.filter((l) => l.beds !== b).sort((x, y) => Math.abs(x.beds - b) - Math.abs(y.beds - b) || x.km - y.km)].slice(0, 6)

  const table = borough ? ONS_RENTS[borough] : undefined
  const bedFigure = table ? table.beds[Math.min(Math.max(b, 1), 4) as 1 | 2 | 3 | 4] : undefined
  const ons = table ? { name: table.name, month: table.month, figure: bedFigure ?? table.all, forBeds: !!bedFigure, url: table.url } : null

  let range: [number, number] | null = null, basis: RentEstimate['basis'] = null
  if (same.length >= 3) {
    const rents = same.slice(0, 8).map((l) => l.rent).sort((x, y) => x - y)
    const mid = rents[Math.floor(rents.length / 2)]
    range = [round25(Math.min(rents[0], mid * 0.93)), round25(Math.max(rents[rents.length - 1], mid * 1.07))]
    basis = 'nearby'
  } else if (ons?.forBeds) {
    range = [round25(ons.figure * 0.9), round25(ons.figure * 1.1)]
    basis = 'ons'
  }
  return { postcode, beds: b, borough, ons, nearby: shown, range, basis }
}

/** How many people asked us about homes to rent in the last 30 days (website, portals and email). */
export async function tenantDemand(): Promise<number> {
  await ready()
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const letIds = (await db.select({ id: properties.id }).from(properties).where(eq(properties.channel, 'let'))).map((p) => p.id)
  const rows = await db.select({ contactId: enquiries.contactId, id: enquiries.id }).from(enquiries)
    .where(and(gte(enquiries.createdAt, since), or(eq(enquiries.intent, 'rent'), letIds.length ? inArray(enquiries.propertyId, letIds) : undefined)))
  return new Set(rows.map((r) => r.contactId ?? r.id)).size
}
