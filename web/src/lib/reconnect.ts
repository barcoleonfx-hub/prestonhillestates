import 'server-only'
// Reconnecting with leads who went quiet (see lib/reconnect-rules): the lists to work through, a preview of each
// email, the queue staff fill, and sending it in the background from the office mailbox (outside quiet times).

import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { admins, contacts, enquiries, properties, reconnects } from '@/db/schema'
import { recordOutgoing } from './enquiry-thread'
import { addressOf, trackOf, type LeadRow } from './followups'
import { mailboxStatus, sendFromMailbox } from './mailbox'
import { listPublished } from './properties'
import { knownBase, listingOptions, oneClickUrl, unsubscribeUrl } from './property-email-data'
import { MAX_BATCH, QUIET_DAYS, REPEAT_DAYS, lastTouch, nearestHomes, reconnectBlock, reconnectEmail, type Home, type ReconnectLead } from './reconnect-rules'
import { salesNear } from './sold-prices'
import { now, uid } from './util'
import { quietReason } from './whatsapp'

export type ReconnectRow = LeadRow & { lastReconnectAt: string | null; queued: boolean; block: string | null; touch: string }

const stateOf = (r: LeadRow, lastReconnectAt: string | null): ReconnectLead => ({
  status: r.e.status, createdAt: r.e.createdAt, lastInboundAt: r.e.lastInboundAt, lastOutboundAt: r.e.lastOutboundAt,
  doNotContact: !!r.c?.doNotContact, marketingOptOut: !!r.c?.marketingOptOut, email: r.e.email?.trim() || r.c?.email || null,
  lastReconnectAt, followupActive: r.e.followupState === 'active' || r.e.followupState === 'paused',
})

/** Everyone who's gone quiet: valuations (people who might sell or let) and buyers and tenants. */
export async function reconnectLists(at = new Date()) {
  await ready()
  const all = await db.select({ e: enquiries, c: contacts, channel: properties.channel, ownerName: admins.name, p: properties }).from(enquiries)
    .leftJoin(contacts, eq(enquiries.contactId, contacts.id)).leftJoin(properties, eq(enquiries.propertyId, properties.id)).leftJoin(admins, eq(enquiries.ownerId, admins.id))
    .where(inArray(enquiries.status, ['new', 'contacted', 'engaged', 'viewing', 'dormant'])).orderBy(desc(enquiries.createdAt)).limit(5000)
  const recs = await db.select({ enquiryId: reconnects.enquiryId, status: reconnects.status, at: reconnects.createdAt }).from(reconnects).orderBy(desc(reconnects.createdAt))
  const last = new Map<string, { status: string; at: string }>()
  for (const r of recs) if (!last.has(r.enquiryId)) last.set(r.enquiryId, r)
  // One row per person: their latest enquiry of each kind.
  const seen = new Set<string>()
  const rows: ReconnectRow[] = []
  for (const r of all) {
    const track = trackOf(r)
    const who = `${(r.e.contactId ?? r.e.email ?? r.e.phone ?? r.e.id).toLowerCase()}|${track.includes('valuation') ? 'v' : 's'}`
    if (seen.has(who)) continue
    seen.add(who)
    const lr = last.get(r.e.id)
    const lastReconnectAt = lr && lr.status !== 'skipped' ? lr.at : null
    // Only people quiet long enough, not reconnected with recently and not already being followed up are listed at
    // all (whatever else applies); the rest show greyed out with the reason (no email, unsubscribed...).
    if ((at.getTime() - Date.parse(lastTouch(r.e))) / 864e5 < QUIET_DAYS) continue
    if (lastReconnectAt && (at.getTime() - Date.parse(lastReconnectAt)) / 864e5 < REPEAT_DAYS) continue
    if (r.e.followupState === 'active' || r.e.followupState === 'paused') continue
    const block = reconnectBlock(stateOf(r, lastReconnectAt), at)
    rows.push({ ...r, lastReconnectAt, queued: lr?.status === 'queued', block, touch: lastTouch(r.e) })
  }
  const byTouch = (a: ReconnectRow, b: ReconnectRow) => (a.touch < b.touch ? 1 : -1)
  return {
    valuations: rows.filter((r) => trackOf(r).includes('valuation')).sort(byTouch),
    seekers: rows.filter((r) => !trackOf(r).includes('valuation')).sort(byTouch),
  }
}

/** New listings in the last few weeks, for the "tell past applicants" shortcut (lib/property-email-data). */
export async function newListings(days = 21) {
  const since = new Date(Date.now() - days * 864e5).toISOString()
  return db.select({ id: properties.id, ref: properties.ref, channel: properties.channel, displayAddress: properties.displayAddress, street: properties.street, town: properties.town, postcode: properties.postcode, price: properties.price, publishedAt: properties.publishedAt })
    .from(properties).where(and(eq(properties.published, true), gte(properties.publishedAt, since))).orderBy(desc(properties.publishedAt)).limit(12)
}

const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' })

/** The email for one lead, as it would go now. */
export async function buildReconnect(r: LeadRow, base: string, live?: Awaited<ReturnType<typeof listPublished>>) {
  const track = trackOf(r)
  const { address, postcode } = addressOf(r)
  const first = (r.e.name.trim().split(/\s+/)[0] ?? '').replace(/^(mr|mrs|ms|miss|dr)\.?$/i, '')
  let market = null as { where: string; count12: number; median12: number | null } | null
  let homes: Home[] = []
  let liveCount = 0
  if (track === 'sales-valuation' && postcode) {
    const near = await salesNear(postcode, { limit: 3 }).catch(() => null)
    if (near) market = { where: near.stats.label, count12: near.stats.count12, median12: near.stats.median12 }
  }
  if (track === 'buyer' || track === 'tenant') {
    const rows = (live ?? await listPublished({}).catch(() => [])).filter((p) => p.channel === (track === 'tenant' ? 'let' : 'sale') && p.status === 'available')
    liveCount = rows.length
    const target = r.p?.price ?? r.c?.maxPrice ?? null
    const opts = listingOptions(nearestHomes(rows, target), base)
    homes = opts.map((o) => ({ line: [o.card.address, o.card.priceText, o.card.specs.slice(0, 2).join(', ')].filter(Boolean).join(', '), url: `${o.card.url}${o.card.url.includes('?') ? '&' : '?'}utm_source=email&utm_campaign=reconnect` }))
  }
  return reconnectEmail(track, { first, me: r.ownerName ?? '', address, postcode, when: monthYear(r.e.createdAt), market, homes, liveCount, base, unsubscribeUrl: r.c ? unsubscribeUrl(base, r.c.id) : null })
}

export async function leadRow(id: string): Promise<LeadRow | null> {
  const [r] = await db.select({ e: enquiries, c: contacts, channel: properties.channel, ownerName: admins.name, p: properties }).from(enquiries)
    .leftJoin(contacts, eq(enquiries.contactId, contacts.id)).leftJoin(properties, eq(enquiries.propertyId, properties.id)).leftJoin(admins, eq(enquiries.ownerId, admins.id))
    .where(eq(enquiries.id, id)).limit(1)
  return r ?? null
}

/** Staff chose who to reconnect with: queued, to go out in the background. */
export async function queueReconnects(ids: string[], by: string): Promise<{ queued: number; skipped: number }> {
  await ready()
  const { valuations, seekers } = await reconnectLists()
  const ok = new Map([...valuations, ...seekers].filter((r) => !r.block && !r.queued).map((r) => [r.e.id, r]))
  let queued = 0, skipped = 0
  for (const id of ids.slice(0, MAX_BATCH)) {
    if (!ok.has(id)) { skipped++; continue }
    await db.insert(reconnects).values({ id: uid(), enquiryId: id, status: 'queued', queuedBy: by, createdAt: now() })
    queued++
  }
  return { queued, skipped: skipped + Math.max(0, ids.length - MAX_BATCH) }
}

/** Sends what's queued, a few at a time, outside quiet times. Called by the background job. */
export async function runReconnects(at = new Date()): Promise<{ ran: boolean; sent?: number; skipped?: number; failed?: number; error?: string }> {
  await ready()
  if (quietReason(at)) return { ran: false }
  const queued = await db.select().from(reconnects).where(eq(reconnects.status, 'queued')).orderBy(reconnects.createdAt).limit(10)
  if (!queued.length) return { ran: false }
  const claim = await getClient().execute({
    sql: `INSERT INTO jobs (name, last_run_at) VALUES ('reconnects', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`,
    args: [at.toISOString(), new Date(at.getTime() - 3 * 60_000).toISOString()],
  })
  if (claim.rowsAffected !== 1) return { ran: false }
  const box = await mailboxStatus().catch(() => null)
  if (!box?.hasPassword) return { ran: true, error: 'The office mailbox isn’t connected.' }
  const base = await knownBase()
  const live = await listPublished({}).catch(() => [])
  const res = { ran: true, sent: 0, skipped: 0, failed: 0 }
  for (const q of queued) {
    const done = (status: string, detail: string | null) => db.update(reconnects).set({ status, detail, sentAt: now() }).where(eq(reconnects.id, q.id))
    const r = await leadRow(q.enquiryId)
    if (!r) { await done('skipped', 'The enquiry no longer exists'); res.skipped++; continue }
    // Checked again at sending time: they may have replied, unsubscribed or been contacted since.
    const block = reconnectBlock(stateOf(r, null), at)
    if (block) { await done('skipped', block); res.skipped++; continue }
    const m = await buildReconnect(r, base, live)
    const to = r.e.email?.trim() || r.c?.email
    const sent = await sendFromMailbox({
      to: [to!], subject: m.subject, text: m.text, html: m.html, by: q.queuedBy,
      headers: r.c ? { 'List-Unsubscribe': `<${oneClickUrl(base, r.c.id)}>, <mailto:${box.user}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'X-Reconnect': '1' } : { 'X-Reconnect': '1' },
    })
    if (!sent.ok) {
      res.failed++
      if (/password|connect the mailbox|couldn’t reach|ECONN|ETIMEDOUT/i.test(sent.error)) return { ...res, error: sent.error }
      await done('failed', sent.error.slice(0, 300)); continue
    }
    await recordOutgoing(r.e.id, { messageId: sent.messageId, subject: m.subject, body: m.text, by: q.queuedBy, via: 'reconnect' })
    await done('sent', m.subject)
    res.sent++
  }
  return res
}

export async function reconnectHistory(limit = 40) {
  return db.select({ x: reconnects, name: enquiries.name, by: admins.name }).from(reconnects).innerJoin(enquiries, eq(reconnects.enquiryId, enquiries.id))
    .leftJoin(admins, eq(reconnects.queuedBy, admins.id)).orderBy(desc(reconnects.createdAt)).limit(limit)
}
