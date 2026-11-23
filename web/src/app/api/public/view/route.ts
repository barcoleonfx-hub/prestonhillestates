import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { db, ready } from '@/db/client'
import { pageViews } from '@/db/schema'
import { deviceOf, isBot, sourceOf } from '@/lib/site-stats-rules'
import { now, uid } from '@/lib/util'

export const dynamic = 'force-dynamic'

// One page seen on the website, for the stats page. Nothing that identifies anyone is kept: a one-way fingerprint that
// changes every day (so a visitor counts once a day), the page, where the visit came from and the kind of device.
const hits = new Map<string, number[]>()
const OWN = ['prestonhillestates.com', 'prestonhillestates.co.uk', 'prestonhill.onrender.com', 'localhost']

export async function POST(req: Request) {
  const ua = req.headers.get('user-agent') ?? ''
  if (isBot(ua)) return new Response(null, { status: 204 })
  // Staff signed in to the portal aren't visitors.
  if ((await cookies()).get('phe_session')) return new Response(null, { status: 204 })
  const ip = req.headers.get('cf-connecting-ip') ?? (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ?? ''
  const recent = (hits.get(ip) ?? []).filter((t) => t > Date.now() - 60_000)
  if (recent.length >= 60) return new Response(null, { status: 204 })
  hits.set(ip, [...recent, Date.now()])
  if (hits.size > 5000) hits.clear()
  const b = (await req.json().catch(() => null)) as { path?: unknown; ref?: unknown; first?: unknown; utm_source?: unknown; utm_medium?: unknown } | null
  if (!b || typeof b.path !== 'string') return new Response(null, { status: 204 })
  const path = b.path.split('?')[0].replace(/[^\w/.-]/g, '').slice(0, 160) || '/'
  if (/^\/(admin|api|report|go)(\/|$)/.test(path)) return new Response(null, { status: 204 })
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : '')
  // Where the visit came from is read on its first page only (later pages were reached from our own site).
  // A page opened from another of our own pages (the homepage and the property pages load separately) isn't a new visit.
  let refHost = ''
  try { refHost = str(b.ref) ? new URL(str(b.ref)).hostname.replace(/^www\./, '') : '' } catch { refHost = '' }
  const internal = !!refHost && OWN.some((o) => refHost === o || refHost.endsWith(`.${o}`)) && !str(b.utm_source)
  const source = b.first === true && !internal ? sourceOf(str(b.ref), { source: str(b.utm_source), medium: str(b.utm_medium) }, OWN) : null
  const day = new Date().toISOString().slice(0, 10)
  const visitor = createHash('sha256').update(`${process.env.AUTH_SECRET ?? 'dev'}|views|${day}|${ip}|${ua}`).digest('base64url').slice(0, 16)
  await ready()
  await db.insert(pageViews).values({ id: uid(), path, source, device: deviceOf(ua), visitor, at: now() }).catch(() => {})
  return new Response(null, { status: 204 })
}
