import 'server-only'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { contacts, enquiries, properties, propertyEmails, settings, tenantAlerts, type Property, type TenantAlert } from '@/db/schema'
import { upsertContact } from './contacts'
import { mailboxStatus, sendFromMailbox } from './mailbox'
import { getProperty } from './properties'
import { draftFor, firstName, interestsIn, renderEmail, type EmailRecipient, type Sender } from './property-email'
import { emailProperty, knownBase, oneClickUrl, unsubscribeUrl } from './property-email-data'
import { now, uid } from './util'

// Tenants register what they're looking for; when a home to rent that fits goes live, they're emailed about it
// automatically (each home once, a few emails a run). Unsubscribing, or "do not contact", stops it.

/** Places tenants can choose, and the postcode districts each one covers. */
export const TENANT_AREAS: Record<string, string[]> = {
  Harrow: ['HA1', 'HA2', 'HA3'], Kenton: ['HA3'], 'Preston Road': ['HA3', 'HA9'], Wembley: ['HA0', 'HA9'], Sudbury: ['HA0'],
  Kingsbury: ['NW9'], Queensbury: ['HA8', 'NW9'], Wealdstone: ['HA3'], Pinner: ['HA5'], Stanmore: ['HA7'], Edgware: ['HA8'],
}

export const pcm = (p: Pick<Property, 'price' | 'rentFrequency'>) => (p.price == null ? null : Math.round(p.rentFrequency === 'pw' ? (p.price * 52) / 12 : p.rentFrequency === 'pa' ? p.price / 12 : p.price))
const listOf = (s: string | null) => { try { const v = JSON.parse(s ?? '[]'); return Array.isArray(v) ? v.map(String) : [] } catch { return [] } }
const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`

export type TenantInput = {
  name: string; email: string; phone: string; maxRent: number | null; minBeds: number | null; areas: string[]
  moveBy: string; pets: boolean; furnishing: string; notes: string
}

/** Saves the tenant (contact, an enquiry for the branch to follow up, and their alert). */
export async function registerTenant(t: TenantInput): Promise<string> {
  await ready()
  const contactId = await upsertContact({ name: t.name, phone: t.phone || null, email: t.email, role: 'tenant', source: 'Our website' })
  const areas = t.areas.filter((a) => a in TENANT_AREAS)
  await db.update(contacts).set({ maxPrice: t.maxRent, minBeds: t.minBeds, areas: areas.join(', ') || null, marketingOptOut: false, updatedAt: now() }).where(eq(contacts.id, contactId))
  const v = { maxRent: t.maxRent, minBeds: t.minBeds, areas: JSON.stringify(areas), moveBy: t.moveBy || null, pets: t.pets, furnishing: t.furnishing || null, notes: t.notes || null, active: true, updatedAt: now() }
  await db.insert(tenantAlerts).values({ contactId, ...v, createdAt: now() }).onConflictDoUpdate({ target: tenantAlerts.contactId, set: v })
  const summary = [
    t.maxRent ? `Up to ${gbp(t.maxRent)} pcm` : 'Any rent', t.minBeds != null ? (t.minBeds === 0 ? 'studio or larger' : `${t.minBeds}+ bedrooms`) : '',
    areas.length ? areas.join(', ') : 'any area', t.moveBy ? `moving ${t.moveBy.toLowerCase()}` : '', t.pets ? 'has a pet' : '', t.furnishing ? t.furnishing.replace('_', ' ') : '',
  ].filter(Boolean).join(' · ')
  await db.insert(enquiries).values({
    id: uid(), propertyId: null, kind: 'tenant', intent: 'rent', contactId, name: t.name, phone: t.phone || null, email: t.email,
    message: [`Registered for homes to rent: ${summary}`, t.notes].filter(Boolean).join('\n'), createdAt: now(),
  })
  return contactId
}

/** Does this home to rent fit what the tenant asked for? */
export function fits(a: Pick<TenantAlert, 'maxRent' | 'minBeds' | 'areas' | 'furnishing'>, p: Property): boolean {
  const rent = pcm(p)
  if (a.maxRent && (rent == null || rent > a.maxRent)) return false
  if (a.minBeds != null && (p.bedrooms == null || p.bedrooms < a.minBeds)) return false
  if (a.furnishing && p.furnishing && p.furnishing !== 'flexible' && a.furnishing !== p.furnishing) return false
  const areas = listOf(a.areas)
  if (areas.length) {
    const text = [p.town, p.locality, p.displayAddress, p.street].filter(Boolean).join(' ').toLowerCase()
    const outward = (p.postcode ?? '').toUpperCase().trim().split(/\s+/)[0]
    if (!areas.some((x) => text.includes(x.toLowerCase()) || (outward && TENANT_AREAS[x]?.includes(outward)))) return false
  }
  return true
}

export const alertsOn = async () => (await db.query.settings.findFirst({ where: eq(settings.key, 'tenant_alerts') }))?.value !== 'off'

async function claim() {
  const t = new Date().toISOString(), before = new Date(Date.now() - 10 * 60_000).toISOString()
  const r = await getClient().execute({ sql: `INSERT INTO jobs (name, last_run_at) VALUES ('tenant_alerts', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`, args: [t, before] })
  return r.rowsAffected === 1
}

/**
 * Emails registered tenants about homes to rent that went live in the last 30 days and fit what they asked for.
 * Each home once per tenant, at most 2 per tenant and 15 in all per run (every 10 minutes).
 */
export async function runTenantAlerts(): Promise<{ ran: boolean; sent?: number; error?: string }> {
  await ready()
  if (!(await alertsOn()) || !(await claim())) return { ran: false }
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const lets = (await db.select().from(properties).where(and(eq(properties.channel, 'let'), eq(properties.published, true), eq(properties.status, 'available'), isNotNull(properties.price))))
    .filter((p) => (p.publishedAt ?? p.updatedAt) >= since)
  if (!lets.length) return { ran: false }
  const people = await db.select({ a: tenantAlerts, c: contacts }).from(tenantAlerts).innerJoin(contacts, eq(contacts.id, tenantAlerts.contactId))
    .where(and(eq(tenantAlerts.active, true), eq(contacts.archived, false), eq(contacts.marketingOptOut, false), eq(contacts.doNotContact, false)))
  const ok = people.filter(({ c }) => c.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))
  if (!ok.length) return { ran: false }
  const ids = ok.map(({ c }) => c.id), letIds = lets.map((p) => p.id)
  const done = new Set((await db.select({ p: propertyEmails.propertyId, c: propertyEmails.contactId }).from(propertyEmails).where(and(inArray(propertyEmails.propertyId, letIds), inArray(propertyEmails.contactId, ids)))).map((r) => `${r.p}|${r.c}`))
  for (const e of await db.select({ p: enquiries.propertyId, c: enquiries.contactId }).from(enquiries).where(and(inArray(enquiries.propertyId, letIds), inArray(enquiries.contactId, ids)))) done.add(`${e.p}|${e.c}`)
  const plan: { a: TenantAlert; c: typeof contacts.$inferSelect; p: Property }[] = []
  for (const { a, c } of ok.sort((x, y) => (x.a.lastSentAt ?? '').localeCompare(y.a.lastSentAt ?? ''))) {
    for (const p of lets.filter((p) => !done.has(`${p.id}|${c.id}`) && fits(a, p)).slice(0, 2)) plan.push({ a, c, p })
    if (plan.length >= 15) break
  }
  if (!plan.length) return { ran: false }
  const box = await mailboxStatus()
  if (!box?.hasPassword) return { ran: true, sent: 0, error: 'Mailbox not connected' }
  const base = await knownBase()
  const sender: Sender = { name: 'The lettings team', phone: '020 8127 7001', email: box.user }
  const full = new Map<string, Awaited<ReturnType<typeof getProperty>>>()
  let sent = 0
  for (const { a, c, p } of plan.slice(0, 15)) {
    if (!full.has(p.id)) full.set(p.id, await getProperty(p.id))
    const fp = full.get(p.id)
    if (!fp) continue
    const prop = emailProperty(fp, base)
    const areas = listOf(a.areas)
    const r: EmailRecipient = {
      contactId: c.id, name: c.name, email: c.email!.trim(), asked: [], budget: a.maxRent, minBeds: a.minBeds, areas: areas.join(', ') || null, position: null,
      said: [...new Set(interestsIn([a.notes, a.pets ? 'pets allowed' : ''].filter(Boolean).join('\n')))], liked: [],
      reasons: ['Matches the homes you registered for'], unsubscribeUrl: unsubscribeUrl(base, c.id),
    }
    const d = draftFor(prop, r, sender)
    const where = [prop.street, prop.place].filter(Boolean).join(', ') || prop.address
    const message = [
      `Hello ${firstName(c.name)},`,
      `You registered with us for homes to rent${areas.length ? ` in ${areas.join(', ')}` : ''}${a.maxRent ? ` up to ${gbp(a.maxRent)} a month` : ''}. A ${prop.beds ? `${prop.beds} bedroom ` : ''}${prop.type ?? 'home'} on ${where} has just come on at ${prop.priceText.toLowerCase().startsWith('£') ? prop.priceText : prop.priceText.charAt(0).toLowerCase() + prop.priceText.slice(1)}${prop.availableFrom ? `, available from ${prop.availableFrom}` : ''}.`,
      'Good homes to rent here tend to go quickly. If you’d like to see it, reply to this email or call us on 020 8127 7001 and we’ll book you in.',
    ].join('\n\n')
    const subject = `New to rent in ${prop.place ?? prop.outward ?? 'your area'}: ${prop.beds ? `${prop.beds} bed ` : ''}${prop.type ?? 'home'}, ${prop.priceText}`.slice(0, 90)
    const { html, text } = renderEmail(prop, r, { ...d, subject, message }, sender)
    const res = await sendFromMailbox({
      to: [r.email], subject, text, html, by: null,
      headers: { 'List-Unsubscribe': `<${oneClickUrl(base, c.id)}>, <mailto:${box.user}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    })
    await db.insert(propertyEmails).values({ id: uid(), propertyId: p.id, contactId: c.id, email: r.email, subject, status: res.ok ? 'sent' : 'failed', error: res.ok ? null : res.error, sentBy: 'tenant_alert', sentAt: now() })
    if (res.ok) { sent++; await db.update(tenantAlerts).set({ lastSentAt: now() }).where(eq(tenantAlerts.contactId, c.id)) }
    else if (/password|reach the outgoing/i.test(res.error)) return { ran: true, sent, error: res.error }
    await new Promise((ok) => setTimeout(ok, 700))
  }
  return { ran: true, sent }
}

/** The waiting list for the portal: everyone registered, newest first, with what they want and what they've been sent. */
export async function tenantList() {
  await ready()
  const rows = await db.select({ a: tenantAlerts, c: contacts }).from(tenantAlerts).innerJoin(contacts, eq(contacts.id, tenantAlerts.contactId)).orderBy(desc(tenantAlerts.createdAt))
  const sentRows = rows.length ? await db.select({ c: propertyEmails.contactId }).from(propertyEmails).where(and(eq(propertyEmails.sentBy, 'tenant_alert'), eq(propertyEmails.status, 'sent'), inArray(propertyEmails.contactId, rows.map((r) => r.c.id)))) : []
  const sentBy = new Map<string, number>()
  for (const s of sentRows) if (s.c) sentBy.set(s.c, (sentBy.get(s.c) ?? 0) + 1)
  return rows.map(({ a, c }) => ({ ...a, areasList: listOf(a.areas), name: c.name, email: c.email, phone: c.phone, optedOut: c.marketingOptOut || c.doNotContact, sent: sentBy.get(c.id) ?? 0 }))
}
