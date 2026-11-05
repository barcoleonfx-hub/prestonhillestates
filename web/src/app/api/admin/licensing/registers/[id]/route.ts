import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { councilRegisters } from '@/db/schema'
import { currentAdmin } from '@/lib/auth'
import { localPath, readLocal } from '@/lib/storage'

export const dynamic = 'force-dynamic'

/** The copy of a council's register the portal last downloaded and checked. Staff only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentAdmin())) return new Response('Sign in first', { status: 403 })
  await ready()
  const { id } = await params
  const r = await db.query.councilRegisters.findFirst({ where: eq(councilRegisters.id, id) })
  if (!r?.fileKey) return new Response('Not downloaded yet', { status: 404 })
  const size = await stat(localPath(r.fileKey)).then((s) => s.size).catch(() => null)
  if (size == null) return new Response('The file is no longer on the server. Press Check now to download it again.', { status: 404 })
  const ext = r.fileKey.split('.').pop() ?? 'pdf'
  const type = ext === 'pdf' ? 'application/pdf' : ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8'
  return new Response(Readable.toWeb(readLocal(r.fileKey)) as ReadableStream, {
    headers: { 'Content-Type': type, 'Content-Length': String(size), 'Content-Disposition': `${ext === 'pdf' ? 'inline' : 'attachment'}; filename="${r.name.replace(/[^\w ]+/g, '')}.${ext}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=600' },
  })
}
