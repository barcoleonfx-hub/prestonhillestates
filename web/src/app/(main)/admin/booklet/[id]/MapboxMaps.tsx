import { tileXY, type LatLon } from '@/lib/geo'

// Mapbox map pictures for the booklet (Static Images API): built from the token and positions, so the live preview
// and the printout are the same picture. All sizes are in CSS pixels; Mapbox sends them at double resolution.

const ll = (p: LatLon) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`
const base = (style: string, overlays: string[], view: string, w: number, h: number, token: string) =>
  `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${overlays.length ? `${overlays.join(',')}/` : ''}${view}/${Math.round(w)}x${Math.round(h)}@2x?access_token=${encodeURIComponent(token)}`

/** The fractional zoom at which a box around `centre` (reaching `reach` in each direction) fits in w × h pixels. */
function zoomToFit(centre: LatLon, reach: { s: number; w: number; n: number; e: number }, w: number, h: number) {
  const c = tileXY(centre, 0)
  const pts = [{ lat: reach.n, lon: reach.w }, { lat: reach.s, lon: reach.e }].map((p) => tileXY(p, 0))
  // Distance from the centre to the furthest edge, both ways, in world-tile units at zoom 0.
  const dx = Math.max(...pts.map((p) => Math.abs(p.x - c.x))) * 2, dy = Math.max(...pts.map((p) => Math.abs(p.y - c.y))) * 2
  const z = Math.min(Math.log2(w / (256 * Math.max(dx, 1e-9))), Math.log2(h / (256 * Math.max(dy, 1e-9))))
  return Math.round(z * 10) / 10
}

/** Is a point inside a w × h picture centred on `centre` at zoom z (with a margin for the pin)? */
function inside(p: LatLon, centre: LatLon, z: number, w: number, h: number) {
  const a = tileXY(p, z), c = tileXY(centre, z)
  return Math.abs((a.x - c.x) * 256) < w / 2 - 14 && (a.y - c.y) * 256 > -h / 2 + 30 && (a.y - c.y) * 256 < h / 2 - 6
}

export type AreaPin = { n: number; at: LatLon }
export type Zone = { minutes: number; polyline: string; box: { s: number; w: number; n: number; e: number } }

/**
 * Street-level map of the home: the 5- and 10-minute walking areas shaded in gold, the walk to the nearest
 * station, and numbered pins for the places in view. Zoomed to street level, with the 5-minute walk filling it.
 */
export function AreaMap({ home, pins, zones, route, token, width, height }: { home: LatLon; pins: AreaPin[]; zones: Zone[]; route: string | null; token: string; width: number; height: number }) {
  // Close enough to read the street names: fit the 5-minute walk (the 10-minute area runs off the edges).
  const five = zones.find((z) => z.minutes <= 5)
  const reach = five?.box ?? { s: home.lat - 0.0035, n: home.lat + 0.0035, w: home.lon - 0.0055, e: home.lon + 0.0055 }
  const z = Math.min(16.5, Math.max(15, zoomToFit(home, reach, width - 30, height - 30)))
  const shown = pins.filter((p) => inside(p.at, home, z, width, height)).slice(0, 18)
  const overlays: string[] = []
  // Widest first, so the 5-minute area sits on top of the 10-minute one.
  for (const zn of [...zones].sort((a, b) => b.minutes - a.minutes)) {
    overlays.push(`path-2+a47b1d-${zn.minutes <= 5 ? '0.7' : '0.45'}+c4972f-${zn.minutes <= 5 ? '0.22' : '0.12'}(${encodeURIComponent(zn.polyline)})`)
  }
  if (route) overlays.push(`path-4+23211a-0.8(${encodeURIComponent(route)})`)
  for (const p of shown) overlays.push(`pin-s-${p.n}+23211a(${ll(p.at)})`)
  overlays.push(`pin-l-home+c4972f(${ll(home)})`)
  let src = base('light-v11', overlays, `${ll(home)},${z}`, width, height, token)
  // Mapbox takes addresses up to about 8,000 characters: simplify if the shapes made it longer.
  if (src.length > 7900) src = base('light-v11', overlays.filter((o) => !o.startsWith('path-2')), `${ll(home)},${z}`, width, height, token)
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="bk-mbmap" src={src} alt="Map of the home, the areas within a 5- and 10-minute walk, and the places listed" width={width} height={height} />
}

/** A close aerial photo of the home and its street. */
export function AerialMap({ home, token, width, height }: { home: LatLon; token: string; width: number; height: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="bk-mbmap" src={base('satellite-streets-v12', [`pin-l-home+c4972f(${ll(home)})`], `${ll(home)},17.4`, width, height, token)} alt="The home from above" width={width} height={height} />
}

/** The comparable sales: numbered pins matching the table, and the home. */
export function CompsMap({ home, pins, token, width, height }: { home: LatLon; pins: AreaPin[]; token: string; width: number; height: number }) {
  const overlays = [...pins.map((p) => `pin-s-${p.n}+23211a(${ll(p.at)})`), `pin-l-home+c4972f(${ll(home)})`]
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="bk-mbmap" src={base('light-v11', overlays, 'auto', width, height, token).replace('?access_token', '?padding=34&access_token')} alt="Map of the homes compared with yours" width={width} height={height} />
}
