import 'server-only'
import { eq, inArray, sql } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { postcodeGeo, settings } from '@/db/schema'
import { unzip } from '@/lib/zip'
import { now } from '@/lib/util'

// Where postcodes are, as OS grid references in metres, so "near" means near. Loaded from Ordnance Survey's
// Code-Point Open (free, Open Government Licence) for the HA and NW postcode areas, with postcodes.io (same
// open data) as a fallback for anything missing.

const CODEPOINT = 'https://api.os.uk/downloads/v1/products/CodePointOpen/downloads?area=GB&format=CSV&redirect'
const KEY = 'postcode_geo'
export const fmtPostcode = (raw: string) => { const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length > 3 ? `${c.slice(0, -3)} ${c.slice(-3)}` : c }

async function saveRows(rows: { postcode: string; e: number; n: number }[]) {
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(postcodeGeo).values(rows.slice(i, i + 500)).onConflictDoUpdate({ target: postcodeGeo.postcode, set: { e: sql`excluded.e`, n: sql`excluded.n` } })
  }
}

/** Downloads Code-Point Open (about 20 MB) and keeps the HA and NW postcode areas. */
async function loadCodePoint(): Promise<number> {
  const res = await fetch(CODEPOINT, { signal: AbortSignal.timeout(5 * 60_000) })
  if (!res.ok) throw new Error(`OS download answered ${res.status}`)
  const files = unzip(Buffer.from(await res.arrayBuffer()), (n) => /(^|\/)(ha|nw)\.csv$/i.test(n))
  if (!files.size) throw new Error('OS download had no HA/NW files')
  const rows: { postcode: string; e: number; n: number }[] = []
  for (const buf of files.values()) {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      const f = line.split(',')
      const e = Number(f[2]), n = Number(f[3])
      if (f[0] && e && n) rows.push({ postcode: fmtPostcode(f[0].replace(/"/g, '')), e, n })
    }
  }
  await saveRows(rows)
  return rows.length
}

/** postcodes.io bulk look-up (100 at a time): the fallback when the OS file can't be fetched. */
async function fromPostcodesIo(pcs: string[]): Promise<number> {
  let saved = 0
  for (let i = 0; i < pcs.length; i += 100) {
    const res = await fetch('https://api.postcodes.io/postcodes?filter=postcode,eastings,northings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postcodes: pcs.slice(i, i + 100) }), signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`postcodes.io answered ${res.status}`)
    const body = (await res.json()) as { result?: { result: { postcode: string; eastings: number | null; northings: number | null } | null }[] }
    const rows = (body.result ?? []).map((r) => r.result).filter((r): r is { postcode: string; eastings: number; northings: number } => !!r?.eastings && !!r.northings)
      .map((r) => ({ postcode: fmtPostcode(r.postcode), e: r.eastings, n: r.northings }))
    await saveRows(rows)
    saved += rows.length
  }
  return saved
}

/** Keeps the postcode positions loaded: Code-Point every few months, postcodes.io for any gaps. Safe to call often. */
export async function refreshPostcodeGeo() {
  await ready()
  const client = getClient()
  const claim = await client.execute({
    sql: `INSERT INTO jobs (name, last_run_at) VALUES ('${KEY}', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`,
    args: [new Date().toISOString(), new Date(Date.now() - 6 * 3600_000).toISOString()],
  })
  if (claim.rowsAffected !== 1) return { ran: false }
  const row = await db.query.settings.findFirst({ where: eq(settings.key, KEY) })
  const st = (row ? JSON.parse(row.value) : {}) as { codepointAt?: string; lastError?: string | null }
  const save = (v: object) => db.insert(settings).values({ key: KEY, value: JSON.stringify(v), updatedAt: now() }).onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(v), updatedAt: now() } })
  let loaded = 0, error: string | null = null
  if (!st.codepointAt || Date.now() - new Date(st.codepointAt).getTime() > 90 * 86400000) {
    try { loaded = await loadCodePoint(); st.codepointAt = now() } catch (e) { error = e instanceof Error ? e.message : String(e) }
  }
  // Any sold-price postcodes still without a position (new postcodes, or if the OS download failed).
  const missing = (await client.execute('SELECT DISTINCT s.postcode FROM sold_prices s LEFT JOIN postcode_geo g ON g.postcode = s.postcode WHERE g.postcode IS NULL LIMIT 3000')).rows.map((r) => String(r.postcode))
  let filled = 0
  if (missing.length) { try { filled = await fromPostcodesIo(missing) } catch (e) { error = [error, e instanceof Error ? e.message : String(e)].filter(Boolean).join('; ') } }
  await save({ ...st, lastError: error, lastRunAt: now() })
  return { ran: true, loaded, filled, error }
}

/** Where one postcode is, looking it up (and remembering it) if we don't have it yet. */
export async function positionOf(postcode: string): Promise<{ e: number; n: number } | null> {
  await ready()
  const pc = fmtPostcode(postcode)
  const hit = await db.query.postcodeGeo.findFirst({ where: eq(postcodeGeo.postcode, pc) })
  if (hit) return { e: hit.e, n: hit.n }
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}?filter=postcode,eastings,northings`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const r = ((await res.json()) as { result?: { eastings: number | null; northings: number | null } }).result
    if (!r?.eastings || !r.northings) return null
    await saveRows([{ postcode: pc, e: r.eastings, n: r.northings }])
    return { e: r.eastings, n: r.northings }
  } catch { return null }
}

export async function positionsOf(pcs: string[]) {
  if (!pcs.length) return new Map<string, { e: number; n: number }>()
  const rows = await db.select().from(postcodeGeo).where(inArray(postcodeGeo.postcode, pcs))
  return new Map(rows.map((r) => [r.postcode, { e: r.e, n: r.n }]))
}
