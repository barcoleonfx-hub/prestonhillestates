'use server'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { reviews, settings } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { now, uid } from '@/lib/util'

const CATS = ['sales', 'lettings', 'general']
const done = () => { revalidatePath('/admin/reviews'); revalidatePath('/valuation'); revalidatePath('/landlords'); revalidatePath('/renting') }
const str = (f: FormData, k: string, n = 200) => String(f.get(k) ?? '').trim().slice(0, n)

/** Adds a review copied from Google, word for word. */
export async function addReview(_prev: { error?: string; ok?: boolean } | undefined, f: FormData): Promise<{ error?: string; ok?: boolean }> {
  const me = await requireAdmin()
  await ready()
  const author = str(f, 'author', 80), text = str(f, 'text', 3000), rating = Math.round(Number(f.get('rating')))
  const reviewedOn = /^\d{4}-\d{2}(-\d{2})?$/.test(str(f, 'reviewedOn', 10)) ? (str(f, 'reviewedOn', 10).length === 7 ? `${str(f, 'reviewedOn', 10)}-01` : str(f, 'reviewedOn', 10)) : null
  if (!author) return { error: 'Add the reviewer’s name as it appears on Google.' }
  if (!text) return { error: 'Paste the review’s words.' }
  if (!(rating >= 1 && rating <= 5)) return { error: 'Choose the star rating.' }
  const category = CATS.includes(str(f, 'category')) ? str(f, 'category') : 'general'
  await db.insert(reviews).values({ id: uid(), author, rating, text, reviewedOn, category, source: 'google', shown: rating >= 4, createdBy: me.id, createdAt: now() })
  await audit(me.id, 'review_add', 'review', author, `${rating}★ ${category}`)
  done()
  return { ok: true }
}

export async function updateReview(f: FormData) {
  const me = await requireAdmin()
  await ready()
  const id = str(f, 'id', 64)
  if (str(f, 'delete') === '1') { await db.delete(reviews).where(eq(reviews.id, id)); await audit(me.id, 'review_delete', 'review', id, ''); done(); return }
  const patch: Partial<typeof reviews.$inferInsert> = {}
  if (f.has('category') && CATS.includes(str(f, 'category'))) patch.category = str(f, 'category')
  if (f.has('shown')) patch.shown = str(f, 'shown') === '1'
  if (Object.keys(patch).length) await db.update(reviews).set(patch).where(eq(reviews.id, id))
  done()
}

/** The overall Google rating and number of reviews, and the link to them, shown next to the selected reviews. */
export async function saveGoogleSummary(f: FormData) {
  const me = await requireAdmin()
  await ready()
  const rating = Math.min(5, Math.max(0, Number(str(f, 'rating', 4)) || 0))
  const count = Math.max(0, Math.round(Number(str(f, 'count', 8)) || 0))
  const url = /^https:\/\/[^\s]+$/.test(str(f, 'url', 600)) ? str(f, 'url', 600) : ''
  const value = JSON.stringify({ rating: rating || null, count: count || null, url: url || null })
  await db.insert(settings).values({ key: 'google_reviews', value, updatedAt: now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now() } })
  await audit(me.id, 'google_reviews', 'settings', 'google_reviews', value)
  done()
}
