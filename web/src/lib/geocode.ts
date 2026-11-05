import 'server-only'

// The last resort for finding a postcode: look the address up on OpenStreetMap (Nominatim, free, at most one
// request a second), then ask postcodes.io for the nearest postcode to that point, with its council and ward.

const NOMINATIM = () => (process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '')
const POSTCODES = () => (process.env.POSTCODES_IO_URL || 'https://api.postcodes.io').replace(/\/$/, '')
const UA = 'PrestonHillPortal/1.0 (licensing register; contact via prestonhillestates.com)'
let last = 0
const wait = async () => { const gap = Date.now() - last; if (gap < 1100) await new Promise((r) => setTimeout(r, 1100 - gap)); last = Date.now() }

const COUNCIL_NAMES: Record<string, string> = { brent: 'London Borough of Brent', harrow: 'London Borough of Harrow', ealing: 'London Borough of Ealing', barnet: 'London Borough of Barnet', hillingdon: 'London Borough of Hillingdon' }

export type Found = { postcode: string; district: string | null; ward: string | null; how: string; resolved: string | null }

export async function geocodePostcode(address: string, council: string | null): Promise<Found | null> {
  const clean = address.replace(/\b(room|studio)\s*\d*\b/gi, ' ').replace(/flat\s*-\s*/i, 'Flat ').replace(/\s+/g, ' ').trim()
  const area = council ? COUNCIL_NAMES[council] ?? council.replace(/\b\w/g, (c) => c.toUpperCase()) : 'London'
  try {
    await wait()
    const u = `${NOMINATIM()}/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=gb&q=${encodeURIComponent(`${clean}, ${area}, United Kingdom`)}`
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
    if (!r.ok) return null
    const hit = ((await r.json()) as { lat: string; lon: string; address?: { postcode?: string; road?: string; house_number?: string } }[])[0]
    if (!hit) return null
    // Only trust a hit that found a road (not just a town), so a guess is never just "somewhere in Brent".
    if (!hit.address?.road) return null
    const near = await fetch(`${POSTCODES()}/postcodes?lon=${hit.lon}&lat=${hit.lat}&limit=1&radius=250`, { signal: AbortSignal.timeout(8000) })
    const j = near.ok ? ((await near.json()) as { result?: { postcode: string; admin_district?: string; admin_ward?: string }[] | null }) : null
    const pc = j?.result?.[0]
    const postcode = (hit.address.postcode && /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.test(hit.address.postcode) ? hit.address.postcode.toUpperCase() : pc?.postcode) ?? null
    if (!postcode) return null
    // Reject a result in another borough from the one on the spreadsheet.
    if (council && pc?.admin_district && COUNCIL_NAMES[council] && pc.admin_district.toLowerCase() !== council) return null
    const exact = !!hit.address.house_number
    return { postcode, district: pc?.admin_district ?? null, ward: pc?.admin_ward ?? null, resolved: exact ? `${hit.address.house_number} ${hit.address.road}` : null, how: `map look-up (OpenStreetMap${exact ? `, ${hit.address.house_number} ${hit.address.road}` : `, ${hit.address.road}: house number not mapped, so nearest postcode on the road`})` }
  } catch { return null }
}
