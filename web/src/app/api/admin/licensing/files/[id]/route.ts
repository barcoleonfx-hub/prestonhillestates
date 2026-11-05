import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { emailFiles } from '@/db/schema'
import { currentAdmin } from '@/lib/auth'
import { localPath, readLocal } from '@/lib/storage'

export const dynamic = 'force-dynamic'

/** A PDF saved from the mailbox (licence, gas safety record, EICR, EPC). Staff only; opens in the browser. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentAdmin())) return new Response('Sign in first', { status: 403 })
  await ready()
  const { id } = await params
  const f = await db.query.emailFiles.findFirst({ where: eq(emailFiles.id, id) })
  if (!f) return new Response('Not found', { status: 404 })
  const size = await stat(localPath(f.storageKey)).then((s) => s.size).catch(() => null)
  if (size == null) return new Response('The file is no longer on the server. Search the emails again to fetch it.', { status: 404 })
  const download = new URL(req.url).searchParams.has('download')
  const name = f.filename.replace(/[^\w .()-]+/g, '_')
  return new Response(Readable.toWeb(readLocal(f.storageKey)) as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf', 'Content-Length': String(size), 'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`, 'X-Content-Type-Options': 'nosniff',
    },
  })
}
