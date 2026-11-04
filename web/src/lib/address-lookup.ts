import 'server-only'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { addressCache, soldPrices } from '@/db/schema'
import { now } from '@/lib/util'

// Address finder for the valuation form. With an Ideal Postcodes key (IDEAL_POSTCODES_KEY) it returns every
// address on the postcode from Royal Mail's list; without one it falls back to the homes on that postcode
// that have sold in the last few years (HM Land Registry). Results are kept so each postcode is paid for once.

const KEEP_DAYS = { paf: 180, 'land-registry': 7 } as const
export type AddressResult = { source: 'paf' | 'land-registry' | 'none'; addresses: string[] }

const title = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Of|And|The)\b/g, (w) => w.toLowerCase())
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

async function fromLandRegistry(pc: string): Promise<string[]> {
  const rows = await db.selectDistinct({ saon: soldPrices.saon, paon: soldPrices.paon, street: soldPrices.street }).from(soldPrices).where(eq(soldPrices.postcode, pc))
  const lines = rows.map((r) => {
    const paon = r.paon ? title(r.paon) : ''
    const first = /^\d/.test(paon) && r.street ? `${paon} ${r.street}` : [paon, r.street].filter(Boolean).join(', ')
    return [r.saon ? title(r.saon) : '', first].filter(Boolean).join(', ')
  })
  return [...new Set(lines.filter(Boolean))].sort(byNumber)
}

export async function lookupAddresses(postcode: string): Promise<AddressResult> {
  await ready()
  const pc = postcode.toUpperCase().trim().replace(/\s+/g, ' ')
  const cached = await db.query.addressCache.findFirst({ where: eq(addressCache.postcode, pc) })
  const wantPaf = !!process.env.IDEAL_POSTCODES_KEY
  if (cached) {
    const fresh = Date.now() - new Date(cached.fetchedAt).getTime() < KEEP_DAYS[cached.source as keyof typeof KEEP_DAYS] * 86400000
    // A Land Registry answer is replaced as soon as the full Royal Mail list is available.
    if (fresh && (cached.source === 'paf' || !wantPaf)) return { source: cached.source as AddressResult['source'], addresses: JSON.parse(cached.addresses) as string[] }
  }
  let source: AddressResult['source'] = 'paf'
  let addresses = await fromIdealPostcodes(pc).catch(() => null)
  if (!addresses?.length) { source = 'land-registry'; addresses = await fromLandRegistry(pc) }
  else addresses = addresses.sort(byNumber)
  if (addresses.length) {
    await db.insert(addressCache).values({ postcode: pc, source, addresses: JSON.stringify(addresses), fetchedAt: now() })
      .onConflictDoUpdate({ target: addressCache.postcode, set: { source, addresses: JSON.stringify(addresses), fetchedAt: now() } })
  }
  return { source: addresses.length ? source : 'none', addresses }
}
