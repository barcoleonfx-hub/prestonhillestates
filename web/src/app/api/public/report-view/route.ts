import { cookies } from 'next/headers'
import { recordView } from '@/lib/booklet-share'
import { isBot } from '@/lib/site-stats-rules'

export const dynamic = 'force-dynamic'

// The report was read: sent by the page itself after it has been on screen for a few seconds in a real browser, so
// link previews (WhatsApp, email scanners) never count. Staff signed in to the portal don't count either.
export async function POST(req: Request) {
  if (isBot(req.headers.get('user-agent') ?? '')) return new Response(null, { status: 204 })
  if ((await cookies()).get('phe_session')) return new Response(null, { status: 204 })
  const b = (await req.json().catch(() => null)) as { token?: unknown } | null
  if (!b || typeof b.token !== 'string' || !/^[\w-]{16,40}$/.test(b.token)) return new Response(null, { status: 204 })
  await recordView(b.token).catch(() => {})
  return new Response(null, { status: 204 })
}
