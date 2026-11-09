import 'server-only'
import { cached } from './lookup-cache'
import { distanceText, metresBetween, walkMinutes, type LatLon } from './geo'
import { STATIONS, stationByName } from './stations'

// What buyers (and tenants) care about near a home: stations, schools, shops, parks and everyday essentials.
// From OpenStreetMap (free, open data, © OpenStreetMap contributors) via the Overpass API, asked once per postcode
// and kept for 30 days. Stations fall back to our own list if OpenStreetMap can't be reached.

export type PlaceKind = 'station' | 'school' | 'shop' | 'park' | 'health' | 'gym'
export type Place = { key: string; kind: PlaceKind; name: string; detail: string; metres: number; minutes: number; lat: number; lon: number }
type Raw = { kind: string; name: string; lat: number; lon: number; tags: Record<string, string> }

const OVERPASS = 'https://overpass-api.de/api/interpreter'
const UA = 'PrestonHillEstates/1.0 (+https://www.prestonhillestates.com)'

function query(p: LatLon) {
  const at = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`
  return `[out:json][timeout:10];
(
  nwr(around:2000,${at})["railway"="station"];
  nwr(around:2000,${at})["station"="subway"];
  nwr(around:1600,${at})["amenity"="school"]["name"];
  nwr(around:1500,${at})["shop"="supermarket"]["name"];
  nwr(around:1800,${at})["leisure"="park"]["name"];
  nwr(around:1500,${at})["amenity"="doctors"]["name"];
  nwr(around:1200,${at})["amenity"="pharmacy"]["name"];
  nwr(around:1500,${at})["leisure"="fitness_centre"]["name"];
);
out center tags;`
}

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

async function fromOverpass(p: LatLon): Promise<Raw[]> {
  const res = await fetch(OVERPASS, {
    method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query(p))}`, signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new Error(`OpenStreetMap answered ${res.status}`)
  return parseOverpass((await res.json()) as { elements?: OverpassElement[] })
}

const phase = (r: Raw): 'primary' | 'secondary' | null => {
  const lvl = r.tags['isced:level'] ?? ''
  if (/primary|infant|junior|first school|nursery/i.test(r.name) || /^[01](;|$)/.test(lvl)) return 'primary'
  if (/high school|secondary|academy|college|grammar|upper school/i.test(r.name) || /[23]/.test(lvl)) return 'secondary'
  return null
}

/** Picks the places worth showing from everything nearby: the nearest of each kind, a few of each at most. */
export function pickPlaces(home: LatLon, raw: Raw[]): Place[] {
  const withDist = raw.map((r) => ({ ...r, metres: Math.round(metresBetween(home, r)) })).sort((a, b) => a.metres - b.metres)
  const seen = new Set<string>()
  const take = (r: (typeof withDist)[number], kind: PlaceKind, name: string, detail: string): Place | null => {
    const k = `${kind}:${name.toLowerCase()}`
    if (seen.has(k)) return null
    seen.add(k)
    return { key: k, kind, name, detail, metres: r.metres, minutes: walkMinutes(r.metres), lat: r.lat, lon: r.lon }
  }
  const out: (Place | null)[] = []
  // Stations: OpenStreetMap's positions, our lines. Bus stops and depots aren't in the query.
  const stations = withDist.filter((r) => r.kind === 'station' && stationByName(r.name))
  const stationList = stations.length ? stations : STATIONS.map((s) => ({ kind: 'station', name: s.name, lat: s.lat, lon: s.lon, tags: {}, metres: Math.round(metresBetween(home, s)) })).sort((a, b) => a.metres - b.metres)
  for (const s of stationList.slice(0, 6)) {
    if (out.filter(Boolean).filter((p) => p!.kind === 'station').length >= 2) break
    const st = stationByName(s.name)
    out.push(take(s, 'station', st?.name ?? s.name, st ? st.lines.join(', ') : 'Station'))
  }
  // Schools: the nearest primary and secondary, then the next nearest.
  const schools = withDist.filter((r) => r.kind === 'school' && !/nursery|pre-?school|playgroup|tuition|driving|dance|language school/i.test(r.name))
  const prim = schools.find((r) => phase(r) === 'primary'), sec = schools.find((r) => phase(r) === 'secondary')
  if (prim) out.push(take(prim, 'school', prim.name, 'Primary school'))
  if (sec) out.push(take(sec, 'school', sec.name, 'Secondary school'))
  const other = schools.find((r) => r !== prim && r !== sec)
  if (other && out.filter((p) => p?.kind === 'school').length < 3) out.push(take(other, 'school', other.name, phase(other) === 'primary' ? 'Primary school' : phase(other) === 'secondary' ? 'Secondary school' : 'School'))
  // Supermarkets: two different names.
  for (const r of withDist.filter((x) => x.kind === 'shop').slice(0, 6)) {
    if (out.filter((p) => p?.kind === 'shop').length >= 2) break
    out.push(take(r, 'shop', r.name, 'Supermarket'))
  }
  for (const r of withDist.filter((x) => x.kind === 'park').slice(0, 4)) {
    if (out.filter((p) => p?.kind === 'park').length >= 2) break
    out.push(take(r, 'park', r.name, 'Park'))
  }
  const gp = withDist.find((r) => r.kind === 'health' && r.tags.amenity === 'doctors')
  if (gp) out.push(take(gp, 'health', gp.name, 'GP surgery'))
  const chemist = withDist.find((r) => r.kind === 'health' && r.tags.amenity === 'pharmacy')
  if (chemist) out.push(take(chemist, 'health', chemist.name, 'Pharmacy'))
  const gym = withDist.find((r) => r.kind === 'gym')
  if (gym) out.push(take(gym, 'gym', gym.name, 'Gym'))
  return out.filter((p): p is Place => !!p)
}

/** The places worth mentioning near a home. `source` says where they came from, for the check page. */
export async function placesNear(postcode: string, home: LatLon): Promise<{ places: Place[]; source: 'openstreetmap' | 'stations only'; error: string | null }> {
  const r = await cached<Raw[]>(`places:${postcode}`, 30, () => fromOverpass(home))
  if (r.data?.length) return { places: pickPlaces(home, r.data), source: 'openstreetmap', error: r.error }
  return { places: pickPlaces(home, []), source: 'stations only', error: r.error ?? 'nothing found nearby' }
}

export const placeLine = (p: Place) => `${p.name}: ${p.detail} · about ${p.minutes} min walk (${distanceText(p.metres)})`
