import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { and, eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { media } from '@/db/schema'
import { isLocalStorage, localPath, readLocal } from '@/lib/storage'

export const dynamic = 'force-dynamic'

/** Serves locally stored uploads (development). Supports byte ranges so videos can seek. */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  if (!isLocalStorage()) return new Response('Not found', { status: 404 })
  const { key: parts } = await ctx.params
  const key = parts.join('/')
  await ready()
  const m = await db.query.media.findFirst({ where: and(eq(media.storageKey, key), eq(media.status, 'ready')) })
  if (!m) return new Response('Not found', { status: 404 })

  let size: number
  try {
    localPath(key)
    size = (await stat(localPath(key))).size
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const headers: Record<string, string> = {
    'Content-Type': m.contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  }
  const range = req.headers.get('range')
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range)
  if (match) {
    let start = match[1] ? Number(match[1]) : NaN
    let end = match[2] ? Number(match[2]) : size - 1
    if (Number.isNaN(start)) { start = Math.max(size - end, 0); end = size - 1 }
    end = Math.min(end, size - 1)
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const stream = Readable.toWeb(readLocal(key, { start, end })) as ReadableStream
    return new Response(stream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    })
  }
  const stream = Readable.toWeb(readLocal(key)) as ReadableStream
  return new Response(stream, { headers: { ...headers, 'Content-Length': String(size) } })
}
