import 'server-only'
import { cached } from './lookup-cache'
import { distanceText, metresBetween, walkMinutes, type LatLon } from './geo'
import { STATIONS, stationByName } from './stations'
import { localPlaces, runOverpass, type Raw } from './area-places'
export { parseOverpass } from './area-places'

// What buyers (and tenants) care about near a home: stations, schools, shops, parks and everyday essentials, from
// OpenStreetMap (free, open data, © OpenStreetMap contributors). Normally read from our own copy for the whole patch
// (area-places.ts, filled in the background); for a home outside it, asked once per postcode and kept for 30 days.
// Stations fall back to our own list if nothing else is to hand.

export type PlaceKind = 'station' | 'school' | 'shop' | 'park' | 'health' | 'gym'
export type Place = { key: string; kind: PlaceKind; name: string; detail: string; metres: number; minutes: number; lat: number; lon: number }

function query(p: LatLon) {
  const at = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`
  // Lighter first: the everyday places as points and buildings, stations as points; only parks (often large
  // areas mapped as relations) look at relations too. Smaller circles keep it quick on a busy server.
  return `[out:json][timeout:60];
(
  nw(around:1400,${at})["amenity"="school"]["name"];
  nw(around:1200,${at})["shop"="supermarket"]["name"];
  nwr(around:1400,${at})["leisure"="park"]["name"];
  nw(around:1200,${at})["amenity"="doctors"]["name"];
  nw(around:1000,${at})["amenity"="pharmacy"]["name"];
  nw(around:1200,${at})["leisure"="fitness_centre"]["name"];
  node(around:2000,${at})["railway"="station"];
);
out center tags qt;`
}

/** Places within about a mile and a half of a home, from OpenStreetMap: asks the servers in turn. */
async function fromOverpass(p: LatLon): Promise<Raw[]> {
  const raw = await runOverpass(query(p), 65_000)
  if (!raw.some((r) => r.kind !== 'station')) throw new Error('OpenStreetMap found nothing nearby')
  return raw
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
    // A second station only if it's a reasonable walk; a far one says little and stretches the map.
    if (out.some((p) => p?.kind === 'station') && s.metres > 1700) break
    if (s.metres > 3000) break
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
const inFlight = new Map<string, Promise<{ data: Raw[] | null; error: string | null }>>()

/**
 * The places worth mentioning near a home. A first look-up for a postcode can take a while (OpenStreetMap's servers
 * are busy), so it carries on in the background: the page waits up to 8 seconds, then shows stations only and says
 * the rest is on its way; a refresh a minute later has everything, saved for 30 days.
 */
export async function placesNear(postcode: string, home: LatLon): Promise<{ places: Place[]; source: 'openstreetmap' | 'stations only'; error: string | null; pending: boolean }> {
  // Our own copy first: instant, and doesn't depend on anyone's server being up.
  const local = await localPlaces(home).catch(() => null)
  if (local) return { places: pickPlaces(home, local), source: 'openstreetmap', error: null, pending: false }
  // v2: answers saved by the first version could be cut short (stations only), so they're not used.
  const key = `places-v2:${postcode}`
  let job = inFlight.get(key)
  if (!job) {
    job = cached<Raw[]>(key, 30, () => fromOverpass(home)).finally(() => inFlight.delete(key))
    inFlight.set(key, job)
  }
  const r = await Promise.race([job, new Promise<'wait'>((ok) => setTimeout(() => ok('wait'), 8000))])
  if (r === 'wait') return { places: pickPlaces(home, []), source: 'stations only', error: null, pending: true }
  if (r.data?.length) return { places: pickPlaces(home, r.data), source: 'openstreetmap', error: r.error, pending: false }
  return { places: pickPlaces(home, []), source: 'stations only', error: r.error ?? 'nothing found nearby', pending: false }
}

export const placeLine = (p: Place) => `${p.name}: ${p.detail} · about ${p.minutes} min walk (${distanceText(p.metres)})`
