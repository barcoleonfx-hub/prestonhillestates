import { NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { media, properties } from '@/db/schema'
import { currentAdmin } from '@/lib/auth'
import { MEDIA_KINDS, MEDIA_RULES, type MediaKind } from '@/lib/options'
import { storage } from '@/lib/storage'
import { now, uid } from '@/lib/util'

export const dynamic = 'force-dynamic'

/** Step 1 of an upload: registers the file and returns where to send its bytes. */
export async function POST(req: Request) {
  const admin = await currentAdmin()
  if (!admin) return NextResponse.json({ error: 'Your session has ended. Sign in again.' }, { status: 401 })
  await ready()

  const body = (await req.json().catch(() => null)) as
    | { propertyId?: string; kind?: string; filename?: string; contentType?: string; size?: number }
    | null
  if (!body?.propertyId || !body.kind || !body.contentType) {
    return NextResponse.json({ error: 'Missing upload details.' }, { status: 400 })
  }
  if (!MEDIA_KINDS.includes(body.kind as MediaKind)) {
    return NextResponse.json({ error: 'Unknown media type.' }, { status: 400 })
  }
  const kind = body.kind as MediaKind
  const rule = MEDIA_RULES[kind]
  const ext = rule.types[body.contentType]
  if (!ext) {
    const allowed = [...new Set(Object.values(rule.types))].join(', ').toUpperCase()
    return NextResponse.json({ error: `This file isn’t a supported format. Use ${allowed}.` }, { status: 415 })
  }
  if (typeof body.size === 'number' && body.size > rule.maxBytes) {
    return NextResponse.json(
      { error: `This file is too large. The limit is ${Math.round(rule.maxBytes / 1024 / 1024)} MB.` },
      { status: 413 },
    )
  }
  const property = await db.query.properties.findFirst({ where: eq(properties.id, body.propertyId) })
  if (!property) return NextResponse.json({ error: 'This property no longer exists.' }, { status: 404 })

  const [{ max }] = await db
    .select({ max: sql<number | null>`MAX(${media.position})` })
    .from(media)
    .where(and(eq(media.propertyId, property.id), eq(media.kind, kind)))

  const id = uid()
  const storageKey = `properties/${property.id}/${kind}/${id}.${ext}`
  await db.insert(media).values({
    id, propertyId: property.id, kind, storageKey, contentType: body.contentType,
    originalName: (body.filename || '').slice(0, 200) || null,
    sizeBytes: typeof body.size === 'number' ? body.size : null,
    position: (max ?? -1) + 1, status: 'pending', createdAt: now(),
  })

  const upload = await storage().uploadTarget(storageKey, body.contentType, id)
  return NextResponse.json({ id, upload })
}
