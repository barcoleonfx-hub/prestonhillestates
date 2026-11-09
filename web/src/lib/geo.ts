// Map maths. Pure, so the booklet can place pins on a map in the browser as well as on the server.
//  - OS grid references (what Code-Point Open gives for each postcode) to latitude/longitude (what maps use);
//  - distances and rough walking times;
//  - which OpenStreetMap tiles cover an area, and where a point falls on them.

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** OS National Grid easting/northing (OSGB36) to WGS84 latitude/longitude, accurate to a few metres. */
export function osgbToLatLon(E: number, N: number): { lat: number; lon: number } {
  // Airy 1830 ellipsoid and the National Grid's projection.
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717
  const lat0 = rad(49), lon0 = rad(-2), N0 = -100000, E0 = 400000
  const e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n
  let lat = lat0, M = 0
  do {
    lat = (N - N0 - M) / (a * F0) + lat
    const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (lat - lat0)
    const Mb = (3 * n + 3 * n * n + (21 / 8) * n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0)
    const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0))
    const Md = (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0))
    M = b * F0 * (Ma - Mb + Mc - Md)
  } while (Math.abs(N - N0 - M) >= 0.00001)
  const cosLat = Math.cos(lat), sinLat = Math.sin(lat)
  const nu = (a * F0) / Math.sqrt(1 - e2 * sinLat * sinLat)
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5)
  const eta2 = nu / rho - 1
  const tanLat = Math.tan(lat), tan2 = tanLat * tanLat, tan4 = tan2 * tan2, tan6 = tan4 * tan2
  const secLat = 1 / cosLat, nu3 = nu * nu * nu, nu5 = nu3 * nu * nu, nu7 = nu5 * nu * nu
  const VII = tanLat / (2 * rho * nu)
  const VIII = (tanLat / (24 * rho * nu3)) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2)
  const IX = (tanLat / (720 * rho * nu5)) * (61 + 90 * tan2 + 45 * tan4)
  const X = secLat / nu
  const XI = (secLat / (6 * nu3)) * (nu / rho + 2 * tan2)
  const XII = (secLat / (120 * nu5)) * (5 + 28 * tan2 + 24 * tan4)
  const XIIA = (secLat / (5040 * nu7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6)
  const dE = E - E0, dE2 = dE * dE, dE3 = dE2 * dE, dE4 = dE2 * dE2, dE5 = dE3 * dE2, dE6 = dE4 * dE2, dE7 = dE5 * dE2
  const phi = lat - VII * dE2 + VIII * dE4 - IX * dE6
  const lambda = lon0 + X * dE - XI * dE3 + XII * dE5 - XIIA * dE7
  return helmertToWgs84(phi, lambda)
}

/** OSGB36 (Airy) latitude/longitude to WGS84, by the standard 7-parameter Helmert transformation. */
function helmertToWgs84(phi: number, lambda: number): { lat: number; lon: number } {
  // OSGB36 lat/lon to cartesian (Airy 1830).
  const a1 = 6377563.396, b1 = 6356256.909, e21 = 1 - (b1 * b1) / (a1 * a1)
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi)
  const nu = a1 / Math.sqrt(1 - e21 * sinPhi * sinPhi)
  const x1 = nu * cosPhi * Math.cos(lambda), y1 = nu * cosPhi * Math.sin(lambda), z1 = (1 - e21) * nu * sinPhi
  // OSGB36 to WGS84.
  const tx = 446.448, ty = -125.157, tz = 542.06, s = -20.4894e-6
  const rx = rad(0.1502 / 3600), ry = rad(0.247 / 3600), rz = rad(0.8421 / 3600)
  const x2 = tx + (1 + s) * x1 - rz * y1 + ry * z1
  const y2 = ty + rz * x1 + (1 + s) * y1 - rx * z1
  const z2 = tz - ry * x1 + rx * y1 + (1 + s) * z1
  // Cartesian to WGS84 lat/lon (GRS80/WGS84 ellipsoid).
  const a2 = 6378137, b2 = 6356752.3142, e22 = 1 - (b2 * b2) / (a2 * a2)
  const p = Math.sqrt(x2 * x2 + y2 * y2)
  let lat = Math.atan2(z2, p * (1 - e22)), prev = 2 * Math.PI
  while (Math.abs(lat - prev) > 1e-12) {
    const nu2 = a2 / Math.sqrt(1 - e22 * Math.sin(lat) ** 2)
    prev = lat
    lat = Math.atan2(z2 + e22 * nu2 * Math.sin(lat), p)
  }
  return { lat: deg(lat), lon: deg(Math.atan2(y2, x2)) }
}

export type LatLon = { lat: number; lon: number }

/** Straight-line distance in metres. */
export function metresBetween(a: LatLon, b: LatLon): number {
  const R = 6371000
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** A rough walking time: streets add about a third to the straight line, at about 80 metres a minute. */
export const walkMinutes = (metres: number) => Math.max(1, Math.round((metres * 1.3) / 80))
export const distanceText = (metres: number) => (metres < 950 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1609.34).toFixed(1)} miles`)

/** Where a point falls in OpenStreetMap's tile grid at a zoom level (in tiles, with fractions). */
export function tileXY(p: LatLon, z: number): { x: number; y: number } {
  const n = 2 ** z
  const x = ((p.lon + 180) / 360) * n
  const y = ((1 - Math.log(Math.tan(rad(p.lat)) + 1 / Math.cos(rad(p.lat))) / Math.PI) / 2) * n
  return { x, y }
}

/** The closest zoom (up to 17) at which all the points fit in a box of the given size in pixels. */
export function fitZoom(points: LatLon[], width: number, height: number, pad = 40): number {
  for (let z = 17; z >= 11; z--) {
    const t = points.map((p) => tileXY(p, z))
    const w = (Math.max(...t.map((q) => q.x)) - Math.min(...t.map((q) => q.x))) * 256
    const h = (Math.max(...t.map((q) => q.y)) - Math.min(...t.map((q) => q.y))) * 256
    if (w <= width - pad * 2 && h <= height - pad * 2) return z
  }
  return 11
}
