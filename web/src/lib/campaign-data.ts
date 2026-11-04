import 'server-only'
import { and, asc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { campaignRecipients, campaigns, contacts, propertyEmails, settings, soldPrices, type Campaign, type Contact } from '@/db/schema'
import { ALL_ROLES, renderCampaign, type Audience, type Content, type Listing, type Reader, type Role, type Shared, type Snapshot } from './campaign'
import { GUIDES } from './guides'
import { bulkSender } from './mailbox'
import { PROPERTY_TYPES, FURNISHING, labelFor } from './options'
import { displayAddressFor, headlineFor, listPublished, priceLabel, slugFor } from './properties'
import { LR_CREDIT, PATCH, TYPE_LABEL } from './sold-prices'
import { oneClickUrl, unsubscribeUrl } from './property-email-data'
import { now } from './util'

// ---------- what goes in the emails ----------

const AREA_NAMES: Record<string, string> = {
  HA0: 'Wembley & Alperton', HA1: 'Harrow', HA2: 'South Harrow & Rayners Lane', HA3: 'Kenton & Harrow Weald',
  HA7: 'Stanmore', HA8: 'Edgware', HA9: 'Wembley & Preston Road', NW9: 'Kingsbury & Colindale',
}
const outwardIn = (text: string | null | undefined) => /\b([A-Z]{1,2}\d[A-Z\d]?)(?:\s*\d[A-Z]{2})?\b/i.exec(text ?? '')?.[1]?.toUpperCase() ?? null
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }

/** Typical sold prices for each district we cover, this year against last, from the Land Registry data we hold. */
async function marketSnapshots(): Promise<Record<string, Snapshot>> {
  const latest = (await db.select({ d: sql<string>`max(${soldPrices.soldOn})` }).from(soldPrices))[0]?.d
  if (!latest) return {}
  // Count back from the latest sale recorded, not from today: the Land Registry publishes a couple of months behind.
  const end = new Date(`${latest}T12:00:00Z`)
  const iso = (months: number) => { const d = new Date(end); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10) }
  const y1 = iso(12), y2 = iso(24)
  const rows = await db.select({ o: soldPrices.outward, t: soldPrices.type, p: soldPrices.price, d: soldPrices.soldOn }).from(soldPrices)
    .where(and(inArray(soldPrices.outward, PATCH), gte(soldPrices.soldOn, y2)))
  const label = end.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const snap = (area: string, name: string, xs: typeof rows): Snapshot => {
    const cur = xs.filter((r) => r.d > y1), prev = xs.filter((r) => r.d <= y1)
    const byType = ['D', 'S', 'T', 'F'].map((t) => { const ps = cur.filter((r) => r.t === t).map((r) => r.p); return { label: TYPE_LABEL[t], median: median(ps) ?? 0, count: ps.length } }).filter((t) => t.count >= 5)
    // Only compare with last year when there were enough sales for the figure to mean something.
    return { area, label: name, median: median(cur.map((r) => r.p)), prevMedian: prev.length >= 20 && cur.length >= 20 ? median(prev.map((r) => r.p)) : null, count: cur.length, prevCount: prev.length, byType, latest: label }
  }
  const out: Record<string, Snapshot> = { ALL: snap('ALL', 'Harrow & Wembley', rows) }
  for (const o of PATCH) { const xs = rows.filter((r) => r.o === o); if (xs.length >= 10) out[o] = snap(o, `${o} · ${AREA_NAMES[o] ?? o}`, xs) }
  return out
}

export async function campaignShared(base: string): Promise<Shared> {
  await ready()
  const live = (await listPublished({})).filter((p) => p.status === 'available' || p.status === 'under_offer')
  const listings: Listing[] = live.map((p) => {
    const type = labelFor(PROPERTY_TYPES, p.propertyType)
    return {
      id: p.id, url: `${base}/properties/${slugFor(p)}`, photo: p.cover ? (p.cover.url.startsWith('/') ? `${base}${p.cover.url}` : p.cover.url) : null,
      channel: p.channel === 'let' ? 'let' : 'sale', priceText: priceLabel(p), price: p.price, address: displayAddressFor(p), headline: headlineFor(p),
      specs: [p.bedrooms ? `${p.bedrooms} bed` : '', p.bathrooms ? `${p.bathrooms} bath` : '', type, p.channel === 'let' && p.furnishing ? labelFor(FURNISHING, p.furnishing) : '', p.status === 'under_offer' ? 'Under offer' : ''].filter(Boolean),
      beds: p.bedrooms, outward: outwardIn(p.postcode) ?? outwardIn(p.displayAddress), place: p.locality || p.town || null, publishedAt: p.publishedAt,
    }
  })
  return {
    base, listings, market: await marketSnapshots(), credit: LR_CREDIT,
    guides: GUIDES.map((g) => ({ slug: g.slug, title: g.title, summary: g.summary, url: `${base}/guides/${g.slug}` })),
  }
}

// ---------- who gets them ----------

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
export const rolesFrom = (roles: string): Role[] => {
  const rs = roles.split(/[,\s]+/).filter((r): r is Role => (ALL_ROLES as string[]).includes(r) && r !== 'other')
  return rs.length ? rs : ['other']
}

export function readerFor(c: Contact, base: string): Reader {
  return {
    contactId: c.id, name: c.name, email: (c.email ?? '').trim(), roles: rolesFrom(c.roles),
    outward: outwardIn(c.address) ?? outwardIn(c.areas), areas: c.areas, budget: c.maxPrice, minBeds: c.minBeds, position: c.position,
    unsubscribeUrl: unsubscribeUrl(base, c.id),
  }
}

/** Everyone who can be emailed and fits the audience, one per email address. */
export async function audienceContacts(a: Audience, opts: { ignoreRoles?: boolean } = {}): Promise<Contact[]> {
  await ready()
  const conds = [isNotNull(contacts.email), eq(contacts.archived, false), eq(contacts.doNotContact, false), eq(contacts.marketingOptOut, false)]
  if (a.activeMonths) conds.push(gte(sql`coalesce(${contacts.lastContactAt}, ${contacts.createdAt})`, new Date(Date.now() - a.activeMonths * 30.4 * 86400000).toISOString()))
  const rows = await db.select().from(contacts).where(and(...conds)).orderBy(asc(contacts.createdAt))
  const areas = a.areas.split(/[,;]+/).map((x) => x.trim()).filter(Boolean)
  const seen = new Set<string>()
  return rows.filter((c) => {
    const e = (c.email ?? '').trim().toLowerCase()
    if (!EMAIL.test(e) || seen.has(e)) return false
    if (!opts.ignoreRoles && !rolesFrom(c.roles).some((r) => a.roles.includes(r))) return false
    if (areas.length) {
      const text = `${c.address ?? ''} ${c.areas ?? ''}`.toUpperCase()
      const o = outwardIn(c.address) ?? outwardIn(c.areas)
      if (!areas.some((x) => (/^[A-Z]{1,2}\d/i.test(x) ? o === x.toUpperCase() || (!!o && o.startsWith(x.toUpperCase()) && /\d$/.test(x)) : text.includes(x.toUpperCase())))) return false
    }
    seen.add(e)
    return true
  })
}

/** Size of the audience, and how it splits, for the editor. */
export async function audienceSummary(a: Audience) {
  const everyone = await audienceContacts(a, { ignoreRoles: true })
  const byRole = Object.fromEntries(ALL_ROLES.map((r) => [r, everyone.filter((c) => rolesFrom(c.roles).includes(r)).length])) as Record<Role, number>
  const chosen = everyone.filter((c) => rolesFrom(c.roles).some((r) => a.roles.includes(r)))
  return { total: chosen.length, byRole, samples: ALL_ROLES.map((r) => chosen.find((c) => rolesFrom(c.roles).includes(r) && (c.maxPrice || c.areas || c.address)) ?? chosen.find((c) => rolesFrom(c.roles).includes(r))).filter(Boolean) as Contact[] }
}

// ---------- sending ----------

const LIMITS_KEY = 'campaign_limits'
export type Limits = { perDay: number }
export async function campaignLimits(): Promise<Limits> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, LIMITS_KEY) })
  try { return { perDay: 400, ...(row ? JSON.parse(row.value) : {}) } } catch { return { perDay: 400 } }
}
export async function setCampaignLimits(l: Limits) {
  const value = JSON.stringify({ perDay: Math.max(20, Math.min(5000, Math.round(l.perDay))) })
  await db.insert(settings).values({ key: LIMITS_KEY, value, updatedAt: now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now() } })
}

const londonMidnight = () => {
  const d = new Date()
  const ymd = d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
  const off = d.toLocaleString('en-GB', { timeZone: 'Europe/London', timeZoneName: 'short' }).includes('BST') ? '+01:00' : '+00:00'
  return new Date(`${ymd}T00:00:00${off}`).toISOString()
}
export async function sentToday(): Promise<number> {
  const since = londonMidnight()
  const [a] = await db.select({ n: sql<number>`count(*)` }).from(campaignRecipients).where(and(eq(campaignRecipients.status, 'sent'), gte(campaignRecipients.sentAt, since)))
  const [b] = await db.select({ n: sql<number>`count(*)` }).from(propertyEmails).where(and(eq(propertyEmails.status, 'sent'), gte(propertyEmails.sentAt, since)))
  return Number(a?.n ?? 0) + Number(b?.n ?? 0)
}

export const parseContent = (c: Campaign) => JSON.parse(c.content) as Content
export const parseAudience = (c: Campaign) => JSON.parse(c.audience) as Audience
export const monthLabel = () => new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' })

/** Freezes the list of people for a campaign and starts it. The scheduler then sends a few at a time. */
export async function queueCampaign(c: Campaign, by: string, base: string): Promise<number> {
  const people = await audienceContacts(parseAudience(c))
  // The scheduler has no browser request to read the website's address from, so keep it with the campaign.
  const content = { ...parseContent(c), base }
  await db.delete(campaignRecipients).where(eq(campaignRecipients.campaignId, c.id))
  for (let i = 0; i < people.length; i += 200) {
    await db.insert(campaignRecipients).values(people.slice(i, i + 200).map((p) => ({ campaignId: c.id, contactId: p.id, email: p.email!.trim(), status: 'queued' })))
  }
  await db.update(campaigns).set({ content: JSON.stringify(content), status: 'sending', total: people.length, sent: 0, failed: 0, lastError: null, startedBy: by, startedAt: now(), finishedAt: null, updatedAt: now() }).where(eq(campaigns.id, c.id))
  return people.length
}

async function recount(id: string) {
  const rows = await db.select({ s: campaignRecipients.status, n: sql<number>`count(*)` }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, id)).groupBy(campaignRecipients.status)
  const n = (s: string) => Number(rows.find((r) => r.s === s)?.n ?? 0)
  return { sent: n('sent'), failed: n('failed') + n('skipped'), queued: n('queued') }
}

const PER_TICK = 12 // every 2 minutes: at most ~360 an hour, under the daily limit

async function claim(): Promise<boolean> {
  const t = new Date().toISOString(), before = new Date(Date.now() - 90_000).toISOString()
  const r = await getClient().execute({ sql: `INSERT INTO jobs (name, last_run_at) VALUES ('campaigns', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`, args: [t, before] })
  return r.rowsAffected === 1
}

/** Sends the next few emails of any campaign that's sending. Called by the scheduler every 2 minutes. */
export async function runCampaigns(): Promise<{ ran: boolean; sent?: number; error?: string }> {
  await ready()
  const live = await db.select().from(campaigns).where(eq(campaigns.status, 'sending')).orderBy(asc(campaigns.startedAt)).limit(1)
  if (!live.length || !(await claim())) return { ran: false }
  const c = live[0]
  const base = (parseContent(c) as Content & { base?: string }).base ?? process.env.PORTAL_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
  const { perDay } = await campaignLimits()
  const allowance = Math.min(PER_TICK, perDay - (await sentToday()))
  if (allowance <= 0) {
    await db.update(campaigns).set({ lastError: `Daily limit of ${perDay} reached. Sending carries on tomorrow.`, updatedAt: now() }).where(eq(campaigns.id, c.id))
    return { ran: true, sent: 0 }
  }
  const batch = await db.select().from(campaignRecipients).where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.status, 'queued'))).limit(allowance)
  let sent = 0, stop: string | null = null
  if (batch.length) {
    const tx = await bulkSender()
    if ('error' in tx) stop = tx.error
    else {
      try {
        const shared = await campaignShared(base)
        const content = parseContent(c), month = monthLabel()
        const people = new Map((await db.select().from(contacts).where(inArray(contacts.id, batch.map((b) => b.contactId)))).map((p) => [p.id, p]))
        for (const r of batch) {
          const p = people.get(r.contactId)
          if (!p || p.marketingOptOut || p.archived || p.doNotContact || !p.email) {
            await db.update(campaignRecipients).set({ status: 'skipped', error: p?.marketingOptOut ? 'Unsubscribed' : 'No longer on the list', sentAt: now() }).where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.contactId, r.contactId)))
            continue
          }
          const reader = readerFor(p, base)
          const m = renderCampaign(content, reader, shared, { campaign: c.name, sender: { email: tx.user }, month })
          const res = await tx.send({
            to: reader.email, subject: m.subject, text: m.text, html: m.html,
            headers: { 'List-Unsubscribe': `<${oneClickUrl(base, p.id)}>, <mailto:${tx.user}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'X-Campaign': c.id },
          })
          if (res.ok) { sent++; await db.update(campaignRecipients).set({ status: 'sent', error: null, sentAt: now() }).where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.contactId, r.contactId))) }
          else if (res.fatal) { stop = res.error; break } // leave it queued; try again next time
          else await db.update(campaignRecipients).set({ status: 'failed', error: res.error, sentAt: now() }).where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.contactId, r.contactId)))
          await new Promise((ok) => setTimeout(ok, 400))
        }
      } finally { tx.close() }
    }
  }
  const counts = await recount(c.id)
  const done = counts.queued === 0
  await db.update(campaigns).set({
    sent: counts.sent, failed: counts.failed, lastError: stop, updatedAt: now(),
    ...(done ? { status: 'sent', finishedAt: now() } : {}),
  }).where(and(eq(campaigns.id, c.id), eq(campaigns.status, 'sending')))
  return { ran: true, sent, ...(stop ? { error: stop } : {}) }
}

export async function campaignProgress(id: string) {
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) })
  if (!c) return null
  const counts = await recount(id)
  return { status: c.status, total: c.total, ...counts, lastError: c.lastError }
}
