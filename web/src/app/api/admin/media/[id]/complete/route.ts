import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { media, properties } from '@/db/schema'
import { currentAdmin } from '@/lib/auth'
import { MEDIA_RULES, type MediaKind } from '@/lib/options'
import { storage } from '@/lib/storage'
import { now } from '@/lib/util'

export const dynamic = 'force-dynamic'

/** Step 3: confirms the file arrived and makes it available to the listing. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await currentAdmin()
  if (!admin) return NextResponse.json({ error: 'Your session has ended. Sign in again.' }, { status: 401 })
  await ready()
  const { id } = await ctx.params
  const m = await db.query.media.findFirst({ where: eq(media.id, id) })
  if (!m) return NextResponse.json({ error: 'Upload not found.' }, { status: 404 })

  const size = await storage().size(m.storageKey)
  if (size == null || size === 0) {
    await db.delete(media).where(eq(media.id, id))
    return NextResponse.json({ error: 'The file didn’t finish uploading. Try again.' }, { status: 400 })
  }
  if (size > MEDIA_RULES[m.kind as MediaKind].maxBytes) {
    await storage().remove(m.storageKey)
    await db.delete(media).where(eq(media.id, id))
    return NextResponse.json({ error: 'The file is larger than the allowed size.' }, { status: 413 })
  }

  let isCover = false
  if (m.kind === 'photo') {
    const cover = await db.query.media.findFirst({
      where: and(eq(media.propertyId, m.propertyId), eq(media.kind, 'photo'), eq(media.isCover, true)),
    })
    isCover = !cover
  }
  await db.update(media).set({ status: 'ready', sizeBytes: size, isCover }).where(eq(media.id, id))
  await db.update(properties).set({ updatedAt: now(), updatedBy: admin.email }).where(eq(properties.id, m.propertyId))
  return NextResponse.json({ ok: true })
}
