import { db, ready } from '@/db/client'
import { siteEvents } from '@/db/schema'
import { now, uid } from '@/lib/util'

export const dynamic = 'force-dynamic'

// Anonymous counts from the website (a WhatsApp button tapped, and on which page). Nothing about the person is kept.
const KINDS = new Set(['whatsapp_click'])
const hits = new Map<string, number[]>()

export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const recent = (hits.get(ip) ?? []).filter((t) => t > Date.now() - 60_000)
  if (recent.length >= 20) return new Response(null, { status: 204 })
  hits.set(ip, [...recent, Date.now()])
  if (hits.size > 5000) hits.clear()
  const b = (await req.json().catch(() => null)) as { kind?: unknown; page?: unknown; detail?: unknown } | null
  if (!b || typeof b.kind !== 'string' || !KINDS.has(b.kind)) return new Response(null, { status: 204 })
  const page = typeof b.page === 'string' ? b.page.split('?')[0].replace(/[^\w/.-]/g, '').slice(0, 120) : null
  const detail = typeof b.detail === 'string' ? b.detail.replace(/[^\w .:/-]/g, '').slice(0, 60) : null
  await ready()
  await db.insert(siteEvents).values({ id: uid(), kind: b.kind, page, detail, createdAt: now() }).catch(() => {})
  return new Response(null, { status: 204 })
}
