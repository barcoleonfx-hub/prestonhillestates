import 'server-only'

// OnTheMarket as a backup for the website's instant estimate, with OnTheMarket's permission (they have no API):
// when HM Land Registry doesn't have enough sales near a postcode, we read one search on OnTheMarket (similar
// homes for sale, or to rent, within half a mile) and use their asking prices. One request per valuation
// request that needs it, cached for a day, identified as us. If the page can't be read, nothing is shown from it.

export type OtmResult = { url: string; status: number | null; via: string | null; prices: number[]; listings: { address: string | null; price: number; beds: number | null }[]; error?: string }

const cache = new Map<string, { at: number; r: OtmResult }>()
const DAY = 86400_000
const UA = 'Mozilla/5.0 (compatible; PrestonHillEstates/1.0; +https://www.prestonhillestates.com; valuation check with OnTheMarket permission)'

export function otmUrl(postcode: string, o: { rent: boolean; beds: number | null }) {
  const slug = postcode.toLowerCase().trim().replace(/\s+/g, '-')
  const beds = o.beds != null ? `&min-bedrooms=${o.beds}&max-bedrooms=${o.beds}` : ''
  return `https://www.onthemarket.com/${o.rent ? 'to-rent' : 'for-sale'}/property/${slug}/?radius=0.5${beds}`
}

const money = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  if (typeof v !== 'string') return null
  const m = /£?\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m)?/i.exec(v)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, '')) * (m[2]?.toLowerCase() === 'm' ? 1e6 : m[2]?.toLowerCase() === 'k' ? 1e3 : 1)
  return Number.isFinite(n) ? Math.round(n) : null
}
const sane = (n: number, rent: boolean) => (rent ? n >= 300 && n <= 20000 : n >= 50_000 && n <= 5_000_000)

/** Every object in a JSON tree that looks like a listing: it has a price, and usually an address or bedrooms. */
function walk(node: unknown, out: OtmResult['listings'], rent: boolean, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14 || out.length > 60) return
  if (Array.isArray(node)) { for (const x of node) walk(x, out, rent, depth + 1); return }
  const o = node as Record<string, unknown>
  const offers = o.offers as Record<string, unknown> | undefined
  const raw = offers?.price ?? o.price ?? o.priceValue ?? o.displayPrice ?? (o.pricing as Record<string, unknown> | undefined)?.price
  const price = money(raw)
  const beds = money(o.bedrooms ?? o.numberOfRooms ?? o.beds ?? (o.floorSize ? null : null))
  const addr = typeof o.address === 'string' ? o.address : typeof o['display-address'] === 'string' ? (o['display-address'] as string) : typeof o.displayAddress === 'string' ? o.displayAddress : typeof (o.address as Record<string, unknown> | undefined)?.streetAddress === 'string' ? (o.address as Record<string, string>).streetAddress : typeof o.name === 'string' ? o.name : null
  if (price && sane(price, rent) && (addr || beds != null)) out.push({ address: addr, price, beds: beds != null && beds < 20 ? beds : null })
  for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, out, rent, depth + 1)
}

/** Reads one OnTheMarket search: structured data first (JSON-LD, then the page's data), then the visible prices. */
export function parseOtm(html: string, rent: boolean): { via: string | null; listings: OtmResult['listings'] } {
  const found: OtmResult['listings'] = []
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1]), found, rent) } catch { /* not JSON */ } }
  if (found.length >= 3) return { via: 'structured data (JSON-LD)', listings: found }
  const data = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1]
  if (data) { try { const f: OtmResult['listings'] = []; walk(JSON.parse(data), f, rent); if (f.length >= 3) return { via: 'page data', listings: f } } catch { /* not JSON */ } }
  // Last resort: prices shown on the page, each with the text after it ("pcm" for rents).
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&pound;/g, '£').replace(/&nbsp;/g, ' ')
  const shown: OtmResult['listings'] = []
  for (const m of text.matchAll(/£\s?(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(pcm|pw|per month|per week)?/gi)) {
    let n = Number(m[1].replace(/,/g, ''))
    if (rent && /pw|per week/i.test(m[2] ?? '')) n = Math.round((n * 52) / 12)
    if (rent && !m[2]) continue
    if (sane(n, rent)) shown.push({ address: null, price: n, beds: null })
  }
  return shown.length >= 3 ? { via: 'prices shown on the page', listings: shown } : { via: null, listings: [] }
}

export async function otmAskingPrices(postcode: string, o: { rent: boolean; beds: number | null }): Promise<OtmResult> {
  const url = otmUrl(postcode, o)
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < DAY) return hit.r
  let r: OtmResult
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(5000), cache: 'no-store' })
    if (!res.ok) r = { url, status: res.status, via: null, prices: [], listings: [], error: `OnTheMarket answered ${res.status}` }
    else {
      const p = parseOtm(await res.text(), o.rent)
      // The same listing can appear twice (card and map); keep each price/address once.
      const seen = new Set<string>()
      const listings = p.listings.filter((l) => { const k = `${l.price}|${l.address ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 30)
      r = { url, status: res.status, via: p.via, prices: listings.map((l) => l.price), listings, ...(p.via ? {} : { error: 'Couldn’t find prices on the page' }) }
    }
  } catch (e) {
    r = { url, status: null, via: null, prices: [], listings: [], error: (e as Error).name === 'TimeoutError' ? 'OnTheMarket took too long to answer' : String((e as Error).message ?? e).slice(0, 120) }
  }
  cache.set(url, { at: Date.now(), r })
  if (r.error) console.warn('OnTheMarket check:', r.error, url)
  return r
}
