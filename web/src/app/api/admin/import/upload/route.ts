import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebStream } from 'node:stream/web'
import { inArray } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries } from '@/db/schema'
import { currentAdmin } from '@/lib/auth'
import { analyse, mboxMessages, type ImportRow } from '@/lib/email-import'
import { ensureDir, readBatch, uploadPath, validBatch, writeBatch } from '@/lib/import-batches'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Receives one exported mailbox (.mbox / Apple Mail "mbox") or one .eml file, sorts its emails,
 * and adds them to the review list for this batch. Admins only.
 */
export async function POST(req: Request) {
  const me = await currentAdmin()
  if (!me || me.role !== 'admin') return Response.json({ error: 'Admins only' }, { status: 403 })
  const url = new URL(req.url)
  const batch = url.searchParams.get('batch')
  const name = (url.searchParams.get('name') || 'mbox').toLowerCase()
  const n = Number(url.searchParams.get('n')) || 0
  if (!validBatch(batch) || !req.body) return Response.json({ error: 'Bad upload' }, { status: 400 })

  await ensureDir()
  const tmp = uploadPath(batch, n)
  try {
    await pipeline(Readable.fromWeb(req.body as unknown as WebStream), createWriteStream(tmp))
    const found: ImportRow[] = []
    const seen = new Set((await readBatch(batch)).map((r) => r.key))
    const add = (r: ImportRow | null) => { if (r && !seen.has(r.key)) { seen.add(r.key); found.push(r) } }
    if (name.endsWith('.eml')) {
      const { readFile } = await import('node:fs/promises')
      add(await analyse(await readFile(tmp, 'utf8')))
    } else {
      for await (const raw of mboxMessages(tmp)) add(await analyse(raw))
    }
    // Mark anything already in the portal.
    await ready()
    const keys = found.map((r) => r.key)
    const existing = new Set<string>()
    for (let i = 0; i < keys.length; i += 400) {
      const rows = await db.select({ k: enquiries.externalId }).from(enquiries).where(inArray(enquiries.externalId, keys.slice(i, i + 400)))
      rows.forEach((r) => r.k && existing.add(r.k))
    }
    for (const r of found) if (existing.has(r.key)) Object.assign(r, { category: 'skipped', reason: 'Already imported' })
    const all = [...(await readBatch(batch)), ...found].sort((a, b) => (a.date < b.date ? 1 : -1))
    await writeBatch(batch, all)
    return Response.json({ ok: true, added: found.length, rows: all })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Could not read that file' }, { status: 422 })
  } finally {
    await rm(tmp, { force: true })
  }
}
