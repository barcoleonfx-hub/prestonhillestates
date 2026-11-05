import 'server-only'
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { rentals } from '@/db/schema'
import { addressKey, datesIn, normText } from './licensing-extract'
import { now } from './util'

// EPCs from GOV.UK's public "Find an energy certificate" service: search by postcode, pick the certificate for
// the property's address, read its rating and "valid until" date. No account or key needed. Polite: one request
// every two seconds, each property checked at most once a fortnight.

const BASE = () => (process.env.EPC_FIND_URL || 'https://find-energy-certificate.service.gov.uk').replace(/\/$/, '')
const UA = 'Mozilla/5.0 (compatible; PrestonHillPortal/1.0; EPC check for properties we manage)'
let last = 0
const wait = async () => { const gap = Date.now() - last; if (gap < 2000) await new Promise((r) => setTimeout(r, 2000 - gap)); last = Date.now() }
const get = async (u: string) => {
  await wait()
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`GOV.UK answered ${r.status}`)
  return r.text()
}
const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ')

export type EpcResult = { ref: string; url: string; rating: string | null; validUntil: string | null; address: string }

/** The certificates listed for a postcode: reference and the address shown next to it. */
async function search(postcode: string): Promise<{ ref: string; address: string }[]> {
  const html = await get(`${BASE()}/find-a-certificate/search-by-postcode?postcode=${encodeURIComponent(postcode)}`)
  const out: { ref: string; address: string }[] = []
  for (const m of html.matchAll(/<a[^>]+href="[^"]*\/energy-certificate\/(\d{4}-\d{4}-\d{4}-\d{4}-\d{4})"[^>]*>([\s\S]*?)<\/a>/gi)) {
    out.push({ ref: m[1], address: strip(m[2]).trim() })
  }
  return out
}

/** Rating and "valid until" from a certificate's page. */
async function certificate(ref: string): Promise<{ rating: string | null; validUntil: string | null; expired: boolean }> {
  const text = strip(await get(`${BASE()}/energy-certificate/${ref}`))
  const rating = /energy rating is\s+([A-G])\b/i.exec(text)?.[1]?.toUpperCase()
    ?? /\b(?:current|energy)\s+rating[:\s]+([A-G])\b/i.exec(text)?.[1]?.toUpperCase() ?? null
  const v = /valid until\s*[:]?\s*/i.exec(text)
  const validUntil = v ? datesIn(text.slice(v.index, v.index + 60))[0]?.iso ?? null : null
  return { rating, validUntil, expired: /this certificate has expired|certificate expired/i.test(text) }
}

/** The current EPC for an address, or null when none matches it on GOV.UK. */
export async function findEpc(address: string, postcode: string, resolved?: string | null): Promise<EpcResult | null> {
  const listed = await search(postcode)
  if (!listed.length) return null
  const keys = [resolved, address].filter(Boolean).map((a) => addressKey('x', a!, postcode)).filter(Boolean)
  const mine = listed.filter((l) => {
    const n = ` ${normText(l.address).trim()} `
    return keys.some((k) => n.includes(k!.key) && (!k!.flat || new RegExp(`\\b(flat|apartment|apt|unit)\\s+${k!.flat}\\b`).test(n)))
  })
  if (!mine.length) return null
  // Several certificates for one home: read each and keep the one valid longest.
  let best: EpcResult | null = null
  for (const l of mine.slice(0, 4)) {
    const c = await certificate(l.ref)
    const r: EpcResult = { ref: l.ref, url: `${BASE()}/energy-certificate/${l.ref}`, rating: c.rating, validUntil: c.validUntil, address: l.address }
    if (!best || (r.validUntil ?? '') > (best.validUntil ?? '')) best = r
  }
  return best
}

async function claim(force: boolean) {
  const t = new Date().toISOString(), before = new Date(Date.now() - (force ? 30_000 : 6 * 3600_000)).toISOString()
  const r = await getClient().execute({ sql: `INSERT INTO jobs (name, last_run_at) VALUES ('epc', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`, args: [t, before] })
  return r.rowsAffected === 1
}

/**
 * Looks up EPCs for properties with a postcode whose EPC is missing, expired or due within 3 months, or
 * not checked for a fortnight. The official record fills the EPC date and rating; an older date is never put in.
 */
export async function runEpcChecks(opts: { force?: boolean; seconds?: number } = {}): Promise<{ ran: boolean; checked?: number; found?: number; error?: string }> {
  await ready()
  if (!(await claim(!!opts.force))) return { ran: false }
  const fortnight = new Date(Date.now() - 14 * 86400000).toISOString()
  const soon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
  const todo = await db.select().from(rentals).where(and(eq(rentals.archived, false), isNotNull(rentals.postcode),
    or(isNull(rentals.epcCheckedAt), lt(rentals.epcCheckedAt, fortnight)),
    or(isNull(rentals.epcExpires), lt(rentals.epcExpires, soon), isNull(rentals.epcRating), isNull(rentals.epcRef)))).limit(200)
  const started = Date.now()
  let checked = 0, found = 0
  for (const r of todo) {
    if (Date.now() - started > (opts.seconds ?? 80) * 1000) break
    try {
      const e = await findEpc(r.address, r.postcode!, r.resolvedAddress)
      checked++
      const patch: Partial<typeof rentals.$inferInsert> = { epcCheckedAt: now() }
      if (e) {
        found++
        patch.epcRef = e.ref
        if (e.validUntil && (!r.epcExpires || e.validUntil > r.epcExpires)) { patch.epcExpires = e.validUntil; patch.epcRating = e.rating ?? r.epcRating }
        else if (!r.epcRating && e.rating) patch.epcRating = e.rating
      }
      await db.update(rentals).set(patch).where(eq(rentals.id, r.id))
    } catch (err) {
      // GOV.UK not answering: stop for now and try again next time.
      return { ran: true, checked, found, error: (err as Error).message }
    }
  }
  return { ran: true, checked, found }
}

export const epcUrl = (ref: string | null) => (ref ? `${BASE()}/energy-certificate/${ref}` : null)
