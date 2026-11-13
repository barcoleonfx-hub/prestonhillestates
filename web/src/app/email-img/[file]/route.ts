import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { emailImages } from '@/db/schema'
import { localPath, readLocal } from '@/lib/storage'

export const dynamic = 'force-dynamic'

/** Pictures in tailored emails (/email-img/<id>.jpg). Public, as they're shown in people's inboxes. */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const id = (await ctx.params).file.replace(/\.(jpe?g|png)$/i, '')
  if (!/^[a-z0-9-]{8,40}$/i.test(id)) return new Response('Not found', { status: 404 })
  await ready()
  const img = await db.query.emailImages.findFirst({ where: eq(emailImages.id, id) })
  if (!img) return new Response('Not found', { status: 404 })
  let size: number
  try { size = (await stat(localPath(img.storageKey))).size } catch { return new Response('Not found', { status: 404 }) }
  return new Response(Readable.toWeb(readLocal(img.storageKey)) as ReadableStream, {
    headers: { 'Content-Type': img.contentType, 'Content-Length': String(size), 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  })
}
