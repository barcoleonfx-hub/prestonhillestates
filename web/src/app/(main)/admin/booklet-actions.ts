'use server'

import { revalidatePath } from 'next/cache'
import { db, ready } from '@/db/client'
import { booklets } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { FIELDS, type BookletFields } from '@/lib/booklet'
import { now } from '@/lib/util'

const LIMIT: Partial<Record<keyof BookletFields, number>> = { letter: 3000, forName: 120, home: 200, visit: 160, greeting: 80, figure: 120, asking: 120, fee: 200 }

/** Saves what staff changed on a booklet (only the changes, so the rest keeps filling itself in). */
export async function saveBooklet(id: string, changed: Partial<BookletFields>): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAdmin()
  await ready()
  if (!/^(a-)?[\w-]{6,64}$/.test(id)) return { ok: false, error: 'That booklet doesn’t exist.' }
  const clean: Partial<BookletFields> = {}
  for (const k of FIELDS) {
    const v = changed[k]
    if (v === undefined) continue
    if (k === 'kind') { if (v === 'sales' || v === 'lettings') clean.kind = v; continue }
    if (k === 'hide') { if (Array.isArray(v)) clean.hide = v.map(String).slice(0, 80); continue }
    ;(clean as Record<string, string>)[k] = String(v).slice(0, LIMIT[k] ?? 200)
  }
  const data = JSON.stringify(clean)
  await db.insert(booklets).values({ id, data, updatedBy: me.id, updatedAt: now() })
    .onConflictDoUpdate({ target: booklets.id, set: { data, updatedBy: me.id, updatedAt: now() } })
  await audit(me.id, 'booklet_saved', id.startsWith('a-') ? 'appointment' : 'enquiry', id.replace(/^a-/, ''), Object.keys(clean).join(', ') || 'reset')
  revalidatePath(`/admin/booklet/${id}`)
  return { ok: true }
}
