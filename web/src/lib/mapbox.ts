import 'server-only'
import { readFileSync } from 'node:fs'
import type { LatLon } from './geo'
import { portalUrl } from './mailer'

// Mapbox, for the valuation booklet: the house itself on the map (from its full address), real walking times along
// streets, and the map picture. The token is a Mapbox public token ("pk."), set in Render either as the
// environment variable MAPBOX_TOKEN or as a secret file called MAPBOX_TOKEN. Without it, the booklet uses the
// postcode's position, estimated walking times and OpenStreetMap's map, as before.
// Mapbox's terms don't allow keeping look-up results, so they're only remembered in memory for a day.

let token: { v: string | null; at: number } | null = null
let why = ''

/** "pk.abc", "MAPBOX_TOKEN=pk.abc" or "MAPBOX_TOKEN=\"pk.abc\"" (a .env-style file): the token itself. */
const clean = (raw: string) => {
  const line = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => /(^|=)\s*["']?(pk|sk)\./.test(l)) ?? raw.trim()
  return line.replace(/^[A-Z_]+\s*=\s*/, '').replace(/^["']|["']$/g, '').trim()
}

/** The Mapbox token, looked up afresh every minute (so a token added later is picked up without a restart). */
export function mapboxToken(): string | null {
  if (token && Date.now() - token.at < 60_000) return token.v
  let v: string | null = null
  const fromEnv = process.env.MAPBOX_TOKEN?.trim()
  if (fromEnv) v = clean(fromEnv)
  else {
    // Render puts secret files in /etc/secrets and in the app's root (the repository's top folder, or this one).
    // (Each path written out in full, so the build doesn't have to include the whole project.)
    const read = (load: () => string) => { try { return clean(load()) || null } catch { return null } }
    v = read(() => readFileSync('/etc/secrets/MAPBOX_TOKEN', 'utf8'))
      ?? read(() => readFileSync('/opt/render/project/src/MAPBOX_TOKEN', 'utf8'))
      ?? read(() => readFileSync('/opt/render/project/src/web/MAPBOX_TOKEN', 'utf8'))
  }
  why = !v ? 'no MAPBOX_TOKEN environment variable or secret file found (add it in Render under Environment Variables)' : !/^pk\./.test(v) ? 'the token should be a public token, starting "pk."' : ''
  if (v && !/^pk\./.test(v)) v = null
  token = { v, at: Date.now() }
  return v
}

/** For the booklet editor: is Mapbox connected, and if not, why. */
export function mapboxStatus(): { connected: boolean; why: string } {
  const v = mapboxToken()
  return { connected: !!v, why: v ? '' : why }
}

const DAY = 86400_000
const memo = new Map<string, { at: number; v: unknown }>()
async function remembered<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < DAY) return hit.v as T
  const v = await load()
  memo.set(key, { at: Date.now(), v })
  if (memo.size > 2000) memo.delete(memo.keys().next().value!)
  return v
}

// A token limited to our web addresses only works when requests say they come from us.
const headers = () => ({ Referer: `${portalUrl('/')}`, 'User-Agent': 'PrestonHillEstates/1.0' })

const pc = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/\s+/g, '')

/**
 * The house's own position from its full address, if Mapbox finds that exact address in the same postcode;
 * otherwise null (the postcode's position is used instead).
 */
export async function geocodeHome(address: string, postcode: string): Promise<LatLon | null> {
  const t = mapboxToken()
  if (!t || !address) return null
  return remembered(`geo:${address}|${postcode}`, async () => {
    const q = encodeURIComponent(`${address}, ${postcode}`)
    const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?q=${q}&country=gb&types=address&limit=1&access_token=${t}`, { headers: headers(), signal: AbortSignal.timeout(6000) })
    if (!res.ok) throw new Error(`Mapbox address look-up answered ${res.status}`)
    const f = ((await res.json()) as { features?: { geometry?: { coordinates?: [number, number] }; properties?: { context?: { postcode?: { name?: string } }; match_code?: { confidence?: string } } }[] }).features?.[0]
    const c = f?.geometry?.coordinates
    if (!c) return null
    // Only the same postcode, and not a guess.
    if (pc(f?.properties?.context?.postcode?.name) !== pc(postcode)) return null
    if (/^low$/i.test(f?.properties?.match_code?.confidence ?? '')) return null
    return { lat: c[1], lon: c[0] }
  })
}

/** Walking times (minutes) and distances (metres) from the home to each place, along streets. Null if unavailable. */
export async function walkingTimes(home: LatLon, places: LatLon[]): Promise<{ minutes: number; metres: number }[] | null> {
  const t = mapboxToken()
  if (!t || !places.length) return null
  const pts = [home, ...places.slice(0, 24)]
  const key = `walk:${pts.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';')}`
  return remembered(key, async () => {
    const res = await fetch(`https://api.mapbox.com/directions-matrix/v1/mapbox/walking/${pts.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';')}?sources=0&annotations=duration,distance&access_token=${t}`, { headers: headers(), signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`Mapbox walking times answered ${res.status}`)
    const body = (await res.json()) as { code?: string; durations?: (number | null)[][]; distances?: (number | null)[][] }
    if (body.code !== 'Ok' || !body.durations?.[0]) throw new Error(`Mapbox walking times: ${body.code ?? 'no answer'}`)
    return places.slice(0, 24).map((_, i) => {
      const s = body.durations![0][i + 1], d = body.distances?.[0]?.[i + 1]
      return s == null ? { minutes: -1, metres: -1 } : { minutes: Math.max(1, Math.round(s / 60)), metres: Math.round(d ?? -1) }
    })
  })
}

/** Google's encoded-polyline format (precision 5), which Mapbox's map pictures take for drawn lines and areas. */
export function encodePolyline(points: LatLon[]): string {
  let out = '', pLat = 0, pLon = 0
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1
    let s = ''
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5 }
    return s + String.fromCharCode(n + 63)
  }
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5), lon = Math.round(p.lon * 1e5)
    out += enc(lat - pLat) + enc(lon - pLon)
    pLat = lat; pLon = lon
  }
  return out
}

export type WalkZone = { minutes: number; polyline: string; box: { s: number; w: number; n: number; e: number } }
/** The areas within a 5- and 10-minute walk of the home (Mapbox isochrones), simplified for drawing. */
export async function walkingZones(home: LatLon): Promise<WalkZone[] | null> {
  const t = mapboxToken()
  if (!t) return null
  return remembered(`iso:${home.lon.toFixed(5)},${home.lat.toFixed(5)}`, async () => {
    const res = await fetch(`https://api.mapbox.com/isochrone/v1/mapbox/walking/${home.lon.toFixed(6)},${home.lat.toFixed(6)}?contours_minutes=5,10&polygons=true&generalize=20&access_token=${t}`, { headers: headers(), signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`Mapbox walking areas answered ${res.status}`)
    const body = (await res.json()) as { features?: { properties?: { contour?: number }; geometry?: { type?: string; coordinates?: number[][][] } }[] }
    return (body.features ?? []).map((f) => {
      const ring = (f.geometry?.coordinates?.[0] ?? []).map(([lon, lat]) => ({ lat, lon }))
      // Fewer corners keep the map's address short enough; the shape barely changes.
      const step = Math.max(1, Math.ceil(ring.length / 160))
      const pts = ring.filter((_, i) => i % step === 0)
      if (pts.length) pts.push(pts[0])
      return {
        minutes: f.properties?.contour ?? 0, polyline: encodePolyline(pts),
        box: { s: Math.min(...ring.map((p) => p.lat)), n: Math.max(...ring.map((p) => p.lat)), w: Math.min(...ring.map((p) => p.lon)), e: Math.max(...ring.map((p) => p.lon)) },
      }
    }).filter((z) => z.minutes && z.polyline).sort((a, b) => b.minutes - a.minutes)
  })
}

/** The walking route from the home to a place, for drawing on the map. */
export async function walkingRoute(home: LatLon, to: LatLon): Promise<{ polyline: string; minutes: number; metres: number } | null> {
  const t = mapboxToken()
  if (!t) return null
  return remembered(`route:${home.lon.toFixed(5)},${home.lat.toFixed(5)};${to.lon.toFixed(5)},${to.lat.toFixed(5)}`, async () => {
    const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/walking/${home.lon.toFixed(6)},${home.lat.toFixed(6)};${to.lon.toFixed(6)},${to.lat.toFixed(6)}?geometries=polyline&overview=simplified&access_token=${t}`, { headers: headers(), signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`Mapbox walking route answered ${res.status}`)
    const r = ((await res.json()) as { routes?: { geometry?: string; duration?: number; distance?: number }[] }).routes?.[0]
    return r?.geometry ? { polyline: r.geometry, minutes: Math.max(1, Math.round((r.duration ?? 0) / 60)), metres: Math.round(r.distance ?? 0) } : null
  })
}

/** Places people drive to from our patch: what's within easy reach by car. */
export const DRIVE_TO: { name: string; at: LatLon }[] = [
  { name: 'M1', at: { lat: 51.5726, lon: -0.2302 } },
  { name: 'A40', at: { lat: 51.5302, lon: -0.2929 } },
  { name: 'Brent Cross', at: { lat: 51.5763, lon: -0.2237 } },
  { name: 'Wembley Stadium', at: { lat: 51.556, lon: -0.2796 } },
  { name: 'Northwick Park Hospital', at: { lat: 51.5755, lon: -0.3215 } },
  { name: 'Heathrow', at: { lat: 51.4706, lon: -0.4619 } },
  { name: 'Central London', at: { lat: 51.5131, lon: -0.1589 } },
]

/** Driving times without traffic from the home to DRIVE_TO (Mapbox driving matrix). */
export async function drivingTimes(home: LatLon): Promise<{ name: string; minutes: number }[] | null> {
  const t = mapboxToken()
  if (!t) return null
  const pts = [home, ...DRIVE_TO.map((d) => d.at)]
  return remembered(`drive:${home.lon.toFixed(5)},${home.lat.toFixed(5)}`, async () => {
    const res = await fetch(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${pts.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';')}?sources=0&annotations=duration&access_token=${t}`, { headers: headers(), signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`Mapbox driving times answered ${res.status}`)
    const body = (await res.json()) as { code?: string; durations?: (number | null)[][] }
    if (body.code !== 'Ok' || !body.durations?.[0]) throw new Error(`Mapbox driving times: ${body.code ?? 'no answer'}`)
    return DRIVE_TO.map((d, i) => ({ name: d.name, minutes: Math.max(1, Math.round((body.durations![0][i + 1] ?? -60) / 60)) })).filter((d) => d.minutes > 0)
  })
}
