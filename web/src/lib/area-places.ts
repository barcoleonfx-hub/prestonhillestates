import 'server-only'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { areaPlaces, settings } from '@/db/schema'
import type { LatLon } from './geo'
import { now } from './util'

// Our own copy of the places buyers care about (schools, supermarkets, parks, GPs, pharmacies, gyms, stations)
// for the whole patch, from OpenStreetMap (© OpenStreetMap contributors), so a booklet never waits on a public
// server. The patch is split into small squares, fetched in the background a couple at a time (small requests
// rarely time out); a square that fails is simply tried again later, and each is refreshed monthly. Until a
// home's squares are in, the booklet asks OpenStreetMap about that postcode directly (area-facts.ts).

export type Raw = { kind: string; name: string; lat: number; lon: number; tags: Record<string, string> }

// The main Overpass server is often busy; these public mirrors serve the same OpenStreetMap data.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
const UA = 'PrestonHillEstates/1.0 (+https://www.prestonhillestates.com)'

type OverpassElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

/** The raw answer from OpenStreetMap, as a flat list of named places with a position. */
export function parseOverpass(body: { elements?: OverpassElement[] }): Raw[] {
  const out: Raw[] = []
  for (const el of body.elements ?? []) {
    const t = el.tags ?? {}
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon
    if (lat == null || lon == null || !t.name) continue
    const kind = t.railway === 'station' || t.station === 'subway' ? 'station' : t.amenity === 'school' ? 'school' : t.shop === 'supermarket' ? 'shop'
      : t.leisure === 'park' ? 'park' : t.amenity === 'doctors' || t.amenity === 'pharmacy' ? 'health' : t.leisure === 'fitness_centre' ? 'gym' : null
    if (kind) out.push({ kind, name: t.name.trim(), lat, lon, tags: t })
  }
  return out
}

/** Asks each Overpass server in turn until one gives a complete answer; says what each one said if none does. */
export async function runOverpass(q: string, timeoutMs: number): Promise<Raw[]> {
  const said: string[] = []
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) { said.push(`${new URL(url).host} answered ${res.status}`); continue }
      const body = (await res.json()) as { elements?: OverpassElement[]; remark?: string }
      // A query that runs out of time still answers "OK", with only what it found so far: not good enough to keep.
      if (/runtime error|timed out|out of memory/i.test(body.remark ?? '')) { said.push(`${new URL(url).host}: ${body.remark!.slice(0, 80)}`); continue }
      return parseOverpass(body)
    } catch (e) {
      said.push(`${new URL(url).host}: ${(e as Error).name === 'TimeoutError' ? 'took too long' : String((e as Error).message ?? e).slice(0, 80)}`)
    }
  }
  throw new Error(said.join('; '))
}

// The patch: Pinner and Rayners Lane in the west to Kingsbury and Neasden in the east, Stanmore and Edgware in the
// north to Alperton and Wembley in the south. Squares of about 2.2 km.
const S = 51.525, N = 51.635, W = -0.405, E = -0.225, DLAT = 0.02, DLON = 0.032
const ROWS = Math.ceil((N - S) / DLAT), COLS = Math.ceil((E - W) / DLON)
const KEY = 'area_places'
const MONTH = 30 * 86400_000

type Square = { id: string; s: number; w: number; n: number; e: number }
const squares: Square[] = []
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const s = S + r * DLAT, w = W + c * DLON
  squares.push({ id: `${r}-${c}`, s: +s.toFixed(4), w: +w.toFixed(4), n: +(s + DLAT).toFixed(4), e: +(w + DLON).toFixed(4) })
}

type State = { squares: Record<string, { okAt?: string; triedAt?: string; error?: string | null; count?: number }> }
async function loadState(): Promise<State> {
  const r = await db.query.settings.findFirst({ where: eq(settings.key, KEY) })
  try { return r ? (JSON.parse(r.value) as State) : { squares: {} } } catch { return { squares: {} } }
}
const saveState = (st: State) => db.insert(settings).values({ key: KEY, value: JSON.stringify(st), updatedAt: now() })
  .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(st), updatedAt: now() } })

function squareQuery(q: Square) {
  return `[out:json][timeout:90][bbox:${q.s},${q.w},${q.n},${q.e}];
(
  nw["amenity"="school"]["name"];
  nw["shop"="supermarket"]["name"];
  nwr["leisure"="park"]["name"];
  nw["amenity"="doctors"]["name"];
  nw["amenity"="pharmacy"]["name"];
  nw["leisure"="fitness_centre"]["name"];
  node["railway"="station"];
);
out center tags qt;`
}

let running = false
/**
 * Fetches the squares that are missing or more than a month old, two per run at most (called from the two-minute
 * tick). A square that failed waits 30 minutes before it's tried again. Safe to call often.
 */
export async function refreshAreaPlaces(): Promise<{ ran: boolean; done: number; total: number; error?: string }> {
  if (running) return { ran: false, done: 0, total: squares.length }
  running = true
  try {
    await ready()
    const st = await loadState()
    const due = squares.filter((q) => {
      const x = st.squares[q.id]
      if (x?.okAt && Date.now() - new Date(x.okAt).getTime() < MONTH) return false
      return !x?.triedAt || Date.now() - new Date(x.triedAt).getTime() > 30 * 60_000 || !!x.okAt
    })
    let lastError: string | undefined
    for (const q of due.slice(0, 2)) {
      const mark = { ...(st.squares[q.id] ?? {}), triedAt: now() }
      try {
        const raw = await runOverpass(squareQuery(q), 100_000)
        // Keep only what falls inside this square (centres of big parks can fall just outside).
        const inside = raw.filter((r) => r.lat >= q.s && r.lat < q.n && r.lon >= q.w && r.lon < q.e)
        await db.delete(areaPlaces).where(eq(areaPlaces.square, q.id))
        const rows = inside.map((r, i) => ({ id: `${q.id}:${i}`, square: q.id, kind: r.kind, name: r.name.slice(0, 160), lat: r.lat, lon: r.lon, tags: JSON.stringify(pick(r.tags)) }))
        for (let i = 0; i < rows.length; i += 200) await db.insert(areaPlaces).values(rows.slice(i, i + 200)).onConflictDoNothing()
        st.squares[q.id] = { ...mark, okAt: now(), error: null, count: rows.length }
      } catch (e) {
        lastError = String((e as Error).message ?? e).slice(0, 300)
        st.squares[q.id] = { ...mark, error: lastError }
      }
      await saveState(st)
    }
    return { ran: true, done: squares.filter((q) => st.squares[q.id]?.okAt).length, total: squares.length, ...(lastError ? { error: lastError } : {}) }
  } finally { running = false }
}

// Only the tags we read back (school phase, the kind of health place, station tags).
const pick = (t: Record<string, string>) => Object.fromEntries(Object.entries(t).filter(([k]) => ['amenity', 'shop', 'leisure', 'railway', 'station', 'isced:level', 'school'].includes(k)))

/**
 * Places near a home from our own copy, or null if the squares around it (about 2 km each way) aren't all in yet,
 * or it's outside the patch.
 */
export async function localPlaces(home: LatLon): Promise<Raw[] | null> {
  await ready()
  const dLat = 0.018, dLon = 0.029 // about 2 km
  const box = { s: home.lat - dLat, n: home.lat + dLat, w: home.lon - dLon, e: home.lon + dLon }
  if (box.s < S || box.n > N || box.w < W || box.e > E) {
    // Partly outside the patch: fine as long as the home itself is inside and its own squares are in.
    if (home.lat < S || home.lat > N || home.lon < W || home.lon > E) return null
  }
  const need = squares.filter((q) => q.n > box.s && q.s < box.n && q.e > box.w && q.w < box.e)
  const st = await loadState()
  if (!need.length || need.some((q) => !st.squares[q.id]?.okAt)) return null
  const rows = await db.select().from(areaPlaces).where(and(gte(areaPlaces.lat, box.s), lte(areaPlaces.lat, box.n), gte(areaPlaces.lon, box.w), lte(areaPlaces.lon, box.e)))
  return rows.map((r) => ({ kind: r.kind, name: r.name, lat: r.lat, lon: r.lon, tags: { ...(JSON.parse(r.tags || '{}') as Record<string, string>), name: r.name } }))
}

/** How far the copy has got, for the check page. */
export async function areaPlacesStatus() {
  await ready()
  const st = await loadState()
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(areaPlaces)
  const errors = Object.entries(st.squares).filter(([, v]) => v.error && !v.okAt).map(([k, v]) => `${k}: ${v.error}`).slice(0, 5)
  return { squaresDone: squares.filter((q) => st.squares[q.id]?.okAt).length, squares: squares.length, places: Number(n), errors }
}
