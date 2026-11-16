import { salesNear } from '@/lib/sold-prices'

export const dynamic = 'force-dynamic'
const POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/

/** Recent sold prices near a postcode, for the valuation form. Public; Land Registry open data only. */
export async function GET(req: Request) {
  const u = new URL(req.url)
  const pc = (u.searchParams.get('postcode') ?? '').toUpperCase().trim().replace(/\s+/g, ' ')
  if (!POSTCODE.test(pc)) return Response.json({ error: 'postcode' }, { status: 400 })
  const t = u.searchParams.get('type')
  const street = (u.searchParams.get('street') ?? '').slice(0, 80) || null
  const b = Number.parseInt(u.searchParams.get('beds') ?? '', 10)
  const data = await salesNear(pc, { type: t === 'F' || t === 'H' || t === 'D' || t === 'S' || t === 'T' ? t : null, beds: Number.isFinite(b) && b >= 0 && b < 15 ? b : null, limit: 6, street }).catch(() => null)
  return Response.json(data ?? { covered: false }, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
