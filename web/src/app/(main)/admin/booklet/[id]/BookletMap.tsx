import { fitZoom, tileXY, type LatLon } from '@/lib/geo'

// A small map for the booklet: OpenStreetMap tiles (shown softly, in the booklet's colours), the home as a gold
// pin, and numbered dots for the places listed beside it. Sized in pixels to fit 174 × 78 mm on an A4 page.

export type MapPin = { n: number; at: LatLon; kind: string }

export function BookletMap({ home, pins, width = 658, height = 295, mapToken }: { home: LatLon; pins: MapPin[]; width?: number; height?: number; mapToken?: string | null }) {
  // With a Mapbox token: Mapbox's own map picture, sharp in print, with the home and numbered places on it.
  if (mapToken) {
    const ll = (p: LatLon) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`
    const overlays = [...pins.slice(0, 20).map((p) => `pin-s-${p.n}+23211a(${ll(p.at)})`), `pin-l-home+c4972f(${ll(home)})`].join(',')
    const src = `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${overlays}/auto/${width}x${height}@2x?padding=36&access_token=${encodeURIComponent(mapToken)}`
    return (
      <div className="bk-map bk-map-mapbox" style={{ width, height }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Map of the home and the places listed" width={width} height={height} />
      </div>
    )
  }
  const z = fitZoom([home, ...pins.map((p) => p.at)], width, height, 34)
  // Centre on the middle of everything shown, so the pins use the space well.
  const all = [home, ...pins.map((p) => p.at)].map((p) => tileXY(p, z))
  const cx = (Math.min(...all.map((t) => t.x)) + Math.max(...all.map((t) => t.x))) / 2
  const cy = (Math.min(...all.map((t) => t.y)) + Math.max(...all.map((t) => t.y))) / 2
  const left = Math.round(cx * 256 - width / 2), top = Math.round(cy * 256 - height / 2)
  const tiles: { x: number; y: number }[] = []
  for (let x = Math.floor(left / 256); x <= Math.floor((left + width) / 256); x++) {
    for (let y = Math.floor(top / 256); y <= Math.floor((top + height) / 256); y++) tiles.push({ x, y })
  }
  const px = (p: LatLon) => { const t = tileXY(p, z); return { x: Math.round(t.x * 256 - left), y: Math.round(t.y * 256 - top) } }
  const h = px(home)
  // Places on top of each other (a station and the shops beside it) are spread round in a small circle.
  const placed: { n: number; x: number; y: number }[] = []
  for (const p of pins) {
    let { x, y } = px(p.at)
    for (let i = 1; i < 12 && [...placed, { n: 0, x: h.x, y: h.y - 22 }].some((q) => Math.hypot(q.x - x, q.y - y) < 20); i++) {
      const o = px(p.at), a = i * 2.4
      x = Math.round(o.x + Math.cos(a) * 20 * Math.ceil(i / 6)); y = Math.round(o.y + Math.sin(a) * 20 * Math.ceil(i / 6))
    }
    placed.push({ n: p.n, x, y })
  }
  return (
    <div className="bk-map" style={{ width, height }}>
      <div className="bk-map-tiles">
        {/* Background images, so a tile that can't load leaves the soft background, not a broken-image icon. */}
        {tiles.map((t) => (
          <div key={`${t.x}-${t.y}`} style={{ left: Math.round(t.x * 256 - left), top: Math.round(t.y * 256 - top), backgroundImage: `url(https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png)` }} />
        ))}
      </div>
      <svg width={width} height={height} className="bk-map-pins" aria-hidden="true">
        {placed.map((q) => { const p = q; return (
          <g key={p.n} transform={`translate(${q.x},${q.y})`}>
            <circle r="10" fill="#23211A" stroke="#fff" strokeWidth="2" />
            <text y="4" textAnchor="middle" fontSize="11" fontWeight="700" fill="#C4972F" fontFamily="Helvetica, Arial, sans-serif">{p.n}</text>
          </g>
        ) })}
        <g transform={`translate(${h.x},${h.y})`}>
          <path d="M0,0 C-9,-12 -14,-18 -14,-26 A14,14 0 1,1 14,-26 C14,-18 9,-12 0,0 Z" fill="#C4972F" stroke="#fff" strokeWidth="2" />
          <circle cy="-26" r="5" fill="#fff" />
        </g>
      </svg>
      <div className="bk-map-credit">Map © OpenStreetMap contributors</div>
    </div>
  )
}
