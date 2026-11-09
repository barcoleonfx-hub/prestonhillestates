import 'server-only'
import { readFileSync } from 'node:fs'
import type { LatLon } from './geo'
import { portalUrl } from './mailer'

// Mapbox, for the valuation booklet: the house itself on the map (from its full address), real walking times along
// streets, and the map picture. The token is a Mapbox public token ("pk."), set in Render either as the
// environment variable MAPBOX_TOKEN or as a secret file called MAPBOX_TOKEN. Without it, the booklet uses the
// postcode's position, estimated walking times and OpenStreetMap's map, as before.
// Mapbox's terms don't allow keeping look-up results, so they're only remembered in memory for a day.

let token: string | null | undefined
export function mapboxToken(): string | null {
  if (token !== undefined) return token
  const fromEnv = process.env.MAPBOX_TOKEN?.trim()
  if (fromEnv) return (token = fromEnv)
  for (const f of ['/etc/secrets/MAPBOX_TOKEN', `${process.cwd()}/MAPBOX_TOKEN`]) {
    try { const t = readFileSync(f, 'utf8').trim(); if (t) return (token = t) } catch { /* not there */ }
  }
  return (token = null)
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
