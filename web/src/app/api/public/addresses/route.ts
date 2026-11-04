import { lookupAddresses } from '@/lib/address-lookup'

export const dynamic = 'force-dynamic'
const POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/

// Each lookup can cost money, so one visitor gets a handful per hour (postcodes already seen are free).
const hits = new Map<string, number[]>()
function allowed(ip: string) {
  const t = Date.now(), recent = (hits.get(ip) ?? []).filter((x) => t - x < 3600_000)
  if (recent.length >= 15) return false
  recent.push(t); hits.set(ip, recent)
  if (hits.size > 5000) hits.clear()
  return true
}

/** Addresses on a postcode, for the valuation form's address finder. */
export async function GET(req: Request) {
  const pc = (new URL(req.url).searchParams.get('postcode') ?? '').toUpperCase().trim().replace(/\s+/g, ' ')
  if (!POSTCODE.test(pc)) return Response.json({ error: 'postcode' }, { status: 400 })
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local'
  if (!allowed(ip)) return Response.json({ source: 'none', addresses: [], limited: true }, { status: 429 })
  const r = await lookupAddresses(pc).catch(() => ({ source: 'none' as const, addresses: [] }))
  return Response.json(r, { headers: { 'Cache-Control': 'private, max-age=600' } })
}
