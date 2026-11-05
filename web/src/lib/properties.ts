import 'server-only'
import { and, asc, desc, eq, gte, isNull, like, lte, or, sql, inArray } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { media, properties, rooms, type Media, type Property, type Room } from '@/db/schema'
import { storage } from './storage'
import { kebab, formatGBP } from './util'
import { PRICE_QUALIFIERS, PROPERTY_TYPES, RENT_FREQUENCIES, STATUSES, labelFor } from './options'

export type MediaItem = Media & { url: string }
export type FullProperty = Property & { media: MediaItem[]; rooms: Room[] }

export function withUrl(m: Media): MediaItem {
  return { ...m, url: storage().publicUrl(m.storageKey) }
}

export async function nextRef(): Promise<string> {
  await ready()
  const row = await db
    .select({ max: sql<number>`MAX(CAST(SUBSTR(${properties.ref}, 4) AS INTEGER))` })
    .from(properties)
    .where(like(properties.ref, 'PHE%'))
  return `PHE${(row[0]?.max ?? 1000) + 1}`
}

export async function getProperty(id: string): Promise<FullProperty | null> {
  await ready()
  const p = await db.query.properties.findFirst({ where: eq(properties.id, id) })
  if (!p) return null
  return attach(p)
}

export async function getPublishedByRef(ref: string): Promise<FullProperty | null> {
  await ready()
  const p = await db.query.properties.findFirst({
    where: and(eq(properties.ref, ref.toUpperCase()), eq(properties.published, true)),
  })
  if (!p) return null
  return attach(p, true)
}

async function attach(p: Property, readyOnly = false): Promise<FullProperty> {
  const [m, r] = await Promise.all([
    db.query.media.findMany({
      where: readyOnly ? and(eq(media.propertyId, p.id), eq(media.status, 'ready')) : eq(media.propertyId, p.id),
      orderBy: [asc(media.kind), desc(media.isCover), asc(media.position), asc(media.createdAt)],
    }),
    db.query.rooms.findMany({ where: eq(rooms.propertyId, p.id), orderBy: [asc(rooms.position)] }),
  ])
  return { ...p, media: m.map(withUrl), rooms: r }
}

/** The cover photo for each property, keyed by property id. */
export async function coversFor(ids: string[]): Promise<Record<string, MediaItem>> {
  if (!ids.length) return {}
  const rows = await db.query.media.findMany({
    where: and(inArray(media.propertyId, ids), eq(media.kind, 'photo'), eq(media.status, 'ready')),
    orderBy: [desc(media.isCover), asc(media.position), asc(media.createdAt)],
  })
  const out: Record<string, MediaItem> = {}
  for (const m of rows) if (!out[m.propertyId]) out[m.propertyId] = withUrl(m)
  return out
}

export type AdminFilters = { q?: string; channel?: string; status?: string; published?: string }

export async function listForAdmin(f: AdminFilters) {
  await ready()
  const conds = []
  if (f.q) {
    const q = `%${f.q.trim()}%`
    conds.push(or(like(properties.ref, q), like(properties.displayAddress, q), like(properties.postcode, q), like(properties.street, q)))
  }
  if (f.channel) conds.push(eq(properties.channel, f.channel))
  if (f.status) conds.push(eq(properties.status, f.status))
  if (f.published === 'live') conds.push(eq(properties.published, true))
  if (f.published === 'draft') conds.push(eq(properties.published, false))
  const rows = await db
    .select()
    .from(properties)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(properties.updatedAt))
  const covers = await coversFor(rows.map((r) => r.id))
  return rows.map((r) => ({ ...r, cover: covers[r.id] ?? null }))
}

export type PublicFilters = { channel?: string; q?: string; minBeds?: number; maxPrice?: number; type?: string; sort?: string; furnishing?: string; availableNow?: boolean }

export async function listPublished(f: PublicFilters) {
  await ready()
  const conds = [eq(properties.published, true)]
  if (f.channel === 'sale' || f.channel === 'let') conds.push(eq(properties.channel, f.channel))
  if (f.q) {
    const q = `%${f.q.trim()}%`
    conds.push(or(like(properties.displayAddress, q), like(properties.postcode, q), like(properties.town, q), like(properties.locality, q), like(properties.street, q))!)
  }
  if (f.minBeds) conds.push(gte(properties.bedrooms, f.minBeds))
  if (f.maxPrice) conds.push(lte(properties.price, f.maxPrice))
  if (f.type) conds.push(eq(properties.propertyType, f.type))
  // Homes to rent: furnished or not ("either way" homes count for both), and ones you can move into now.
  if (f.furnishing === 'furnished' || f.furnishing === 'unfurnished') conds.push(or(eq(properties.furnishing, f.furnishing), eq(properties.furnishing, 'flexible'), f.furnishing === 'furnished' ? eq(properties.furnishing, 'part_furnished') : undefined)!)
  if (f.availableNow) conds.push(or(isNull(properties.availableFrom), lte(properties.availableFrom, new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)))!)
  const order =
    f.sort === 'price_asc' ? [asc(properties.price)] : f.sort === 'price_desc' ? [desc(properties.price)] : [desc(properties.featured), desc(properties.publishedAt)]
  const rows = await db.select().from(properties).where(and(...conds)).orderBy(...order)
  const covers = await coversFor(rows.map((r) => r.id))
  return rows.map((r) => ({ ...r, cover: covers[r.id] ?? null }))
}

// ---------- display helpers ----------

export function priceLabel(p: Pick<Property, 'price' | 'priceQualifier' | 'channel' | 'rentFrequency'>): string {
  if (p.priceQualifier === 'poa') return 'Price on application'
  if (p.price == null) return 'Price to be confirmed'
  const amount = formatGBP(p.price)
  if (p.channel === 'let') return `${amount} ${p.rentFrequency || 'pcm'}`
  const q = p.priceQualifier && p.priceQualifier !== 'fixed_price' ? labelFor(PRICE_QUALIFIERS, p.priceQualifier) : ''
  return q ? `${q} ${amount}` : amount
}

export function statusLabel(status: string): string {
  return labelFor(STATUSES, status)
}

export function headlineFor(p: Pick<Property, 'headline' | 'bedrooms' | 'propertyType' | 'channel'>): string {
  if (p.headline) return p.headline
  const type = labelFor(PROPERTY_TYPES, p.propertyType) || 'Property'
  const beds = p.bedrooms ? `${p.bedrooms} bedroom ` : ''
  return `${beds}${type.toLowerCase()} ${p.channel === 'let' ? 'to rent' : 'for sale'}`.replace(/^./, (c) => c.toUpperCase())
}

export function displayAddressFor(p: Pick<Property, 'displayAddress' | 'street' | 'town' | 'postcode'>): string {
  if (p.displayAddress) return p.displayAddress
  const outward = (p.postcode || '').trim().split(/\s+/)[0]
  return [p.street, p.town, outward].filter(Boolean).join(', ')
}

export function slugFor(p: Pick<Property, 'ref' | 'displayAddress' | 'street' | 'town' | 'postcode'>): string {
  const tail = kebab(displayAddressFor(p))
  return tail ? `${p.ref.toLowerCase()}-${tail}` : p.ref.toLowerCase()
}

export function refFromSlug(slug: string): string {
  return slug.split('-')[0].toUpperCase()
}

export function rentFrequencyLabel(v: string | null) {
  return labelFor(RENT_FREQUENCIES, v)
}
