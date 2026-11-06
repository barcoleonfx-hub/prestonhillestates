import { currentAdmin } from '@/lib/auth'
import { otmAskingPrices, otmUrl } from '@/lib/otm-check'

export const dynamic = 'force-dynamic'

/**
 * Staff check of the OnTheMarket backup on the live site: /admin/otm-check?postcode=HA3 0PS&beds=3 (add &rent=1
 * for homes to rent). Shows the search it read, how, and the prices it found.
 */
export async function GET(req: Request) {
  if (!(await currentAdmin())) return new Response('Sign in to the portal first', { status: 401 })
  const u = new URL(req.url)
  const postcode = (u.searchParams.get('postcode') ?? 'HA3 0PS').toUpperCase().trim()
  const beds = u.searchParams.get('beds') ? Number(u.searchParams.get('beds')) : null
  const rent = u.searchParams.get('rent') === '1'
  const r = await otmAskingPrices(postcode, { rent, beds })
  return Response.json({ worked: r.prices.length >= 3, postcode, beds, rent, search: otmUrl(postcode, { rent, beds }), ...r }, { headers: { 'Cache-Control': 'no-store' } })
}
