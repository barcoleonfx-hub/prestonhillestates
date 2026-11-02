import { NextResponse } from 'next/server'
import { asc, and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { media } from '@/db/schema'
import { displayAddressFor, headlineFor, listPublished, priceLabel, slugFor, statusLabel, withUrl } from '@/lib/properties'

export const dynamic = 'force-dynamic'

/** Published listings as JSON, for the website and any other channel that needs them. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const rows = await listPublished({
    channel: sp.get('channel') || undefined,
    q: sp.get('q') || undefined,
    minBeds: Number(sp.get('beds')) || undefined,
    maxPrice: Number(sp.get('max')) || undefined,
    type: sp.get('type') || undefined,
    sort: sp.get('sort') || undefined,
  })
  const ids = rows.map((r) => r.id)
  const allMedia = ids.length
    ? await db.query.media.findMany({
        where: and(inArray(media.propertyId, ids), eq(media.status, 'ready')),
        orderBy: [asc(media.kind), asc(media.position)],
      })
    : []
  const origin = new URL(req.url).origin
  const abs = (u: string) => (u.startsWith('http') ? u : origin + u)

  const properties = rows.map((p) => {
    const mine = allMedia.filter((m) => m.propertyId === p.id).map(withUrl)
    const photos = mine.filter((m) => m.kind === 'photo').sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.position - b.position)
    return {
      ref: p.ref,
      url: `${origin}/properties/${slugFor(p)}`,
      channel: p.channel,
      status: p.status,
      statusLabel: statusLabel(p.status),
      featured: p.featured,
      headline: headlineFor(p),
      displayAddress: displayAddressFor(p),
      town: p.town,
      outcode: (p.postcode || '').split(' ')[0] || null,
      price: p.price,
      priceLabel: priceLabel(p),
      propertyType: p.propertyType,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      receptions: p.receptions,
      summary: p.summary,
      keyFeatures: p.keyFeatures ?? [],
      photos: photos.map((m) => ({ url: abs(m.url), caption: m.caption })),
      floorplans: mine.filter((m) => m.kind === 'floorplan').map((m) => ({ url: abs(m.url), caption: m.caption })),
      videos: mine.filter((m) => m.kind === 'video').map((m) => ({ url: abs(m.url) })),
      videoUrl: p.videoUrl,
      virtualTourUrl: p.virtualTourUrl,
      publishedAt: p.publishedAt,
      updatedAt: p.updatedAt,
    }
  })
  return NextResponse.json({ count: properties.length, properties }, { headers: { 'Cache-Control': 'public, max-age=60' } })
}
