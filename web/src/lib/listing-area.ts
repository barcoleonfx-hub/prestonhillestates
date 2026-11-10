// "Nearest stations" and "Local life" for a listing's page. Everything comes from what's already on our server
// (the postcode positions and our copy of OpenStreetMap's places), so the page never waits on anyone else's service.

import { pickPlaces, type Place } from './area-facts'
import { localPlaces } from './area-places'
import { metresBetween, osgbToLatLon, walkMinutes, type LatLon } from './geo'
import { positionOf } from './postcode-geo'
import { STATIONS, stationByName } from './stations'

export type NearStation = { name: string; lines: string[]; metres: number; minutes: number }
export type ListingArea = { home: LatLon | null; stations: NearStation[]; places: Place[]; fromOsm: boolean }

export async function listingArea(p: { latitude: number | null; longitude: number | null; postcode: string | null }): Promise<ListingArea> {
  let home: LatLon | null = p.latitude != null && p.longitude != null ? { lat: p.latitude, lon: p.longitude } : null
  if (!home && p.postcode) {
    const pos = await positionOf(p.postcode).catch(() => null)
    if (pos) home = osgbToLatLon(pos.e, pos.n)
  }
  if (!home) return { home: null, stations: [], places: [], fromOsm: false }
  const raw = await localPlaces(home).catch(() => null)

  // Stations: OpenStreetMap's exact positions where our copy has them, our list (with the lines) otherwise.
  const exact = new Map<string, LatLon>()
  for (const r of raw ?? []) {
    const st = r.kind === 'station' ? stationByName(r.name) : null
    if (st && !exact.has(st.name)) exact.set(st.name, r)
  }
  const stations = STATIONS
    .map((s) => { const at = exact.get(s.name) ?? s; const metres = Math.round(metresBetween(home!, at)); return { name: s.name, lines: s.lines, metres, minutes: walkMinutes(metres) } })
    .sort((a, b) => a.metres - b.metres)
    .filter((s, i) => i === 0 || s.metres <= 3500)
    .slice(0, 3)

  // Schools, shops, parks, GP, pharmacy and gym: only when our copy covers the area (stations have their own list).
  const places = raw ? pickPlaces(home, raw).filter((x) => x.kind !== 'station') : []
  return { home, stations, places, fromOsm: !!raw }
}
