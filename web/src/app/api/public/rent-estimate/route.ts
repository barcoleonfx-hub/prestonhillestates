import { rentEstimate } from '@/lib/lettings'

export const dynamic = 'force-dynamic'

/** GET ?postcode=HA3 0PS&beds=2 → a rent range and the evidence behind it, for the Landlords page. */
export async function GET(req: Request) {
  const u = new URL(req.url)
  const est = await rentEstimate(u.searchParams.get('postcode') ?? '', Number(u.searchParams.get('beds') ?? 2)).catch(() => null)
  if (!est) return Response.json({ ok: false, error: 'Enter a full postcode, like HA3 0PS.' }, { status: 422 })
  return Response.json({ ok: true, ...est }, { headers: { 'Cache-Control': 'no-store' } })
}
