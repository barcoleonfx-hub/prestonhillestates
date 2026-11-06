import { instantEstimate } from '@/lib/instant-estimate'

export const dynamic = 'force-dynamic'
const POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/

/** The instant estimate on its own, for the valuation form's thank-you card when it didn't come back with the request. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const s = (k: string) => (typeof b?.[k] === 'string' ? (b[k] as string).slice(0, 200) : '')
  const postcode = s('postcode').toUpperCase().trim().replace(/\s+/g, ' ')
  if (!POSTCODE.test(postcode)) return Response.json({ estimate: null }, { status: 400 })
  const estimate = await instantEstimate({ postcode, intent: s('intent'), propertyType: s('propertyType'), bedrooms: s('bedrooms'), address: s('address') }).catch(() => null)
  return Response.json({ estimate }, { headers: { 'Cache-Control': 'no-store' } })
}
