import 'server-only'
import { normText } from './licensing-extract'
import { STREET_END, compactOf, fits } from './property-match'

// Finding the postcode for an address typed the way people type them in a spreadsheet: shortened
// ("369 Westcroft"), joined up ("Mountsteward"), misspelt ("Tokington", "Haydan Close"), or a flat
// in a named building ("Flat 1, Rayan Court"). Uses the Land Registry address list held in the portal.

// Postcode districts in each council, so a guess in the wrong borough is never taken.
const DISTRICTS: Record<string, string[]> = {
  brent: ['HA0', 'HA3', 'HA8', 'HA9', 'NW2', 'NW6', 'NW9', 'NW10', 'W9', 'W10'],
  harrow: ['HA0', 'HA1', 'HA2', 'HA3', 'HA5', 'HA6', 'HA7', 'HA8', 'HA9', 'NW9'],
  barnet: ['N2', 'N3', 'N10', 'N11', 'N12', 'N14', 'N20', 'EN4', 'EN5', 'HA8', 'NW2', 'NW4', 'NW7', 'NW9', 'NW11'],
  ealing: ['UB1', 'UB2', 'UB5', 'UB6', 'W3', 'W5', 'W7', 'W13', 'HA0', 'NW10'],
  hillingdon: ['HA4', 'HA5', 'HA6', 'UB3', 'UB4', 'UB7', 'UB8', 'UB9', 'UB10', 'UB11'],
}
const outward = (pc: string) => pc.split(' ')[0]

type Entry = { pc: string; num: string | null; street: string; flat: string | null }

const BUILDING = /^(.+?\s(?:court|house|lodge|mansions|heights|point|place|tower|apartments))\b/
// Streets and buildings are filed under their first two letters, so a fuzzy look-up only compares likely names.
const head = (s: string) => compactOf(s).slice(0, 2)

/** "flat 3 rayan court 12 kenton road" → the pieces the look-up table is built from. */
function parse(line: string) {
  const n = normText(line).trim()
  const flat = /^(?:flat|apartment|unit)\s+([0-9]+[a-z]?)\s+/.exec(n)?.[1] ?? null
  const rest = flat ? n.replace(/^(?:flat|apartment|unit)\s+[0-9]+[a-z]?\s+/, '') : n
  const m = /^(?:(.*?)\s)?(\d+[a-z]?)\s+(.+)$/.exec(rest)
  if (!m) return { flat, num: null, street: rest, building: rest.split(' ').slice(0, 3).join(' ') }
  return { flat, num: m[2], street: m[3], building: m[1] ?? BUILDING.exec(m[3])?.[1] ?? null }
}

// ---------- the look-up table (address_keys), built from known_addresses ----------

let building: Promise<void> | null = null
async function buildKeys() {
  const { getClient } = await import('@/db/client')
  const c = getClient()
  await c.execute('DELETE FROM address_keys')
  let last = 0
  for (;;) {
    const rows = (await c.execute({ sql: 'SELECT rowid AS id, postcode, line FROM known_addresses WHERE rowid > ? ORDER BY rowid LIMIT 4000', args: [last] })).rows as unknown as { id: number; postcode: string; line: string }[]
    if (!rows.length) break
    last = Number(rows[rows.length - 1].id)
    const out: (string | null)[][] = []
    const seen = new Set<string>()
    for (const r of rows) {
      const e = parse(r.line)
      if (e.num) out.push(['num', e.num, e.street, e.flat, r.postcode])
      if (e.building) out.push(['bld', head(e.building), e.building, e.flat ?? e.num, r.postcode])
      const sk = `${e.street}|${r.postcode}`
      if (!seen.has(sk)) { seen.add(sk); out.push(['st', head(e.street), e.street, null, r.postcode]) }
    }
    // One statement per chunk with the rows as a single JSON value: far less native memory than many
    // multi-row INSERTs (the database driver keeps hold of memory used for statement parameters).
    await c.execute({ sql: 'INSERT INTO address_keys (kind, k, street, flat, pc) SELECT value->>0, value->>1, value->>2, value->>3, value->>4 FROM json_each(?)', args: [JSON.stringify(out)] })
  }
  const n = Number((await c.execute('SELECT count(*) AS n FROM known_addresses')).rows[0].n)
  await c.execute({ sql: `INSERT INTO settings (key, value, updated_at) VALUES ('address_keys', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, args: [String(n), new Date().toISOString()] })
}

/** True when the look-up table is up to date. Starts (re)building it in the background when it isn't. */
async function keysReady(wait: boolean): Promise<boolean> {
  const { getClient } = await import('@/db/client')
  const c = getClient()
  const [have, want] = await Promise.all([
    c.execute("SELECT value FROM settings WHERE key = 'address_keys'").then((r) => Number(r.rows[0]?.value ?? 0)),
    c.execute('SELECT count(*) AS n FROM known_addresses').then((r) => Number(r.rows[0].n)),
  ])
  if (!want) return false
  // Rebuild when the address list has grown by more than 2% (the Land Registry archive loads in stages).
  if (have && Math.abs(want - have) / want < 0.02) return true
  building ??= buildKeys().catch((e) => console.error('address look-up build failed', e)).finally(() => { building = null })
  if (wait) { await building; return true }
  return false
}

async function byNum(num: string): Promise<Entry[]> {
  const { getClient } = await import('@/db/client')
  const r = await getClient().execute({ sql: "SELECT street, flat, pc FROM address_keys WHERE kind = 'num' AND k = ?", args: [num] })
  return (r.rows as unknown as { street: string; flat: string | null; pc: string }[]).map((x) => ({ pc: x.pc, num, street: x.street, flat: x.flat }))
}
async function byHead(kind: 'st' | 'bld', name: string): Promise<Map<string, Entry[]>> {
  const { getClient } = await import('@/db/client')
  const r = await getClient().execute({ sql: 'SELECT street, flat, pc FROM address_keys WHERE kind = ? AND k = ?', args: [kind, head(name)] })
  const out = new Map<string, Entry[]>()
  for (const x of r.rows as unknown as { street: string; flat: string | null; pc: string }[]) out.set(x.street, [...(out.get(x.street) ?? []), { pc: x.pc, num: x.flat, street: x.street, flat: x.flat }])
  return out
}

export type PostcodeGuess = { postcode: string; street: string; how: string; resolved: string | null }
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

/** The postcode for an address, when the Land Registry list points to exactly one (in the right council). */
export async function guessPostcode(address: string, council: string | null, opts: { wait?: boolean } = {}): Promise<PostcodeGuess | null> {
  if (!(await keysReady(!!opts.wait))) return null
  const a = normText(address).replace(/\b(room|studio|ground floor|first floor|top floor|basement)\b.*$/, ' ').trim()
  const okDistrict = (pc: string) => !council || !DISTRICTS[council] || DISTRICTS[council].includes(outward(pc))
  const flatNo = /\b(?:flat|apartment|apt|unit)\s*-?\s*([0-9]+[a-z]?)\b/.exec(a)?.[1] ?? null
  const rest = a.replace(/\b(?:flat|apartment|apt|unit)\s*-?\s*[0-9]+[a-z]?\b/, ' ').replace(/\s+/g, ' ').trim()
  const pick = (hits: { e: Entry; score: number }[], how: string): PostcodeGuess | null => {
    const inArea = hits.filter((h) => okDistrict(h.e.pc))
    if (!inArea.length) return null
    const best = Math.min(...inArea.map((h) => h.score))
    const top = inArea.filter((h) => h.score === best)
    const streetsHit = [...new Set(top.map((h) => h.e.street))]
    const pcs = [...new Set(top.map((h) => h.e.pc))]
    if (pcs.length === 1) return { postcode: pcs[0], street: streetsHit[0], how, resolved: null }
    return null
  }
  // 1. Number and street: "369 westcroft", "106 fortunegate", "71 ballard rd"
  const m = /\b(\d+[a-z]?)\s+([a-z][a-z ]{2,40})/.exec(rest)
  if (m) {
    const typed = m[2].replace(STREET_END, '').trim().split(' ').slice(0, 3).join(' ')
    const hits = (await byNum(m[1])).map((e) => ({ e, score: fits(typed, e.street) })).filter((h) => h.score < 99)
    const g = pick(hits, 'Land Registry address list')
    if (g) return { ...g, resolved: `${flatNo ? `Flat ${flatNo}, ` : ''}${m[1].toUpperCase()} ${title(g.street)}`, how: `${m[1]} ${g.street}` !== rest.slice(rest.indexOf(m[1])).trim() ? `Land Registry address list (read as ${m[1]} ${g.street.replace(/\b\w/g, (c) => c.toUpperCase())})` : 'Land Registry address list' }
    // The number might not have sold since 1995: take the street's postcode if the whole street has just one.
    const street = [...(await byHead('st', typed)).entries()].map(([, es]) => ({ es, score: fits(typed, es[0].street) })).filter((x) => x.score <= 1)
    if (street.length === 1) {
      const pcs = [...new Set(street[0].es.map((e) => e.pc))].filter(okDistrict)
      if (pcs.length === 1) return { postcode: pcs[0], street: street[0].es[0].street, resolved: `${flatNo ? `Flat ${flatNo}, ` : ''}${m[1].toUpperCase()} ${title(street[0].es[0].street)}`, how: `the only postcode on ${title(street[0].es[0].street)}` }
    }
  }
  // 2. A flat in a named building: "flat 1 rayan court"
  const b = /^([a-z][a-z ]{3,40}?\s(?:court|house|lodge|mansions|heights|point|place|tower|apartments))\b/.exec(rest)
  if (b) {
    const typedB = b[1].replace(/\s(court|house|lodge|mansions|heights|point|place|tower|apartments)$/, '')
    const hits = [...(await byHead('bld', b[1])).entries()].filter(([k]) => fits(typedB, k.replace(/\s(court|house|lodge|mansions|heights|point|place|tower|apartments)$/, '')) <= 1)
      .flatMap(([, es]) => es).map((e) => ({ e, score: flatNo && (e.flat === flatNo || e.num === flatNo) ? 0 : 1 }))
    const g = pick(hits, 'Land Registry address list (by building name)')
    if (g) return g
  }
  return null
}
