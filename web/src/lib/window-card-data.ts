import 'server-only'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { windowCards } from '@/db/schema'
import { EPC_RATINGS, FURNISHING, PROPERTY_TYPES, TENURES, labelFor } from './options'
import { displayAddressFor, getProperty, priceLabel, slugFor } from './properties'
import { knownBase } from './property-email-data'
import { mergeCard, type CardData, type CardProperty } from './window-card'

const label = (opts: Parameters<typeof labelFor>[0], v: string | null | undefined) => { const l = v ? labelFor(opts, v) : ''; return l && l !== '—' ? l : null }

/** Everything the display sheet editor needs for one property. */
export async function windowCardFor(id: string) {
  await ready()
  const p = await getProperty(id)
  if (!p) return null
  const photos = p.media.filter((m) => m.kind === 'photo' && m.status === 'ready').map((m) => ({ id: m.id, url: m.url, isCover: m.isCover, position: m.position }))
  const card: CardProperty = {
    ref: p.ref, channel: p.channel === 'let' ? 'let' : 'sale', status: p.status, headline: p.headline, summary: p.summary, description: p.description,
    keyFeatures: (p.keyFeatures as string[] | null) ?? [], bedrooms: p.bedrooms, bathrooms: p.bathrooms, receptions: p.receptions, floorAreaSqft: p.floorAreaSqft,
    typeLabel: label(PROPERTY_TYPES, p.propertyType), tenureLabel: label(TENURES, p.tenure), furnishingLabel: label(FURNISHING, p.furnishing),
    epc: label(EPC_RATINGS, p.epcCurrent), publishedAt: p.publishedAt, photos,
  }
  const row = await db.query.windowCards.findFirst({ where: eq(windowCards.propertyId, id) })
  let saved: Partial<CardData> | null = null
  try { saved = row ? (JSON.parse(row.data) as Partial<CardData>) : null } catch { saved = null }
  const base = await knownBase()
  return {
    id: p.id, card, data: mergeCard(card, saved), saved: !!row, address: displayAddressFor(p), price: priceLabel(p),
    url: p.published ? `${base}/properties/${slugFor(p)}` : null, published: p.published,
  }
}
export type WindowCardInput = NonNullable<Awaited<ReturnType<typeof windowCardFor>>>
