import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { media } from '@/db/schema'
import { currentAdmin } from '@/lib/auth'
import { MEDIA_RULES, type MediaKind } from '@/lib/options'
import { isLocalStorage, writeLocal } from '@/lib/storage'

export const dynamic = 'force-dynamic'

/** Step 2 (local storage only): receives the file bytes. In production the browser uploads straight to the bucket. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isLocalStorage()) return NextResponse.json({ error: 'Uploads go directly to storage.' }, { status: 405 })
  const admin = await currentAdmin()
  if (!admin) return NextResponse.json({ error: 'Your session has ended. Sign in again.' }, { status: 401 })
  await ready()
  const { id } = await ctx.params
  const m = await db.query.media.findFirst({ where: eq(media.id, id) })
  if (!m || m.status !== 'pending') return NextResponse.json({ error: 'Upload not found.' }, { status: 404 })
  if (!req.body) return NextResponse.json({ error: 'No file received.' }, { status: 400 })
  try {
    const bytes = await writeLocal(m.storageKey, req.body, MEDIA_RULES[m.kind as MediaKind].maxBytes)
    return NextResponse.json({ ok: true, bytes })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Upload failed.' }, { status: 413 })
  }
}
