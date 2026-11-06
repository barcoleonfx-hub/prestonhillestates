import 'server-only'
import { rentEstimate } from './lettings'
import { salesNear, type PublicSale } from './sold-prices'

export type LrEstimate = { low: number; mid: number; high: number; count: number; where: string; typed: boolean; comps: PublicSale[] }
export type RentCheck = { low: number; mid: number; high: number; count: number; basis: string; nearby: { area: string; beds: number; rent: number; km: number }[] }

const quart = (s: number[], q: number) => { const i = (s.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) }
const r5k = (n: number) => Math.round(n / 5000) * 5000

/**
 * A sales estimate from HM Land Registry: the nearest sales of the same kind of home in the last two years
 * (closest first, widening until there are enough), as the middle half of their prices. Land Registry doesn't
 * record bedrooms or size, so this is a starting point for staff, never the valuation itself.
 */
export async function landRegistryEstimate(postcode: string, type: 'F' | 'T' | 'S' | 'D' | null): Promise<LrEstimate | null> {
  const near = await salesNear(postcode, { type: type ?? null, limit: 16 }).catch(() => null)
  const comps = near?.recent ?? []
  if (comps.length < 3) return null
  const s = comps.map((c) => c.price).sort((a, b) => a - b)
  return { low: r5k(quart(s, 0.25)), mid: r5k(quart(s, 0.5)), high: r5k(quart(s, 0.75)), count: comps.length, where: near!.where, typed: !!near!.typed, comps }
}

/** A rent estimate: our own lets nearby of the same size, or the official figures for the borough. */
export async function rentCheck(postcode: string, beds: number | null): Promise<RentCheck | null> {
  const r = await rentEstimate(postcode, beds ?? 2).catch(() => null)
  if (!r?.range) return null
  const [low, high] = r.range
  return {
    low, high, mid: Math.round((low + high) / 2 / 25) * 25, count: r.nearby.length,
    basis: r.basis === 'nearby' ? 'homes we’ve let nearby' : `official rents for ${r.ons?.name ?? 'the borough'}`,
    nearby: r.nearby.map((n) => ({ area: n.area, beds: n.beds, rent: n.rent, km: n.km })),
  }
}
