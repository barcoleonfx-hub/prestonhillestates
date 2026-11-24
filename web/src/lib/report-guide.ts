import 'server-only'
import { eq, inArray } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { booklets, reportGuides } from '@/db/schema'
import { isGuide, parseGuide, type GuideItem, type OtmGuide } from './otm-guide'

// The OnTheMarket Market Appraisal Guide behind each property report. A report is only sent (by email or
// WhatsApp) once staff have uploaded the guide, checked its facts, set the guide price and finalised it.

export type ReportGuide = {
  fileName: string
  guide: OtmGuide
  asking: number | null
  low: number | null
  high: number | null
  priceFor: string | null
  uploadedAt: string
  finalisedAt: string | null
  finalisedBy: string | null
}

/** The text and where it sits on each page (top-left origin, in points). */
export async function readGuidePdf(bytes: Uint8Array): Promise<GuideItem[]> {
  const { getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(bytes)
  const items: GuideItem[] = []
  for (let p = 1; p <= Math.min(pdf.numPages, 12); p++) {
    const page = await pdf.getPage(p)
    const h = page.getViewport({ scale: 1 }).height
    const tc = await page.getTextContent()
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue
      items.push({ p, x: Math.round(it.transform[4]), y: Math.round(h - it.transform[5]), s: it.str })
    }
  }
  await pdf.destroy().catch(() => {})
  return items
}

/** Reads an uploaded PDF, or says why it isn’t a Market Appraisal Guide we can use. */
export async function guideFromPdf(bytes: Uint8Array): Promise<{ guide: OtmGuide } | { error: string }> {
  let items: GuideItem[]
  try { items = await readGuidePdf(bytes) } catch { return { error: 'That file couldn’t be read as a PDF.' } }
  if (!items.length) return { error: 'That PDF has no text in it (is it a scan or a photo?). Download the guide from OnTheMarket again and upload that file.' }
  if (!isGuide(items)) return { error: 'That doesn’t look like an OnTheMarket Market Appraisal Guide. On OnTheMarket, open the home and download its “Market Appraisal Guide”, then upload that PDF.' }
  return { guide: parseGuide(items) }
}

export async function reportGuide(bookletId: string): Promise<ReportGuide | null> {
  await ready()
  const r = await db.query.reportGuides.findFirst({ where: eq(reportGuides.bookletId, bookletId) })
  if (!r) return null
  let guide: OtmGuide
  try { guide = JSON.parse(r.data) as OtmGuide } catch { return null }
  return { fileName: r.fileName, guide, asking: r.asking, low: r.low, high: r.high, priceFor: r.priceFor, uploadedAt: r.uploadedAt, finalisedAt: r.finalisedAt, finalisedBy: r.finalisedBy }
}

/** Whether the report can be sent: the guide is in and staff have finalised it. */
export async function reportFinal(bookletId: string): Promise<boolean> {
  await ready()
  const r = await db.select({ at: reportGuides.finalisedAt, asking: reportGuides.asking, priceFor: reportGuides.priceFor }).from(reportGuides).where(eq(reportGuides.bookletId, bookletId)).limit(1)
  if (!r[0]?.at || !r[0].asking) return false
  // Switched between selling and letting since it was finalised: its price is for the other one.
  const kind = await db.query.booklets.findFirst({ where: eq(booklets.id, bookletId) }).then((b) => { try { return b ? (JSON.parse(b.data) as { kind?: string }).kind : undefined } catch { return undefined } })
  return !kind || !r[0].priceFor || kind === r[0].priceFor
}

/** A guide older than this is out of date: prices and listings will have moved. */
export const GUIDE_FRESH_DAYS = 90

export type ReportState = {
  /** final: guide in, price set, finalised. draft: guide in, not finalised. none: no OnTheMarket guide uploaded. */
  state: 'final' | 'draft' | 'none'
  /** The day the guide was made (or uploaded, if it doesn't say), and whether that's over GUIDE_FRESH_DAYS ago. */
  madeOn: string | null
  stale: boolean
  asking: number | null
  /** When the guide was uploaded (null without one). */
  uploadedAt: string | null
}

export const guideAge = (made: string | null, uploadedAt: string): { madeOn: string; stale: boolean } => {
  const madeOn = (made ?? uploadedAt).slice(0, 10)
  return { madeOn, stale: Date.now() - Date.parse(`${madeOn}T12:00:00Z`) > GUIDE_FRESH_DAYS * 864e5 }
}

/** Where each enquiry's property report stands, for flagging letters and emails before they go. */
export async function reportStates(ids: string[]): Promise<Map<string, ReportState>> {
  await ready()
  const out = new Map<string, ReportState>(ids.map((id) => [id, { state: 'none', madeOn: null, stale: false, asking: null, uploadedAt: null }]))
  if (!ids.length) return out
  const rows = await db.select().from(reportGuides).where(inArray(reportGuides.bookletId, ids))
  for (const r of rows) {
    let made: string | null = null
    try { made = (JSON.parse(r.data) as OtmGuide).made } catch { /* unreadable: treat as made when uploaded */ }
    const age = guideAge(made, r.uploadedAt)
    out.set(r.bookletId, { state: r.finalisedAt && r.asking ? 'final' : 'draft', ...age, asking: r.asking, uploadedAt: r.uploadedAt })
  }
  return out
}
