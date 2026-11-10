import 'server-only'
// "HA3 at a glance": how the market's doing (HM Land Registry) and how many people have been in touch with us
// looking to buy or rent there (our own enquiries). Real numbers only; a card with too little behind it isn't shown.

import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, properties, soldPrices } from '@/db/schema'
import { enquirySide, isValuation } from './enquiry-labels'
import { TYPE_LABEL, type PublicSale } from './sold-prices'

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10)
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }

export type Market = {
  districts: string[]
  sold12: number
  median12: number | null
  /** Change in the typical price on the 12 months before, when both years have enough sales to say. */
  change: number | null
  byType: { type: string; label: string; count: number; median: number | null }[]
}

/** The last 12 months of sales in these districts, against the 12 months before. */
export async function marketFor(districts: string[]): Promise<Market | null> {
  await ready()
  const rows = await db.select({ price: soldPrices.price, type: soldPrices.type, soldOn: soldPrices.soldOn }).from(soldPrices)
    .where(and(inArray(soldPrices.outward, districts), gte(soldPrices.soldOn, daysAgo(730))))
  const cut = daysAgo(365)
  const now = rows.filter((r) => r.soldOn >= cut), before = rows.filter((r) => r.soldOn < cut)
  if (now.length < 10) return null
  const m12 = median(now.map((r) => r.price)), mPrev = median(before.map((r) => r.price))
  // Like for like: a typical price moves with the mix of homes sold, so only say it when both years are well filled.
  const change = m12 && mPrev && now.length >= 30 && before.length >= 30 ? Math.round(((m12 - mPrev) / mPrev) * 1000) / 10 : null
  const byType = ['F', 'T', 'S', 'D'].map((t) => { const xs = now.filter((r) => r.type === t).map((r) => r.price); return { type: t, label: TYPE_LABEL[t], count: xs.length, median: median(xs) } }).filter((x) => x.count >= 3)
  return { districts, sold12: now.length, median12: m12, change, byType }
}

/** The newest sales in these districts, for the area pages. */
export async function recentSalesIn(districts: string[], limit = 8): Promise<PublicSale[]> {
  await ready()
  const rows = await db.select().from(soldPrices).where(inArray(soldPrices.outward, districts)).orderBy(desc(soldPrices.soldOn)).limit(limit)
  return rows.map((r) => ({ street: r.street, postcode: r.postcode, type: r.type, typeLabel: TYPE_LABEL[r.type] ?? 'Home', tenure: r.tenure, newBuild: r.newBuild, price: r.price, soldOn: r.soldOn }))
}

export type Demand = { total: number; months: number; groups: { key: string; label: string; count: number }[] }
/** Below this, "people looking" isn't shown: a small number says less than nothing. */
export const DEMAND_MIN = 20

/**
 * People who've been in touch with us in the last 12 months looking to buy (or rent) in these districts, each
 * counted once, by the size of home they asked about.
 */
export async function demandFor(districts: string[], rent: boolean): Promise<Demand> {
  await ready()
  const months = 12
  const since = new Date(Date.now() - months * 30.5 * 86400_000).toISOString()
  const rows = await db.select({ e: enquiries, channel: properties.channel, pc: properties.postcode, beds: properties.bedrooms, roles: contacts.roles }).from(enquiries)
    .leftJoin(properties, eq(enquiries.propertyId, properties.id)).leftJoin(contacts, eq(enquiries.contactId, contacts.id))
    .where(gte(enquiries.createdAt, since))
  const want = rent ? 'lettings' : 'sales'
  const inArea = (pc: string | null) => !!pc && districts.includes(pc.trim().toUpperCase().split(/\s+/)[0])
  const mine = rows.filter((r) => !isValuation(r.e) && enquirySide(r.e, r.channel, r.roles) === want && inArea(r.pc ?? r.e.postcode))
  const who = (r: (typeof rows)[number]) => r.e.contactId ?? r.e.email?.toLowerCase() ?? r.e.phone?.replace(/\D/g, '') ?? r.e.id
  // One person, one size: the biggest home they asked about.
  const size = new Map<string, number | null>()
  for (const r of mine) {
    const k = who(r), b = r.beds ?? null, had = size.get(k)
    size.set(k, had == null ? b : b == null ? had : Math.max(had, b))
  }
  const sizes = [...size.values()]
  const groups = [
    { key: 'studio', label: 'Studio', count: sizes.filter((b) => b === 0).length },
    { key: '1', label: '1 bed', count: sizes.filter((b) => b === 1).length },
    { key: '2', label: '2 bed', count: sizes.filter((b) => b === 2).length },
    { key: '3', label: '3+ bed', count: sizes.filter((b) => b != null && b >= 3).length },
    { key: 'any', label: 'Any size', count: sizes.filter((b) => b == null).length },
  ].filter((g) => g.count > 0)
  return { total: size.size, months, groups }
}
