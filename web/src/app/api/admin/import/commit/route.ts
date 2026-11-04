import { ready } from '@/db/client'
import { currentAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { saveEmailRow } from '@/lib/email-intake'
import { dropBatch, importable, readBatch, validBatch } from '@/lib/import-batches'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Saves the ticked emails as enquiries on their original dates, each linked to a contact. Admins only.
 * The browser sends them in small chunks; `last` marks the final chunk, after which the upload is deleted.
 * Safe to repeat: emails already in the portal are skipped.
 */
export async function POST(req: Request) {
  try {
    return await commit(req)
  } catch (e) {
    console.error('import commit failed', e)
    return Response.json({ error: `The server hit a problem: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }, { status: 500 })
  }
}

async function commit(req: Request) {
  const me = await currentAdmin()
  if (!me || me.role !== 'admin') return Response.json({ error: 'Admins only' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { batch?: string; keys?: unknown; last?: boolean }
  if (!validBatch(body.batch ?? null) || !Array.isArray(body.keys)) return Response.json({ error: 'Bad request' }, { status: 400 })
  const want = new Set(body.keys.filter((k): k is string => typeof k === 'string'))
  const batch = await readBatch(body.batch!)
  if (!batch.length) return Response.json({ error: 'This upload has expired, usually because the portal restarted after an update. Please upload the file again.' }, { status: 410 })
  // Skipped emails can be ticked by hand, except ones already in the portal or past the retention limit.
  const rows = batch.filter((r) => want.has(r.key) && (r.category !== 'skipped' || importable(r)))
  await ready()
  const startedAt = new Date().toISOString()

  let imported = 0
  const people = new Set<string>()
  const failed: { name: string; date: string; error: string }[] = []
  for (const r of rows.sort((a, b) => (a.date < b.date ? -1 : 1))) {
    try {
      const saved = await saveEmailRow(r, { by: me.id, handled: true, startedAt })
      if (!saved) continue
      const contactId = saved.contactId
      imported++
      people.add(contactId)
    } catch (e) {
      // One bad email shouldn't stop the rest.
      console.error('import row failed', r.key, e)
      failed.push({ name: r.name, date: r.date, error: e instanceof Error ? e.message.slice(0, 160) : 'Unknown error' })
    }
  }
  if (imported) await audit(me.id, 'import_emails', 'enquiry', body.batch!, `${imported} imported`)
  if (body.last) await dropBatch(body.batch!)
  return Response.json({ ok: true, imported, contactIds: [...people], failed })
}
