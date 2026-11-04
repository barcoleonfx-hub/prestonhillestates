import 'server-only'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { addressCache, knownAddresses, soldPrices } from '@/db/schema'
import { addressLine } from '@/lib/sold-prices'
import { now } from '@/lib/util'

// Address finder for the valuation form. With an Ideal Postcodes key (IDEAL_POSTCODES_KEY) it returns every
// address on the postcode from Royal Mail's list; without one it falls back to the homes on that postcode
// that have sold in the last few years (HM Land Registry). Results are kept so each postcode is paid for once.

const KEEP_DAYS = { paf: 180 } as const
export type AddressResult = { source: 'paf' | 'land-registry' | 'none'; addresses: string[] }

/** By house number (the last number, e.g. 273 in "Flat 2, 273 Preston Road"), then flat number, then name. */
const byNumber = (a: string, b: string) => {
  const nums = (x: string) => (x.match(/\d+/g) ?? []).map(Number)
  const [na, nb] = [nums(a), nums(b)]
  const house = (n: number[]) => (n.length ? n[n.length - 1] : 1e9)
  return house(na) - house(nb) || (na.length > 1 ? na[0] : 0) - (nb.length > 1 ? nb[0] : 0) || a.localeCompare(b, 'en-GB', { numeric: true })
}

async function fromIdealPostcodes(pc: string): Promise<string[] | null> {
  const key = process.env.IDEAL_POSTCODES_KEY
  if (!key) return null
  const res = await fetch(`${process.env.IDEAL_POSTCODES_URL || 'https://api.ideal-postcodes.co.uk'}/v1/postcodes/${encodeURIComponent(pc)}?api_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) })
  if (res.status === 404) return []
  if (!res.ok) { console.error('address lookup failed', res.status, (await res.text().catch(() => '')).slice(0, 200)); return null }
  const body = (await res.json()) as { result?: { line_1?: string; line_2?: string; line_3?: string }[] }
  return (body.result ?? []).map((a) => [a.line_1, a.line_2, a.line_3].filter(Boolean).join(', ')).filter(Boolean)
}

/** Every home on the postcode that has sold since 1995, from Land Registry (recent years plus the archive). */
async function fromLandRegistry(pc: string): Promise<string[]> {
  const [recent, archive] = await Promise.all([
    db.selectDistinct({ saon: soldPrices.saon, paon: soldPrices.paon, street: soldPrices.street }).from(soldPrices).where(eq(soldPrices.postcode, pc)),
    db.select({ line: knownAddresses.line }).from(knownAddresses).where(eq(knownAddresses.postcode, pc)),
  ])
  const lines = [...recent.map((r) => addressLine(r.saon, r.paon, r.street)), ...archive.map((r) => r.line)]
  // The same home can be written slightly differently over the years; compare without punctuation and case.
  const seen = new Map<string, string>()
  for (const l of lines.filter(Boolean)) { const k = l.toLowerCase().replace(/[^a-z0-9]/g, ''); if (!seen.has(k)) seen.set(k, l) }
  return [...seen.values()].sort(byNumber)
}

export async function lookupAddresses(postcode: string): Promise<AddressResult> {
  await ready()
  const pc = postcode.toUpperCase().trim().replace(/\s+/g, ' ')
  // Only the paid Royal Mail answers are remembered (to avoid paying twice). The Land Registry list is a quick
  // look-up in our own database, so it's always read fresh and grows as the archive loads.
  if (process.env.IDEAL_POSTCODES_KEY) {
    const cached = await db.query.addressCache.findFirst({ where: eq(addressCache.postcode, pc) })
    if (cached?.source === 'paf' && Date.now() - new Date(cached.fetchedAt).getTime() < KEEP_DAYS.paf * 86400000) return { source: 'paf', addresses: JSON.parse(cached.addresses) as string[] }
    const paf = await fromIdealPostcodes(pc).catch(() => null)
    if (paf?.length) {
      const sorted = paf.sort(byNumber)
      await db.insert(addressCache).values({ postcode: pc, source: 'paf', addresses: JSON.stringify(sorted), fetchedAt: now() })
        .onConflictDoUpdate({ target: addressCache.postcode, set: { source: 'paf', addresses: JSON.stringify(sorted), fetchedAt: now() } })
      return { source: 'paf', addresses: sorted }
    }
  }
  const addresses = await fromLandRegistry(pc)
  const source: AddressResult['source'] = 'land-registry'
  return { source: addresses.length ? source : 'none', addresses }
}
