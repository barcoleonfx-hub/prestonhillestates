'use server'

import { revalidatePath } from 'next/cache'
import { db, ready } from '@/db/client'
import { eq } from 'drizzle-orm'
import { booklets, reportGuides } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { FIELDS, type BookletFields } from '@/lib/booklet'
import { now } from '@/lib/util'
import { guideGaps, type OtmGuide } from '@/lib/otm-guide'
import { guideFromPdf, reportGuide } from '@/lib/report-guide'

const LIMIT: Partial<Record<keyof BookletFields, number>> = { story: 1500, letter: 3000, forName: 120, home: 200, visit: 160, greeting: 80, figure: 120, asking: 120, fee: 200 }

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
    if (k === 'showPaid') { clean.showPaid = v === true; continue }
    ;(clean as Record<string, string>)[k] = String(v).slice(0, LIMIT[k] ?? 200)
  }
  const data = JSON.stringify(clean)
  await db.insert(booklets).values({ id, data, updatedBy: me.id, updatedAt: now() })
    .onConflictDoUpdate({ target: booklets.id, set: { data, updatedBy: me.id, updatedAt: now() } })
  await audit(me.id, 'booklet_saved', id.startsWith('a-') ? 'appointment' : 'enquiry', id.replace(/^a-/, ''), Object.keys(clean).join(', ') || 'reset')
  revalidatePath(`/admin/booklet/${id}`)
  return { ok: true }
}

// ── The OnTheMarket guide and finalising the report ─────────────────────────────────────────────

const BOOKLET_ID = /^(a-)?[\w-]{6,64}$/
const MAX_PDF = 15 * 1024 * 1024
const whose = (id: string) => (id.startsWith('a-') ? 'appointment' : 'enquiry') as 'appointment' | 'enquiry'

/** Reads the uploaded Market Appraisal Guide and keeps its facts. A new guide means the report needs finalising again. */
export async function uploadGuide(id: string, form: FormData): Promise<{ ok: boolean; error?: string; gaps?: string[] }> {
  const me = await requireAdmin()
  await ready()
  if (!BOOKLET_ID.test(id)) return { ok: false, error: 'That report doesn’t exist.' }
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) return { ok: false, error: 'Choose the PDF first.' }
  if (file.size > MAX_PDF) return { ok: false, error: 'That file is too big (the guide is usually under 5 MB).' }
  const bytes = new Uint8Array(await file.arrayBuffer())
  // PDFs may have a few stray bytes before the header (OnTheMarket's start with a space).
  if (!String.fromCharCode(...bytes.slice(0, 1024)).includes('%PDF-')) return { ok: false, error: 'That isn’t a PDF. Upload the guide exactly as OnTheMarket gave it to you.' }
  const read = await guideFromPdf(bytes)
  if ('error' in read) return { ok: false, error: read.error }
  const name = file.name.replace(/[^\w .()-]/g, '').slice(0, 120) || 'Market Appraisal Guide.pdf'
  const data = JSON.stringify(read.guide)
  await db.insert(reportGuides).values({ bookletId: id, fileName: name, data, uploadedBy: me.id, uploadedAt: now() })
    .onConflictDoUpdate({ target: reportGuides.bookletId, set: { fileName: name, data, uploadedBy: me.id, uploadedAt: now(), finalisedAt: null, finalisedBy: null } })
  await audit(me.id, 'report_guide_uploaded', whose(id), id.replace(/^a-/, ''), name)
  revalidatePath(`/admin/booklet/${id}`)
  return { ok: true, gaps: guideGaps(read.guide) }
}

export type GuideFixes = { type?: string; beds?: number | null; baths?: number | null; sqft?: number | null; tenure?: string; councilBand?: string }
const price = (n: unknown) => { const v = Math.round(Number(n)); return Number.isFinite(v) && v > 0 && v < 100_000_000 ? v : null }
const count = (n: unknown) => { if (n === null || n === '' || n === undefined) return null; const v = Math.round(Number(n)); return Number.isFinite(v) && v >= 0 && v < 100 ? v : null }

/** Staff's corrections to the guide's facts, the guide price, and (with finalise) marking the report ready to send. */
export async function saveGuide(id: string, input: { fixes: GuideFixes; asking: number | null; low: number | null; high: number | null; rent: boolean; finalise?: boolean; reopen?: boolean }): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAdmin()
  await ready()
  if (!BOOKLET_ID.test(id)) return { ok: false, error: 'That report doesn’t exist.' }
  const g = await reportGuide(id)
  if (!g) return { ok: false, error: 'Upload the OnTheMarket guide first.' }
  const f = input.fixes ?? {}
  const guide: OtmGuide = { ...g.guide }
  if (f.type !== undefined) guide.type = String(f.type).trim().slice(0, 60) || null
  if (f.beds !== undefined) guide.beds = count(f.beds)
  if (f.baths !== undefined) guide.baths = count(f.baths)
  if (f.sqft !== undefined) { const s = f.sqft == null ? NaN : Math.round(Number(f.sqft)); guide.sqft = s > 50 && s < 20000 ? s : null; guide.sqm = guide.sqft ? Math.round(guide.sqft / 10.764) : null }
  if (f.tenure !== undefined) guide.tenure = String(f.tenure).trim().slice(0, 40) || null
  if (f.councilBand !== undefined) guide.councilBand = String(f.councilBand).trim().toUpperCase().slice(0, 2) || null
  const asking = price(input.asking), low = price(input.low), high = price(input.high)
  if (low && high && low > high) return { ok: false, error: 'The bottom of the range is above the top.' }
  if (input.finalise) {
    if (!asking) return { ok: false, error: 'Set the guide price before finalising.' }
    if (!low || !high) return { ok: false, error: 'Set the range (from and to) before finalising.' }
    if (asking < low || asking > high) return { ok: false, error: 'The guide price should sit inside the range.' }
  }
  const finalised = input.reopen ? { finalisedAt: null, finalisedBy: null } : input.finalise ? { finalisedAt: now(), finalisedBy: me.id } : {}
  // Once finalised, the price must stay complete.
  if (!input.reopen && !input.finalise && g.finalisedAt && (!asking || !low || !high)) return { ok: false, error: 'This report has been finalised, so it needs a guide price and range. To clear them, choose “Make changes” first.' }
  await db.update(reportGuides).set({ data: JSON.stringify(guide), asking, low, high, priceFor: input.rent ? 'lettings' : 'sales', ...finalised }).where(eq(reportGuides.bookletId, id))
  if (input.finalise) await audit(me.id, 'report_finalised', whose(id), id.replace(/^a-/, ''), `£${asking?.toLocaleString('en-GB')} (£${low?.toLocaleString('en-GB')}–£${high?.toLocaleString('en-GB')})`)
  revalidatePath(`/admin/booklet/${id}`)
  if (!id.startsWith('a-')) revalidatePath(`/admin/enquiries/${id}`)
  return { ok: true }
}

export async function removeGuide(id: string): Promise<{ ok: boolean }> {
  const me = await requireAdmin()
  await ready()
  if (!BOOKLET_ID.test(id)) return { ok: false }
  await db.delete(reportGuides).where(eq(reportGuides.bookletId, id))
  await audit(me.id, 'report_guide_removed', whose(id), id.replace(/^a-/, ''), '')
  revalidatePath(`/admin/booklet/${id}`)
  return { ok: true }
}
