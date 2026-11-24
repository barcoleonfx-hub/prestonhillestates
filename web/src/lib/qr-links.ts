import 'server-only'
// QR codes on posters go through our own short link (/go/<code>) before reaching where they're meant to, so we can
// count the scans: a poster's code is the only way to know whether people walking past are interested. Each scan is
// kept with a one-way daily fingerprint (so one phone scanning twice counts as one person); nothing that identifies
// anyone is stored.

import { createHash } from 'node:crypto'
import { and, desc, eq, gte } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { qrScans, settings } from '@/db/schema'
import { OFFICE_WHATSAPP, waLink } from './whatsapp'
import { now, uid } from './util'

/** What a passer-by sends when they scan the Black Friday poster: our WhatsApp, with the details we need laid out. */
export const LANDLORD_500_MESSAGE = 'Hi Preston Hill Estates, I’d like to introduce a landlord for your £500 Black Friday offer.\n\nLandlord’s name:\nTheir phone number:\nWhere their property is:\nThey’re happy for you to contact them: Yes\n\nMy name:'

export const QR_LINKS: Record<string, { label: string; target: string | (() => Promise<string>) }> = {
  'landlord-500': { label: 'Black Friday poster: £500 for introducing a landlord', target: waLink(OFFICE_WHATSAPP, LANDLORD_500_MESSAGE) },
  // Read when scanned, so a printed poster keeps working when the link is set or changed later.
  review: { label: 'Office poster: leave us a Google review', target: () => reviewLink().then((r) => r.url) },
}

/** Where a scan of a code goes. */
export async function qrTarget(code: string): Promise<string | null> {
  const l = QR_LINKS[code]
  if (!l) return null
  return typeof l.target === 'string' ? l.target : l.target()
}

/** Our Google "write a review" link (Google Business Profile, "Ask for reviews"). */
export const GOOGLE_REVIEW_LINK = 'https://g.page/r/CdtU9pacgT8JEAE/review'
/** Google's "write a review" link for the branch: as staff changed it on the review poster, else ours above. */
export async function reviewLink(): Promise<{ url: string; set: boolean; from: 'poster' | 'settings' | 'search' }> {
  await ready()
  const own = await db.query.settings.findFirst({ where: eq(settings.key, 'google_review_link') })
  if (own?.value && /^https:\/\//.test(own.value)) return { url: own.value, set: true, from: 'poster' }
  return { url: GOOGLE_REVIEW_LINK, set: true, from: 'poster' }
}

/** Link previews and crawlers aren't people scanning a poster. */
const BOT = /bot|crawl|spider|preview|facebookexternalhit|whatsapp\/|slackbot|discord|telegram|curl|wget|python|headless/i

export async function recordScan(code: string, h: { ip: string; ua: string }): Promise<void> {
  if (!h.ua || BOT.test(h.ua)) return
  await ready()
  const day = new Date().toISOString().slice(0, 10)
  const who = createHash('sha256').update(`${process.env.AUTH_SECRET ?? 'dev'}|${day}|${h.ip}|${h.ua}`).digest('base64url').slice(0, 16)
  await db.insert(qrScans).values({ id: uid(), code, who, at: now() })
}

export type ScanStats = { scans: number; people: number; today: number; last: string | null; byDay: { day: string; scans: number }[] }

/** How often a code has been scanned: in all, by how many phones (a phone counts once a day), today, and by day. */
export async function scanStats(code: string, days = 30): Promise<ScanStats> {
  await ready()
  const since = new Date(Date.now() - days * 864e5).toISOString()
  const rows = await db.select({ who: qrScans.who, at: qrScans.at }).from(qrScans).where(and(eq(qrScans.code, code), gte(qrScans.at, since))).orderBy(desc(qrScans.at))
  const today = new Date().toISOString().slice(0, 10)
  const byDay = new Map<string, number>()
  for (const r of rows) byDay.set(r.at.slice(0, 10), (byDay.get(r.at.slice(0, 10)) ?? 0) + 1)
  return {
    scans: rows.length,
    people: new Set(rows.map((r) => `${r.at.slice(0, 10)}|${r.who}`)).size,
    today: rows.filter((r) => r.at.startsWith(today)).length,
    last: rows[0]?.at ?? null,
    byDay: [...byDay].map(([day, scans]) => ({ day, scans })),
  }
}
