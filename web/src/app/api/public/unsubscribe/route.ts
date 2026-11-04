import { optOut } from '@/lib/unsubscribe'

export const dynamic = 'force-dynamic'

/** One-click unsubscribe (RFC 8058), used by the "Unsubscribe" button Gmail and Apple Mail show next to our emails. */
export async function POST(req: Request) {
  const u = new URL(req.url)
  const ok = await optOut(u.searchParams.get('c') ?? '', u.searchParams.get('t') ?? '')
  return new Response(ok ? 'Unsubscribed' : 'Link not recognised', { status: ok ? 200 : 400 })
}
