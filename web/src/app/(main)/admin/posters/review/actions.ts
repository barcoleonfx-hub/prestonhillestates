'use server'

import { revalidatePath } from 'next/cache'
import { db, ready } from '@/db/client'
import { settings } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { now } from '@/lib/util'

/** Saves Google's "write a review" link for the branch: where the review poster's QR code goes. */
export async function saveReviewLink(form: FormData): Promise<void> {
  const me = await requireAdmin()
  await ready()
  const url = String(form.get('url') ?? '').trim()
  if (url && !/^https:\/\/([a-z0-9-]+\.)*(google\.[a-z.]+|g\.page|goo\.gl|maps\.app\.goo\.gl)\//i.test(url)) return
  await db.insert(settings).values({ key: 'google_review_link', value: url, updatedAt: now() })
    .onConflictDoUpdate({ target: settings.key, set: { value: url, updatedAt: now() } })
  await audit(me.id, 'review_link_saved', 'setting', 'google_review_link', url || 'cleared')
  revalidatePath('/admin/posters/review')
}
