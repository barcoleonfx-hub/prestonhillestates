import { bookletInput } from '@/lib/booklet-data'
import { shareByToken } from '@/lib/booklet-share'
import { aerialPhoto } from '@/lib/mapbox'

export const dynamic = 'force-dynamic'

// The aerial photo of the home at the top of the "property report" email. Email apps fetch it once and keep it,
// so it's made here (with our Mapbox token) and remembered for a day; if it can't be made, the shopfront is used.
const memo = new Map<string, { at: number; body: ArrayBuffer; type: string }>()

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const fallback = () => Response.redirect(new URL('/img/shopfront.jpg', req.url), 302)
  const hit = memo.get(token)
  if (hit && Date.now() - hit.at < 86400_000) return new Response(hit.body, { headers: { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=86400' } })
  const share = await shareByToken(token)
  if (!share) return fallback()
  try {
    const data = await bookletInput(share.bookletId, { name: 'Preston Hill Estates' })
    if (!data?.area.home) return fallback()
    const img = await aerialPhoto(data.area.home)
    if (!img) return fallback()
    memo.set(token, { at: Date.now(), ...img })
    if (memo.size > 300) memo.delete(memo.keys().next().value!)
    return new Response(img.body, { headers: { 'Content-Type': img.type, 'Cache-Control': 'public, max-age=86400' } })
  } catch {
    return fallback()
  }
}
