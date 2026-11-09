import { currentAdmin } from '@/lib/auth'
import { placesNear } from '@/lib/area-facts'
import { areaPlacesStatus } from '@/lib/area-places'
import { geocodeHome, mapboxToken, walkingTimes } from '@/lib/mapbox'
import { osgbToLatLon } from '@/lib/geo'
import { epcConfigured, epcHistory, parseHomeAddress, saleHistory } from '@/lib/home-history'
import { positionOf } from '@/lib/postcode-geo'

export const dynamic = 'force-dynamic'

/**
 * Staff check of the booklet's outside sources on the live site:
 * /admin/booklet-check?postcode=HA3 7EH&address=8 The Broadway
 * Shows where the postcode is, the places found nearby (OpenStreetMap), the home's sales (Land Registry) and its
 * energy certificates (EPC register, if a key is set), with any error each one gave.
 */
export async function GET(req: Request) {
  if (!(await currentAdmin())) return new Response('Sign in to the portal first', { status: 401 })
  const u = new URL(req.url)
  const postcode = (u.searchParams.get('postcode') ?? 'HA3 0PS').toUpperCase().trim().replace(/\s+/g, ' ')
  const address = u.searchParams.get('address') ?? ''
  const pos = await positionOf(postcode).catch(() => null)
  const at = pos ? osgbToLatLon(pos.e, pos.n) : null
  const home = parseHomeAddress(address)
  const [places, sales, epc] = await Promise.all([
    at ? placesNear(postcode, at) : Promise.resolve(null),
    home ? saleHistory(postcode, home) : Promise.resolve(null),
    home ? epcHistory(postcode, home) : Promise.resolve(null),
  ])
  const ourCopy = await areaPlacesStatus().catch((e) => String(e))
  // Mapbox: is the token there, does it find the exact house, and does it give walking times?
  const tok = mapboxToken()
  const exact = tok && address ? await geocodeHome(address.replace(/,?\s*$/, ''), postcode).catch((e) => `error: ${String((e as Error).message ?? e)}`) : null
  const from = typeof exact === 'object' && exact ? exact : at
  const walk = tok && from && places?.places.length ? await walkingTimes(from, places.places.slice(0, 3)).catch((e) => `error: ${String((e as Error).message ?? e)}`) : null
  const mapbox = tok ? { token: `${tok.slice(0, 6)}…`, exactHouse: exact ?? (address ? 'not found in this postcode (the postcode centre is used)' : 'add &address=… to test'), walkingSample: walk } : 'no Mapbox token found (MAPBOX_TOKEN environment variable or secret file)'
  return Response.json({
    postcode, at, address: home, mapbox, ourCopy,
    places: places && { source: places.source, error: places.error, stillLooking: places.pending, found: places.places.map((p) => `${p.detail}: ${p.name}, about ${p.minutes} min walk`) },
    sales: sales ?? 'add &address=… (house number and street) to look up its sales',
    epc: epcConfigured() ? epc : 'no EPC key set (EPC_API_EMAIL and EPC_API_KEY)',
  }, { headers: { 'Cache-Control': 'no-store' } })
}
