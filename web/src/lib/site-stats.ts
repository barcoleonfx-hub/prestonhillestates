import 'server-only'
// The numbers for the Website stats page: who's on the site now, visitors by day, the pages and properties they look
// at, where they come from, and how many became leads. Read from page_views (see /api/public/view).

import { and, eq, gte, inArray, min } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, pageViews, properties, siteEvents } from '@/db/schema'
import { pageLabel } from './site-stats-rules'
import { displayAddressFor, priceLabel } from './properties'

export type Range = 'today' | '7' | '30'
const DAY = 864e5
/** The date in London ("2026-11-23"), so "today" starts at midnight here, not in UTC. */
export const londonDay = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/London' })

type Row = { path: string; source: string | null; device: string; visitor: string; at: string }
const count = <K extends string>(xs: K[]) => { const m = new Map<K, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]) }

export async function siteStats(range: Range) {
  await ready()
  const t = Date.now()
  const rows: Row[] = await db.select({ path: pageViews.path, source: pageViews.source, device: pageViews.device, visitor: pageViews.visitor, at: pageViews.at })
    .from(pageViews).where(gte(pageViews.at, new Date(t - 31 * DAY).toISOString()))
  const today = londonDay(new Date(t)), yesterday = londonDay(new Date(t - DAY))
  const dayOf = new Map<string, string>()
  const day = (r: Row) => { let d = dayOf.get(r.at); if (!d) { d = londonDay(r.at); dayOf.set(r.at, d) } return d }
  const people = (xs: Row[]) => new Set(xs.map((r) => r.visitor)).size // the fingerprint changes daily, so this counts daily visitors

  // On the site now: anyone who opened a page in the last 5 minutes, and the page they're on.
  const live = rows.filter((r) => Date.parse(r.at) >= t - 5 * 60_000)
  const latest = new Map<string, Row>()
  for (const r of live) if (!latest.has(r.visitor) || latest.get(r.visitor)!.at < r.at) latest.set(r.visitor, r)

  const days30 = Array.from({ length: 30 }, (_, i) => londonDay(new Date(t - (29 - i) * DAY)))
  const byDay = new Map<string, Row[]>()
  for (const r of rows) { const d = day(r); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r) }
  const span = (from: number) => rows.filter((r) => Date.parse(r.at) >= from)
  const startToday = (() => { const x = byDay.get(today) ?? []; return x })()
  const tile = (xs: Row[]) => ({ visitors: people(xs), views: xs.length })

  const inRange = range === 'today' ? startToday : span(t - Number(range) * DAY)
  const since = range === 'today' ? new Date(`${today}T00:00:00`).toISOString() : new Date(t - Number(range) * DAY).toISOString()

  // The pages and properties they looked at.
  const labelled = inRange.map((r) => ({ r, ...pageLabel(r.path) }))
  const refs = [...new Set(labelled.flatMap((x) => (x.ref ? [x.ref] : [])).concat([...latest.values()].flatMap((r) => pageLabel(r.path).ref ?? [])))]
  const props = refs.length ? await db.select().from(properties).where(inArray(properties.ref, refs)) : []
  const propOf = new Map(props.map((p) => [p.ref, p]))
  const nameOf = (label: string, ref: string | null) => { const p = ref ? propOf.get(ref) : null; return p ? displayAddressFor(p) || ref! : label }
  const pages = count(labelled.map((x) => nameOf(x.label, x.ref))).slice(0, 12)
  const homes = count(labelled.flatMap((x) => (x.ref ? [x.ref] : []))).slice(0, 10).map(([ref, views]) => {
    const p = propOf.get(ref)
    return { ref, views, people: new Set(labelled.filter((x) => x.ref === ref).map((x) => x.r.visitor)).size, address: p ? displayAddressFor(p) : ref, price: p ? priceLabel(p) : null, channel: p?.channel ?? null, id: p?.id ?? null }
  })

  // Where visits came from (a visit's first page), and the devices visitors used.
  const sources = count(inRange.flatMap((r) => (r.source ? [r.source] : [])))
  const devByVisitor = new Map<string, string>()
  for (const r of inRange) devByVisitor.set(r.visitor, r.device)
  const devices = count([...devByVisitor.values()])

  // What came of it: enquiries made on the website, and WhatsApp buttons tapped, since visits were first counted (so
  // the leads and the visitors cover the same time).
  const first = (await db.select({ at: min(pageViews.at) }).from(pageViews))[0]?.at ?? null
  const from = first && first > since ? first : since
  const [leads, taps] = await Promise.all([
    db.select({ kind: enquiries.kind }).from(enquiries).where(and(eq(enquiries.source, 'website'), gte(enquiries.createdAt, from))),
    db.select({ id: siteEvents.id }).from(siteEvents).where(and(eq(siteEvents.kind, 'whatsapp_click'), gte(siteEvents.createdAt, from))),
  ])
  const kinds = count(leads.map((l) => l.kind))
  const leadCount = leads.length + taps.length

  return {
    live: { count: latest.size, pages: count([...latest.values()].map((r) => { const l = pageLabel(r.path); return nameOf(l.label, l.ref) })) },
    tiles: {
      today: tile(startToday), yesterday: tile(byDay.get(yesterday) ?? []),
      week: { visitors: days30.slice(-7).reduce((n, d) => n + people(byDay.get(d) ?? []), 0), views: days30.slice(-7).reduce((n, d) => n + (byDay.get(d)?.length ?? 0), 0) },
      month: { visitors: days30.reduce((n, d) => n + people(byDay.get(d) ?? []), 0), views: days30.reduce((n, d) => n + (byDay.get(d)?.length ?? 0), 0) },
    },
    daily: days30.map((d) => ({ day: d, visitors: people(byDay.get(d) ?? []), views: byDay.get(d)?.length ?? 0 })),
    range: {
      visitors: range === 'today' ? people(inRange) : days30.slice(-Number(range)).reduce((n, d) => n + people(byDay.get(d) ?? []), 0),
      views: inRange.length, pages, homes, sources, devices,
      leads: { valuation: kinds.find(([k]) => k === 'valuation')?.[1] ?? 0, viewing: kinds.filter(([k]) => k !== 'valuation' && k !== 'buyer' && k !== 'tenant').reduce((n, [, c]) => n + c, 0), registrations: kinds.filter(([k]) => k === 'buyer' || k === 'tenant').reduce((n, [, c]) => n + c, 0), whatsapp: taps.length, total: leadCount },
    },
    /** When visits were first counted, if that's inside the period shown. */
    countingFrom: first && first > since ? first : null,
    counting: !!first,
  }
}
export type SiteStats = Awaited<ReturnType<typeof siteStats>>
