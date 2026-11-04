import 'server-only'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import type { ReadableStream as WebStream } from 'node:stream/web'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { knownAddresses, settings, soldPrices, type SoldPrice } from '@/db/schema'
import { now } from '@/lib/util'

// Sold prices for our part of North West London, from HM Land Registry Price Paid Data.
// Free to use under the Open Government Licence, with the credit line below shown wherever it appears.
// Sales appear about 1–2 months after completion. Refreshed monthly from the yearly files.

export const LR_CREDIT = 'Contains HM Land Registry data © Crown copyright and database right. Licensed under the Open Government Licence v3.0.'
const BASE = 'http://prod2.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com'
const AREA = /^(HA\d|NW(2|4|7|9|10)) /
const KEY = 'sold_prices'
const YEARS_BACK = 2 // this year and the two before

/** The postcode districts we serve, for display. */
export const PATCH = ['HA0', 'HA1', 'HA2', 'HA3', 'HA7', 'HA8', 'HA9', 'NW9']
export const TYPE_LABEL: Record<string, string> = { D: 'Detached house', S: 'Semi-detached house', T: 'Terraced house', F: 'Flat or maisonette' }

/** Splits one line of the Land Registry CSV (every field is quoted; addresses can contain commas). */
function parseLine(line: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      let j = i + 1, v = ''
      while (j < line.length) {
        if (line[j] === '"') { if (line[j + 1] === '"') { v += '"'; j += 2; continue } break }
        v += line[j++]
      }
      out.push(v); i = j + 2
    } else {
      const j = line.indexOf(',', i); out.push(line.slice(i, j < 0 ? undefined : j)); i = j < 0 ? line.length : j + 1
    }
  }
  return out
}

const tidy = (s: string) => s.trim().toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Of|And|The)\b/g, (w) => w.toLowerCase()) || null

/** "Flat 2", "273", "Preston Road" → "Flat 2, 273 Preston Road" (as people write it). */
export function addressLine(saon: string | null, paon: string | null, street: string | null): string {
  const p = paon ? tidy(paon) ?? '' : ''
  const st = street ? (/[a-z]/.test(street) ? street : tidy(street) ?? '') : ''
  const first = /^\d/.test(p) && st ? `${p} ${st}` : [p, st].filter(Boolean).join(', ')
  const sa = saon ? tidy(saon) ?? '' : ''
  // A bare flat number ("1", "12a") reads as "1 Woodcock Court"; "Flat 2" keeps its comma.
  return /^\d+[a-z]?$/i.test(sa) ? `${sa} ${first}` : [sa, first].filter(Boolean).join(', ')
}

export function rowFrom(f: string[]): typeof soldPrices.$inferInsert | null {
  const [id, price, date, postcode, type, isNew, tenure, paon, saon, street, locality, town, , , category, status] = f
  if (!postcode || category !== 'A' || status === 'D' || !TYPE_LABEL[type]) return null
  const pc = postcode.toUpperCase().trim().replace(/\s+/g, ' ')
  const [outward, inward = ''] = pc.split(' ')
  if (!AREA.test(`${outward} `) || !inward) return null
  return {
    id: id.replace(/[{}]/g, ''), price: Number(price), soldOn: date.slice(0, 10), postcode: pc, outward, sector: `${outward} ${inward.slice(0, 1)}`,
    type, newBuild: isNew === 'Y', tenure: tenure || null, paon: paon || null, saon: saon || null,
    street: tidy(street ?? ''), locality: tidy(locality ?? ''), town: tidy(town ?? ''),
  }
}

type State = { files?: Record<string, string>; lastRunAt?: string; lastError?: string | null; rows?: number }
async function loadState(): Promise<State> {
  const r = await db.query.settings.findFirst({ where: eq(settings.key, KEY) })
  try { return r ? (JSON.parse(r.value) as State) : {} } catch { return {} }
}
async function saveState(s: State) {
  await db.insert(settings).values({ key: KEY, value: JSON.stringify(s), updatedAt: now() }).onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(s), updatedAt: now() } })
}

/** Streams one year's file and replaces that year's rows for our area. */
async function loadYear(year: number): Promise<number> {
  const res = await fetch(`${BASE}/pp-${year}.csv`, { signal: AbortSignal.timeout(20 * 60_000) })
  if (!res.ok || !res.body) throw new Error(`Land Registry file for ${year} answered ${res.status}`)
  const rl = createInterface({ input: Readable.fromWeb(res.body as unknown as WebStream), crlfDelay: Infinity })
  const rows: (typeof soldPrices.$inferInsert)[] = []
  for await (const line of rl) {
    // Cheap check first: only lines with one of our postcode districts get parsed.
    if (!/"(HA\d|NW(?:2|4|7|9|10)) \d/.test(line)) continue
    const r = rowFrom(parseLine(line))
    if (r) rows.push(r)
  }
  const client = getClient()
  await client.execute({ sql: 'DELETE FROM sold_prices WHERE sold_on >= ? AND sold_on < ?', args: [`${year}-01-01`, `${year + 1}-01-01`] })
  for (let i = 0; i < rows.length; i += 400) await db.insert(soldPrices).values(rows.slice(i, i + 400)).onConflictDoNothing()
  return rows.length
}

/**
 * Checks once a day whether Land Registry has published new figures (they update the yearly files monthly),
 * and reloads any year that changed. Takes a few minutes when it does; safe to call often.
 */
export async function refreshSoldPrices(opts: { force?: boolean } = {}) {
  await ready()
  const client = getClient()
  const t = new Date().toISOString()
  const claim = await client.execute({
    sql: `INSERT INTO jobs (name, last_run_at) VALUES ('sold_prices', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`,
    args: [t, new Date(Date.now() - (opts.force ? 60_000 : 22 * 3600_000)).toISOString()],
  })
  if (claim.rowsAffected !== 1) return { ran: false }
  const s = await loadState()
  const files = { ...(s.files ?? {}) }
  const thisYear = new Date().getFullYear()
  let loaded = 0
  try {
    for (let y = thisYear - YEARS_BACK; y <= thisYear; y++) {
      const head = await fetch(`${BASE}/pp-${y}.csv`, { method: 'HEAD', signal: AbortSignal.timeout(30_000) })
      if (!head.ok) continue
      const stamp = head.headers.get('last-modified') ?? head.headers.get('etag') ?? ''
      if (!opts.force && stamp && files[y] === stamp) continue
      loaded += await loadYear(y)
      files[y] = stamp
      await saveState({ ...s, files, lastRunAt: now(), lastError: null })
    }
    // Drop years we no longer keep.
    await client.execute({ sql: 'DELETE FROM sold_prices WHERE sold_on < ?', args: [`${thisYear - YEARS_BACK}-01-01`] })
    const total = Number((await client.execute('SELECT count(*) n FROM sold_prices')).rows[0].n)
    await saveState({ ...s, files, lastRunAt: now(), lastError: null, rows: total })
    return { ran: true, loaded, total }
  } catch (e) {
    await saveState({ ...s, files, lastRunAt: now(), lastError: e instanceof Error ? e.message : String(e) })
    return { ran: true, error: String(e) }
  }
}

// ---------- questions the website asks ----------

export const outwardOf = (pc: string) => pc.toUpperCase().trim().replace(/\s+/g, ' ').split(' ')[0]
export const sectorOf = (pc: string) => { const p = pc.toUpperCase().trim().replace(/\s+/g, ' '); const [o, i = ''] = p.split(' '); return i ? `${o} ${i[0]}` : null }
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }
const monthsAgo = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10) }

export type PublicSale = { street: string | null; postcode: string; type: string; typeLabel: string; tenure: string | null; newBuild: boolean; price: number; soldOn: string }
const pub = (r: SoldPrice): PublicSale => ({ street: r.street, postcode: r.postcode, type: r.type, typeLabel: TYPE_LABEL[r.type] ?? 'Home', tenure: r.tenure, newBuild: r.newBuild, price: r.price, soldOn: r.soldOn })
// House numbers and flat numbers are left out on purpose: street and postcode are enough to compare.

export type AreaStats = { label: string; count12: number; median12: number | null; byType: { type: string; label: string; count: number; median: number | null }[] }

async function statsFor(where: ReturnType<typeof eq>, label: string): Promise<AreaStats> {
  const rows = await db.select({ type: soldPrices.type, price: soldPrices.price }).from(soldPrices).where(and(where, gte(soldPrices.soldOn, monthsAgo(12))))
  const byType = ['D', 'S', 'T', 'F'].map((t) => { const xs = rows.filter((r) => r.type === t).map((r) => r.price); return { type: t, label: TYPE_LABEL[t], count: xs.length, median: median(xs) } }).filter((x) => x.count)
  return { label, count12: rows.length, median12: median(rows.map((r) => r.price)), byType }
}

export type Near = { postcode: string; scope: 'sector' | 'district'; area: string; recent: PublicSale[]; stats: AreaStats; covered: boolean; typed: boolean }

/** Recent sales near a postcode: the same sector first (e.g. HA3 0), widening to the district (HA3). */
export async function salesNear(postcode: string, opts: { type?: 'F' | 'H' | 'D' | 'S' | 'T' | null; limit?: number; district?: boolean } = {}): Promise<Near | null> {
  await ready()
  const pc = postcode.toUpperCase().trim().replace(/\s+/g, ' ')
  const out = outwardOf(pc), sec = sectorOf(pc)
  if (!out) return null
  const limit = opts.limit ?? 8
  const since = monthsAgo(24)
  const typed = (w: ReturnType<typeof eq>) => (opts.type === 'H' ? and(w, inArray(soldPrices.type, ['D', 'S', 'T'])) : opts.type ? and(w, eq(soldPrices.type, opts.type)) : and(w))
  let scope: 'sector' | 'district' = 'sector'
  let recent = sec && !opts.district ? await db.select().from(soldPrices).where(and(typed(eq(soldPrices.sector, sec)), gte(soldPrices.soldOn, since))).orderBy(desc(soldPrices.soldOn)).limit(limit) : []
  if (recent.length < 4) {
    scope = 'district'
    recent = await db.select().from(soldPrices).where(and(typed(eq(soldPrices.outward, out)), gte(soldPrices.soldOn, since))).orderBy(desc(soldPrices.soldOn)).limit(limit)
  }
  if (!recent.length && opts.type) return salesNear(postcode, { ...opts, type: null })
  // The same postcode first, then the rest by date.
  recent.sort((a, b) => (a.postcode === pc ? -1 : 0) - (b.postcode === pc ? -1 : 0) || (a.soldOn < b.soldOn ? 1 : -1))
  const stats = scope === 'sector' && sec ? await statsFor(eq(soldPrices.sector, sec), sec) : await statsFor(eq(soldPrices.outward, out), out)
  return { postcode: pc, scope, area: scope === 'sector' ? sec! : out, recent: recent.map(pub), stats, covered: recent.length > 0, typed: !!opts.type }
}

/** Sales on the same street (and postcode district), for a property page. */
export async function salesOnStreet(street: string | null, postcode: string | null, type?: 'F' | 'H' | null) {
  await ready()
  if (!postcode) return null
  const out = outwardOf(postcode)
  const st = street ? tidy(street.replace(/^\d+[a-z]?\s+/i, '')) : null
  const street5 = st ? await db.select().from(soldPrices).where(and(eq(soldPrices.street, st), eq(soldPrices.outward, out), gte(soldPrices.soldOn, monthsAgo(36)))).orderBy(desc(soldPrices.soldOn)).limit(6) : []
  const near = await salesNear(postcode, { type, limit: 6 })
  return { street: st, onStreet: street5.map(pub), near }
}

/** Last 12 months across the districts we cover, for the homepage. */
export async function patchSummary() {
  await ready()
  const rows = await db.select({ outward: soldPrices.outward, price: soldPrices.price }).from(soldPrices)
    .where(and(inArray(soldPrices.outward, PATCH), gte(soldPrices.soldOn, monthsAgo(12))))
  const latest = (await db.select({ d: sql<string>`max(${soldPrices.soldOn})` }).from(soldPrices))[0]?.d ?? null
  const byArea = PATCH.map((o) => { const xs = rows.filter((r) => r.outward === o).map((r) => r.price); return { outward: o, count: xs.length, median: median(xs) } }).filter((a) => a.count)
  return { count: rows.length, median: median(rows.map((r) => r.price)), byArea, latest }
}

export async function soldPricesState() { await ready(); return loadState() }

/** Our property types → Land Registry's: flats, or houses of any kind. */
export function lrTypeFor(propertyType: string | null | undefined): 'F' | 'H' | null {
  if (!propertyType) return null
  if (/flat|maisonette|studio|apartment|penthouse/i.test(propertyType)) return 'F'
  if (/house|bungalow|terrace|semi|detached|cottage/i.test(propertyType)) return 'H'
  return null
}

// ---------- addresses back to 1995, for the address finder ----------

const ADDR_KEY = 'address_backfill'
const FIRST_YEAR = 1995

/**
 * One-off: works through Land Registry's yearly files from 1995 up to the years already held in sold_prices,
 * one year per call, keeping only the addresses (not prices) in our area. About 30 calls in all; after that it
 * does nothing. Recent years come from sold_prices directly.
 */
export async function backfillAddresses(): Promise<{ ran: boolean; year?: number; added?: number; done?: boolean }> {
  await ready()
  const client = getClient()
  const t = new Date().toISOString()
  const claim = await client.execute({
    sql: `INSERT INTO jobs (name, last_run_at) VALUES ('${ADDR_KEY}', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`,
    args: [t, new Date(Date.now() - 90_000).toISOString()],
  })
  if (claim.rowsAffected !== 1) return { ran: false }
  const row = await db.query.settings.findFirst({ where: eq(settings.key, ADDR_KEY) })
  const state = (row ? JSON.parse(row.value) : {}) as { next?: number; done?: boolean; lastError?: string | null }
  const lastYear = new Date().getFullYear() - YEARS_BACK - 1
  const year = state.next ?? FIRST_YEAR
  if (state.done || year > lastYear) {
    if (!state.done) await db.insert(settings).values({ key: ADDR_KEY, value: JSON.stringify({ ...state, done: true }), updatedAt: now() }).onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify({ ...state, done: true }), updatedAt: now() } })
    return { ran: false, done: true }
  }
  const save = (v: object) => db.insert(settings).values({ key: ADDR_KEY, value: JSON.stringify(v), updatedAt: now() }).onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(v), updatedAt: now() } })
  try {
    const res = await fetch(`${BASE}/pp-${year}.csv`, { signal: AbortSignal.timeout(20 * 60_000) })
    if (!res.ok || !res.body) throw new Error(`Land Registry file for ${year} answered ${res.status}`)
    const rl = createInterface({ input: Readable.fromWeb(res.body as unknown as WebStream), crlfDelay: Infinity })
    const found = new Map<string, { postcode: string; line: string }>()
    for await (const line of rl) {
      if (!/"(HA\d|NW(?:2|4|7|9|10)) \d/.test(line)) continue
      const f = parseLine(line)
      const pc = (f[3] ?? '').toUpperCase().trim().replace(/\s+/g, ' ')
      const [outward, inward] = pc.split(' ')
      if (!inward || !AREA.test(`${outward} `)) continue
      const addr = addressLine(f[8] || null, f[7] || null, f[9] || null)
      if (addr) found.set(`${pc}|${addr}`, { postcode: pc, line: addr })
    }
    const rows = [...found.values()].map((r) => ({ ...r, lastYear: year }))
    for (let i = 0; i < rows.length; i += 400) {
      await db.insert(knownAddresses).values(rows.slice(i, i + 400))
        .onConflictDoUpdate({ target: [knownAddresses.postcode, knownAddresses.line], set: { lastYear: sql`max(${knownAddresses.lastYear}, excluded.last_year)` } })
    }
    await save({ next: year + 1, done: year + 1 > lastYear, lastError: null })
    return { ran: true, year, added: rows.length, done: year + 1 > lastYear }
  } catch (e) {
    await save({ ...state, next: year, lastError: e instanceof Error ? e.message : String(e) })
    return { ran: true, year }
  }
}
