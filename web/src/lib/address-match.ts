import 'server-only'
import { db } from '@/db/client'
import { knownAddresses } from '@/db/schema'
import { normText } from './licensing-extract'

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

type Entry = { pc: string; num: string | null; street: string; compact: string; building: string | null; flat: string | null }
let index: { at: number; byNum: Map<string, Entry[]>; byBuilding: Map<string, Entry[]>; streets: Map<string, Map<string, Entry[]>>; buildings: Map<string, Map<string, Entry[]>> } | null = null
// Streets and buildings grouped by their first two letters, so a fuzzy look-up only compares likely names.
const head = (s: string) => compactOf(s).slice(0, 2)
const add = (m: Map<string, Map<string, Entry[]>>, k: string, e: Entry) => { const g = m.get(head(k)) ?? new Map<string, Entry[]>(); g.set(k, [...(g.get(k) ?? []), e]); m.set(head(k), g) }

const compactOf = (s: string) => s.replace(/\s+/g, '')
const STREET_END = /\s(road|avenue|street|crescent|gardens|close|drive|lane|court|park|square|terrace|place|way|grove|walk|rise|hill|mews|view|parade|green|row|gate|vale|end|house|mansions|broadway|circus|approach|chase|heights)$/

async function load() {
  if (index && Date.now() - index.at < 3600_000) return index
  const rows = await db.select({ p: knownAddresses.postcode, l: knownAddresses.line }).from(knownAddresses)
  const byNum = new Map<string, Entry[]>(), byBuilding = new Map<string, Entry[]>(), streets = new Map<string, Map<string, Entry[]>>(), buildings = new Map<string, Map<string, Entry[]>>()
  for (const r of rows) {
    const n = normText(r.l).trim()
    // "flat 3 rayan court 12 kenton road", "12 kenton road", "rayan court kenton road"
    const flat = /^(?:flat|apartment|unit)\s+([0-9]+[a-z]?)\s+/.exec(n)?.[1] ?? null
    const rest = flat ? n.replace(/^(?:flat|apartment|unit)\s+[0-9]+[a-z]?\s+/, '') : n
    const m = /^(?:(.*?)\s)?(\d+[a-z]?)\s+(.+)$/.exec(rest)
    const e: Entry = m ? { pc: r.p, num: m[2], street: m[3], compact: compactOf(m[3]), building: m[1] ?? null, flat } : { pc: r.p, num: null, street: rest, compact: compactOf(rest), building: rest.split(' ').slice(0, 3).join(' '), flat }
    if (e.num) byNum.set(e.num, [...(byNum.get(e.num) ?? []), e])
    if (e.building) { byBuilding.set(e.building, [...(byBuilding.get(e.building) ?? []), e]); add(buildings, e.building, e) }
    // "1 bridgewater court bridgewater road": number 1 of the building, also a building in its own right.
    const asBuilding = /^(.+?\s(?:court|house|lodge|mansions|heights|point|place|tower|apartments))\b/.exec(e.street)?.[1]
    if (asBuilding && !e.building) add(buildings, asBuilding, e)
    add(streets, e.street, e)
  }
  index = { at: Date.now(), byNum, byBuilding, streets, buildings }
  return index
}

function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 3) return 9
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** How well a typed street ("westcroft", "mountsteward", "tokington") fits a real one ("westcroft way"). */
function fits(typed: string, real: string): number {
  const t = compactOf(typed), r = compactOf(real.replace(STREET_END, ''))
  if (r === t || compactOf(real) === t) return 0
  if (r.startsWith(t) && t.length >= 4) return 0.5 // shortened: "westcroft" → "westcroftway"
  // Misspelt: one letter out if it starts the same; two only for long names sharing their first three letters
  // (so "Flamstead" is never read as "Farmstead").
  const allowed = (x: string) => (t[0] !== x[0] ? 0 : t.length >= 8 && t.slice(0, 3) === x.slice(0, 3) ? 2 : t.length >= 5 ? 1 : 0)
  if (t.length >= 5) { const d = distance(t, r); if (d <= allowed(r)) return d }
  if (t.length >= 6 && r.length > t.length) { const x = r.slice(0, t.length); const d = distance(t, x); if (d <= Math.min(1, allowed(x))) return 1.5 }
  return 99
}

export type PostcodeGuess = { postcode: string; street: string; how: string; resolved: string | null }
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

/** The postcode for an address, when the Land Registry list points to exactly one (in the right council). */
export async function guessPostcode(address: string, council: string | null): Promise<PostcodeGuess | null> {
  const ix = await load()
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
    const hits = (ix.byNum.get(m[1]) ?? []).map((e) => ({ e, score: fits(typed, e.street) })).filter((h) => h.score < 99)
    const g = pick(hits, 'Land Registry address list')
    if (g) return { ...g, resolved: `${flatNo ? `Flat ${flatNo}, ` : ''}${m[1].toUpperCase()} ${title(g.street)}`, how: `${m[1]} ${g.street}` !== rest.slice(rest.indexOf(m[1])).trim() ? `Land Registry address list (read as ${m[1]} ${g.street.replace(/\b\w/g, (c) => c.toUpperCase())})` : 'Land Registry address list' }
    // The number might not have sold since 1995: take the street's postcode if the whole street has just one.
    const street = [...(ix.streets.get(head(typed))?.entries() ?? [])].map(([, es]) => ({ es, score: fits(typed, es[0].street) })).filter((x) => x.score <= 1)
    if (street.length === 1) {
      const pcs = [...new Set(street[0].es.map((e) => e.pc))].filter(okDistrict)
      if (pcs.length === 1) return { postcode: pcs[0], street: street[0].es[0].street, resolved: `${flatNo ? `Flat ${flatNo}, ` : ''}${m[1].toUpperCase()} ${title(street[0].es[0].street)}`, how: `the only postcode on ${title(street[0].es[0].street)}` }
    }
  }
  // 2. A flat in a named building: "flat 1 rayan court"
  const b = /^([a-z][a-z ]{3,40}?\s(?:court|house|lodge|mansions|heights|point|place|tower|apartments))\b/.exec(rest)
  if (b) {
    const typedB = b[1].replace(/\s(court|house|lodge|mansions|heights|point|place|tower|apartments)$/, '')
    const hits = [...(ix.buildings.get(head(b[1]))?.entries() ?? [])].filter(([k]) => fits(typedB, k.replace(/\s(court|house|lodge|mansions|heights|point|place|tower|apartments)$/, '')) <= 1)
      .flatMap(([, es]) => es).map((e) => ({ e, score: flatNo && (e.flat === flatNo || e.num === flatNo) ? 0 : 1 }))
    const g = pick(hits, 'Land Registry address list (by building name)')
    if (g) return g
  }
  return null
}
