import 'server-only'
import { rentEstimate } from './lettings'
import { displayAddressFor, listPublished, priceLabel, slugFor } from './properties'
import { salesNear } from './sold-prices'

/**
 * The instant estimate a seller or landlord sees on the website once they've asked for a valuation.
 * Sales: the middle half of what the nearest homes of the same kind sold for in the last two years (HM Land
 * Registry). Lettings: our lets nearby of the same size, or the official rents for the borough.
 * The check against homes on the market uses our own listings. A partner's asking-price feed (OnTheMarket has
 * agreed in principle) would add to `onMarket` here, once they give us one.
 */
export type InstantEstimate = {
  kind: 'sale' | 'rent'
  low: number
  high: number
  basis: string
  onMarket: { address: string; price: string; beds: number | null; url: string }[]
}

const quart = (s: number[], q: number) => { const i = (s.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) }
const r5k = (n: number) => Math.round(n / 5000) * 5000
const bedsOf = (b: string) => (/studio/i.test(b) ? 0 : Number.parseInt(b, 10) || null)

export async function instantEstimate(i: { postcode: string; intent: string; propertyType: string; bedrooms: string; address: string }): Promise<InstantEstimate | null> {
  const pc = i.postcode.toUpperCase().trim().replace(/\s+/g, ' ')
  const beds = bedsOf(i.bedrooms)
  const flat = /flat|maisonette|apartment|studio/i.test(i.propertyType)
  const house = /house|bungalow/i.test(i.propertyType)
  const outward = pc.split(' ')[0]
  const rent = i.intent === 'letting'

  // Our own listings like theirs, in the same postcode district.
  const listings = (await listPublished({ channel: rent ? 'let' : 'sale' }).catch(() => []))
    .filter((p) => p.status === 'available' && (p.postcode ?? '').toUpperCase().startsWith(`${outward} `))
    .filter((p) => beds == null || p.bedrooms == null || Math.abs(p.bedrooms - beds) <= 1)
    .filter((p) => !flat && !house ? true : flat ? /flat|maisonette|studio|apartment/.test(p.propertyType ?? '') : !/flat|maisonette|studio|apartment/.test(p.propertyType ?? ''))
    .slice(0, 3)
    .map((p) => ({ address: displayAddressFor(p), price: priceLabel(p), beds: p.bedrooms, url: `/properties/${slugFor(p)}` }))

  if (rent) {
    const r = await rentEstimate(pc, beds ?? 2).catch(() => null)
    if (!r?.range) return null
    return { kind: 'rent', low: r.range[0], high: r.range[1], basis: r.basis === 'nearby' ? `${beds ?? 2} bedroom homes we’ve let nearby` : `official figures for ${beds ?? 2} bedroom homes in ${r.ons?.name ?? 'the borough'}`, onMarket: listings }
  }
  const street = (i.address.split(',').map((x) => x.trim()).reverse().find((x) => /[a-z]{3,}/i.test(x) && !/^(flat|apartment|unit)\b/i.test(x)) ?? '').replace(/^\d+[a-z]?\s+/i, '') || null
  const near = await salesNear(pc, { type: flat ? 'F' : house ? 'H' : null, limit: 16, street }).catch(() => null)
  const prices = (near?.recent ?? []).map((s) => s.price).sort((a, b) => a - b)
  if (prices.length < 4) return null
  const what = near!.typed ? (flat ? 'flats and maisonettes' : 'houses') : 'homes'
  return { kind: 'sale', low: r5k(quart(prices, 0.25)), high: r5k(quart(prices, 0.75)), basis: `${prices.length} ${what} sold ${near!.where} in the last two years`, onMarket: listings }
}
