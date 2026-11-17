'use server'

import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { windowCards } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { DESCRIPTION_MAX, HEADLINE_MAX, MAX_HIGHLIGHTS, MAX_PHOTOS, type CardData } from '@/lib/window-card'
import { now } from '@/lib/util'

const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)))

/** Saves what staff changed on a property's display sheet. */
export async function saveWindowCard(propertyId: string, d: CardData): Promise<{ ok?: boolean; error?: string }> {
  const me = await requireAdmin()
  await ready()
  const data: CardData = {
    theme: (['blue', 'green', 'red', 'black'] as const).includes(d.theme) ? d.theme : 'blue',
    layout: d.layout === 'landscape' ? 'landscape' : 'portrait',
    paper: d.paper === 'a3' ? 'a3' : 'a4',
    margin: d.margin === 'none' ? 'none' : 'office',
    badge: (['auto', 'none', 'just-listed', 'new-instruction', 'reduced', 'custom'] as const).includes(d.badge) ? d.badge : 'auto',
    badgeText: String(d.badgeText ?? '').slice(0, 28),
    headline: String(d.headline ?? '').slice(0, HEADLINE_MAX + 20),
    description: String(d.description ?? '').slice(0, DESCRIPTION_MAX + 100),
    highlights: (d.highlights ?? []).map((h) => String(h).slice(0, 60)).slice(0, MAX_HIGHLIGHTS),
    photos: (d.photos ?? []).slice(0, MAX_PHOTOS).map((p) => ({ id: String(p.id), x: clamp(p.x), y: clamp(p.y) })),
    showQr: !!d.showQr,
  }
  await db.insert(windowCards).values({ propertyId, data: JSON.stringify(data), updatedBy: me.id, updatedAt: now() })
    .onConflictDoUpdate({ target: windowCards.propertyId, set: { data: JSON.stringify(data), updatedBy: me.id, updatedAt: now() } })
  return { ok: true }
}

/** Back to what the listing says. */
export async function resetWindowCard(propertyId: string): Promise<{ ok: boolean }> {
  await requireAdmin()
  await ready()
  await db.delete(windowCards).where(eq(windowCards.propertyId, propertyId))
  return { ok: true }
}
