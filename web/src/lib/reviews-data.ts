import 'server-only'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { reviews, settings } from '@/db/schema'
import { REVIEWS, type Review } from './reviews'

// Reviews for the website: real ones, copied from Google in the portal. Only 4 and 5 stars are shown, always next
// to the overall Google rating and a link to every review, so the selection never misleads.

export type GoogleSummary = { rating: number | null; count: number | null; url: string | null }

export async function googleSummary(): Promise<GoogleSummary> {
  await ready()
  const r = await db.query.settings.findFirst({ where: eq(settings.key, 'google_reviews') })
  try { const v = JSON.parse(r?.value ?? '{}'); return { rating: Number(v.rating) || null, count: Number(v.count) || null, url: typeof v.url === 'string' && /^https:\/\//.test(v.url) ? v.url : null } }
  catch { return { rating: null, count: null, url: null } }
}

const fmtDate = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : undefined)

/** The reviews to show on a page: that service's first, then general ones, newest first (4 and 5 stars only). */
export async function reviewsFor(category: 'sales' | 'lettings' | 'any', max = 9): Promise<Review[]> {
  await ready()
  const cats = category === 'any' ? ['sales', 'lettings', 'general'] : [category, 'general']
  const rows = await db.select().from(reviews).where(and(eq(reviews.shown, true), gte(reviews.rating, 4), inArray(reviews.category, cats))).orderBy(desc(reviews.reviewedOn), desc(reviews.createdAt))
  if (!rows.length) return REVIEWS
  const mine = rows.filter((r) => r.category === category), rest = rows.filter((r) => r.category !== category)
  return [...mine, ...rest].slice(0, max).map((r) => ({ name: r.author, rating: r.rating, date: fmtDate(r.reviewedOn), text: r.text, source: r.source === 'google' ? 'Google review' : 'Client review' }))
}
