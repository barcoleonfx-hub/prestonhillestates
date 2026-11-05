import { normPostcode, normText } from './licensing-extract'

// Matching an address as it's written on a spreadsheet ("369 Westcroft", "15 SYILVIA GARDENDS", "Flat 9 Wendover
// Court") to one of our own properties ("369 Westcroft Way, Kingsbury"). Pure functions, so they can be tested alone.

export const compactOf = (s: string) => s.replace(/\s+/g, '')
const ENDS = 'road|avenue|street|crescent|gardens|close|drive|lane|court|park|square|terrace|place|way|grove|walk|rise|hill|mews|view|parade|green|row|gate|vale|end|house|mansions|broadway|circus|approach|chase|heights|gardends'
export const STREET_END = new RegExp(`\\s(${ENDS})$`)
const STREET_WORD = new RegExp(`^(${ENDS}|garden)$`)
const BUILDING_WORD = /^(court|house|lodge|mansions|heights|point|place|tower|apartments)$/

export function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 3) return 9
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  // Two letters swapped ("wembely") counts as one slip.
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
  }
  return d[a.length][b.length]
}

/** How well a typed street ("westcroft", "mountsteward", "tokington") fits a real one ("westcroft way"). 99: not at all. */
export function fits(typed: string, real: string): number {
  const t = compactOf(typed), r = compactOf(real.replace(STREET_END, ''))
  if (!t) return 99
  if (r === t || compactOf(real) === t) return 0
  if (r.startsWith(t) && t.length >= 4) return 0.5 // shortened: "westcroft" → "westcroftway"
  // Misspelt: one letter out if it starts the same; two only for long names sharing their first three letters
  // (so "Flamstead" is never read as "Farmstead").
  const allowed = (x: string) => (t[0] !== x[0] ? 0 : t.length >= 8 && t.slice(0, 3) === x.slice(0, 3) ? 2 : t.length >= 5 ? 1 : 0)
  if (t.length >= 5) { const d = distance(t, r); if (d <= allowed(r)) return d }
  if (t.length >= 6 && r.length > t.length) { const x = r.slice(0, t.length); const d = distance(t, x); if (d <= Math.min(1, allowed(x))) return 1.5 }
  return 99
}

export type Parsed = { flat: string | null; num: string | null; street: string; building: string | null; type: string | null }
// "Garden", "Gardends" and "Gardens" are the same kind of street; "Avenue" and "Road" are not.
const typeOf = (w: string | undefined) => (!w || !STREET_WORD.test(w) ? null : /^garden/.test(w) ? 'gardens' : w)

/** "Flat 3, Rayan Court, 12 Kenton Rd, Harrow" → flat 3, number 12, street "kenton road", building "rayan court". */
export function parseAddress(line: string): Parsed {
  // "ROOM-2", "studio", "G/F back": parts of a home, not part of its address.
  const a = normText(line).replace(/\b(room|bedroom|studio)\s*\d*[a-z]?\b|\b(ground|first|second|top|lower|upper) floor\b|\b(basement|garden flat|front|back|rear|g f)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const flat = /\b(?:flat|apartment|apt|unit)\s*-?\s*([0-9]+[a-z]?|[a-z])\b/.exec(a)?.[1] ?? null
  const rest = a.replace(/\b(?:flat|apartment|apt|unit)\s*-?\s*(?:[0-9]+[a-z]?|[a-z])\b/, ' ').replace(/\s+/g, ' ').trim()
  // The first house number counts: "1a beech way 1" is number 1a.
  const m = /^(?:(.*?)\s)??(\d+[a-z]?)\s+([a-z].*)$/.exec(rest)
  const words = (m ? m[3] : rest).split(' ').filter(Boolean)
  // The street runs to its "road / avenue / close…" word; without one, the first two words ("369 westcroft").
  const end = words.findIndex((w, i) => i > 0 && STREET_WORD.test(w))
  const street = (end >= 0 && end < 5 ? words.slice(0, end + 1) : words.slice(0, 2)).join(' ')
  const before = m?.[1]?.trim() || null
  const bwords = (before ?? rest).split(' ')
  const bend = bwords.findIndex((w, i) => i > 0 && BUILDING_WORD.test(w))
  const building = before ?? (bend >= 0 && bend < 4 ? bwords.slice(0, bend + 1).join(' ') : null)
  return { flat, num: m?.[2] ?? null, street, building, type: end >= 0 && end < 5 ? typeOf(words[end]) : null }
}

/** How well a typed address fits one of ours: 0 exact, up to 2 misspelt, 3+ a flat missing on one side; 99 no. */
export function score(typed: Parsed, real: Parsed, streetExists?: (street: string) => boolean | undefined): number {
  if (typed.flat && real.flat && typed.flat !== real.flat) return 99
  const flatGap = (typed.flat ? 1 : 0) + (real.flat ? 1 : 0) === 1 ? 3 : 0
  if (typed.num) {
    if (typed.num === real.num) {
      // "121 Victoria Avenue" is not "121 Victor Road". "9 Harkett Road" for our "9 Harkett Close" probably is, but
      // only when no Harkett Road exists: Barn Rise and Barn Hill are both real streets in Wembley.
      if (typed.type && real.type && typed.type !== real.type) {
        const core = typed.street.replace(STREET_END, '').replace(/^the\s/, '')
        return core.length >= 4 && fits(core, real.street.replace(/^the\s/, '')) === 0 && streetExists?.(typed.street) === false ? 4 + flatGap : 99
      }
      const s = fits(typed.street.replace(STREET_END, ''), real.street)
      return s >= 99 ? 99 : s + flatGap
    }
    // "Flat 6A Haydan Close" read as number 6a where we have Flat 6A in a building: compare the building instead.
    if (!real.num && real.building && real.flat === typed.num) return Math.min(99, fits(typed.street.replace(STREET_END, ''), real.building) + 1)
    return 99
  }
  // No house number: "Flat 9 Wendover Court" against the building's name.
  const tb = typed.building ?? typed.street
  for (const rb of [real.building, real.street].filter(Boolean) as string[]) {
    const s = fits(tb.replace(/\s(court|house|lodge|mansions|heights|point|place|tower|apartments)$/, ''), rb.replace(/\s(court|house|lodge|mansions|heights|point|place|tower|apartments)$/, ''))
    if (s < 99) return s + flatGap
  }
  return 99
}

export type Known = { id: string; address: string; postcode: string | null; other?: (string | null)[]; trustedPostcode?: boolean }
export type Match = { kind: 'matched' | 'likely' | 'choose' | 'none'; id: string | null; candidates: { id: string; score: number }[] }

/**
 * Finds which of our properties a spreadsheet row means. `matched`: clearly one property; `likely`: one property
 * but spelt differently or with a flat number missing (worth a glance); `choose`: more than one fits equally;
 * `none`: nothing fits, with the nearest few as candidates.
 */
export function matchAddress(address: string, postcode: string | null, known: Known[], byNum?: Map<string, Known[]>, streetExists?: (street: string) => boolean | undefined): Match {
  const t = parseAddress(address)
  if (!t.num && !t.building && !t.street) return { kind: 'none', id: null, candidates: [] }
  const pc = normPostcode(postcode)
  const pool = t.num && byNum ? [...(byNum.get(t.num) ?? []), ...(byNum.get('') ?? [])] : known
  const scored: { id: string; score: number }[] = []
  for (const k of pool) {
    let best = 99
    for (const a of [k.address, ...(k.other ?? [])]) if (a) best = Math.min(best, score(t, parseAddress(a), streetExists))
    if (best >= 99) continue
    // A different postcode rules it out when both are known for sure; a postcode we worked out ourselves only counts against it.
    if (pc && k.postcode && normPostcode(k.postcode) !== pc) { if (k.trustedPostcode) continue; best += 1 }
    scored.push({ id: k.id, score: best })
  }
  scored.sort((a, b) => a.score - b.score)
  if (!scored.length) {
    // Nothing fits: offer properties with the same house number, nearest street name first.
    const same = (t.num && byNum ? byNum.get(t.num) ?? [] : []).map((k) => ({ id: k.id, score: 50 + distance(compactOf(t.street), compactOf(parseAddress(k.address).street)) }))
    return { kind: 'none', id: null, candidates: same.sort((a, b) => a.score - b.score).slice(0, 6) }
  }
  const top = scored.filter((s) => s.score === scored[0].score)
  if (top.length > 1) return { kind: 'choose', id: null, candidates: scored.slice(0, 6) }
  return { kind: scored[0].score <= 0.5 ? 'matched' : 'likely', id: scored[0].id, candidates: scored.slice(0, 6) }
}

/** Our properties filed by house number, so each row is only compared with likely ones. Key '' holds those without. */
export function indexByNumber(known: Known[]): Map<string, Known[]> {
  const out = new Map<string, Known[]>()
  for (const k of known) {
    const nums = new Set([k.address, ...(k.other ?? [])].filter(Boolean).map((a) => parseAddress(a!).num ?? ''))
    for (const n of nums) out.set(n, [...(out.get(n) ?? []), k])
  }
  return out
}
