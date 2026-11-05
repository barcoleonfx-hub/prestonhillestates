import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { headers } from 'next/headers'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { db } from '@/db/client'
import { contacts, enquiries, properties, propertyEmails, settings, type Contact, type Property } from '@/db/schema'
import { matchesForProperty, type Match } from './matching'
import { FURNISHING, PROPERTY_TYPES, TENURES, labelFor } from './options'
import { displayAddressFor, priceLabel, slugFor, type FullProperty } from './properties'
import { interestsIn, type Asked, type EmailProperty, type EmailRecipient, type Feature, type Interest } from './property-email'

// Everything the tailored property emails need, worked out from what we already hold about the listing and each person.

/** The public address of the website, for links and photos in emails. */
export async function siteBase(): Promise<string> {
  const env = process.env.PORTAL_URL?.replace(/\/$/, '')
  if (env && !/localhost|127\.0\.0\.1/.test(env)) return env
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (host) {
    const base = `${h.get('x-forwarded-proto') ?? (/localhost|127\.0\.0\.1/.test(host) ? 'http' : 'https')}://${host}`
    // Remember it for the scheduler, which has no browser request to read the address from.
    if (!/localhost|127\.0\.0\.1/.test(host)) await rememberBase(base).catch(() => {})
    return base
  }
  return env || 'http://localhost:3000'
}

let remembered: string | null = null
async function rememberBase(base: string) {
  if (remembered === base) return
  remembered = base
  await db.insert(settings).values({ key: 'site_base', value: base, updatedAt: new Date().toISOString() }).onConflictDoUpdate({ target: settings.key, set: { value: base, updatedAt: new Date().toISOString() } })
}

/** The website's address for emails sent by the scheduler: PORTAL_URL, else the address staff last used. */
export async function knownBase(): Promise<string> {
  const env = process.env.PORTAL_URL?.replace(/\/$/, '')
  if (env && !/localhost|127\.0\.0\.1/.test(env)) return env
  const row = await db.query.settings.findFirst({ where: eq(settings.key, 'site_base') }).catch(() => null)
  return row?.value ?? env ?? 'http://localhost:3000'
}

// ---------- unsubscribe links ----------

const sign = (contactId: string) => createHmac('sha256', `phe-unsub:${process.env.AUTH_SECRET ?? 'dev-only-secret'}`).update(contactId).digest('base64url').slice(0, 22)
export const unsubscribeUrl = (base: string, contactId: string) => `${base}/unsubscribe?c=${encodeURIComponent(contactId)}&t=${sign(contactId)}`
export const oneClickUrl = (base: string, contactId: string) => `${base}/api/public/unsubscribe?c=${encodeURIComponent(contactId)}&t=${sign(contactId)}`
export function checkUnsubscribe(contactId: string, token: string): boolean {
  const a = Buffer.from(sign(contactId)), b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---------- the listing ----------

const PLACES = ['harrow on the hill', 'south harrow', 'north harrow', 'harrow weald', 'wembley park', 'preston road', 'rayners lane', 'kenton', 'wembley', 'harrow',
  'pinner', 'stanmore', 'edgware', 'wealdstone', 'kingsbury', 'sudbury', 'alperton', 'queensbury', 'neasden', 'northwick park', 'hatch end', 'belmont', 'canons park']
const placeIn = (text: string | null | undefined) => {
  const t = ` ${(text ?? '').toLowerCase().replace(/[^a-z ]+/g, ' ')} `
  const p = PLACES.find((x) => t.includes(` ${x} `))
  return p ? p.replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\bOn The\b/, 'on the') : null
}
const outwardOf = (text: string | null | undefined) => /\b([A-Z]{1,2}\d[A-Z\d]?)(?:\s*\d[A-Z]{2})?\b/i.exec(text ?? '')?.[1]?.toUpperCase() ?? null
const familyOf = (text: string | null | undefined): 'house' | 'flat' | null => {
  const t = (text ?? '').toLowerCase()
  if (/flat|maisonette|apartment|studio/.test(t)) return 'flat'
  if (/house|bungalow|semi|terrace|detached|cottage/.test(t)) return 'house'
  return null
}
const typeText = (p: Pick<Property, 'propertyType'>) => labelFor(PROPERTY_TYPES, p.propertyType).toLowerCase() || null

/** Sentences from the description that say something specific, kept short enough for an email. */
function sentences(text: string | null | undefined): string[] {
  return (text ?? '').replace(/\r/g, '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim().replace(/^[-•*]\s*/, ''))
    .filter((s) => s.length >= 25 && s.length <= 170 && !/preston hill estates is pleased|we are pleased|viewing (is )?highly recommended|call (us|the office)|contact us|book (a|your) viewing/i.test(s))
}

export function emailProperty(p: FullProperty, base: string): EmailProperty {
  const features: Feature[] = []
  const add = (text: string | null | undefined, from: Feature['from']) => {
    const t = (text ?? '').trim().replace(/\s+/g, ' ')
    if (t && !features.some((f) => f.text.toLowerCase() === t.toLowerCase())) features.push({ text: t, tags: interestsIn(t), from })
  }
  for (const k of p.keyFeatures ?? []) add(k, 'key')
  if (p.parking) add(/parking|drive|garage/i.test(p.parking) ? cap(p.parking) : `Parking: ${p.parking}`, 'fact')
  if (p.outsideSpace) add(/garden|patio|balcony|terrace/i.test(p.outsideSpace) ? cap(p.outsideSpace) : `Outside space: ${p.outsideSpace}`, 'fact')
  if (p.floorAreaSqft) add(`${p.floorAreaSqft.toLocaleString('en-GB')} sq ft of living space`, 'fact')
  if (p.tenure === 'freehold' || p.tenure === 'share_of_freehold') add(labelFor(TENURES, p.tenure), 'fact')
  if (p.epcCurrent && /^[ABC]$/i.test(p.epcCurrent)) add(`EPC rating ${p.epcCurrent.toUpperCase()}, so lower running costs`, 'fact')
  if (p.channel === 'let' && p.furnishing) add(labelFor(FURNISHING, p.furnishing), 'fact')
  for (const r of p.rooms) {
    const tags = interestsIn(`${r.name} ${r.description ?? ''}`)
    if (!tags.length) continue
    const d = (r.description ?? '').split(/(?<=[.!?])\s+/)[0]?.trim()
    add(`${r.name}${r.dimensions ? ` (${r.dimensions})` : ''}${d && d.length < 120 ? `: ${d.replace(/\.$/, '')}` : ''}`, 'room')
  }
  for (const s of [...sentences(p.summary), ...sentences(p.description)]) {
    const tags = interestsIn(s)
    if (tags.length) features.push({ text: s.replace(/\.$/, ''), tags, from: 'text' })
  }
  const photos = p.media.filter((m) => m.kind === 'photo' && m.status === 'ready').sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.position - b.position)
    .slice(0, 3).map((m) => (m.url.startsWith('/') ? `${base}${m.url}` : m.url))
  const type = typeText(p)
  const specs = [
    p.bedrooms ? `${p.bedrooms} bed` : '', p.bathrooms ? `${p.bathrooms} bath` : '', p.receptions ? `${p.receptions} reception` : '',
    type ?? '', p.channel === 'sale' && p.tenure ? labelFor(TENURES, p.tenure) : '', p.channel === 'let' && p.furnishing ? labelFor(FURNISHING, p.furnishing) : '',
  ].filter(Boolean)
  return {
    id: p.id, ref: p.ref, url: `${base}/properties/${slugFor(p)}`, channel: p.channel === 'let' ? 'let' : 'sale',
    address: displayAddressFor(p), street: p.street?.trim() || null, place: placeIn([p.locality, p.town, p.displayAddress].filter(Boolean).join(' ')) ?? (p.town || null),
    outward: outwardOf(p.postcode) ?? outwardOf(p.displayAddress), price: p.price, priceText: priceLabel(p), beds: p.bedrooms, baths: p.bathrooms, receptions: p.receptions,
    type, family: familyOf(p.propertyType?.replace(/_/g, ' ')), specs, summary: p.summary?.trim() || null,
    availableFrom: p.availableFrom ? new Date(p.availableFrom).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : null,
    photos, features, valuationUrl: `${base}/valuation`,
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ---------- the people ----------

/** "the 3 bedroom semi-detached house on Kenton Road", from a listing we hold or the lines of an imported email. */
function askedFrom(e: typeof enquiries.$inferSelect, linked: Property | undefined): Asked {
  if (linked) {
    const type = typeText(linked)
    return {
      what: `the ${linked.bedrooms ? `${linked.bedrooms} bedroom ` : ''}${type ?? 'home'} ${linked.channel === 'let' ? 'to rent ' : ''}on ${linked.street?.trim() || displayAddressFor(linked)}`,
      when: e.createdAt, price: linked.price, beds: linked.bedrooms, family: familyOf(linked.propertyType?.replace(/_/g, ' ')),
      outward: outwardOf(linked.postcode), place: placeIn([linked.locality, linked.town, linked.displayAddress].join(' ')),
    }
  }
  const msg = e.message ?? ''
  const line = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'im').exec(msg)?.[1]?.trim() ?? ''
  const listing = line('Listing'), prop = (line('Property') || line('About')).replace(/\s*\([^)]*\)\s*$/, '')
  const kind = /(\d+)\s*bed\w*\s+([a-z -]+?)(?:\s+(?:to rent|for sale))?$/i.exec(listing.split(/\s+[–-]\s+/).pop() ?? '')
  const desc = kind ? `the ${kind[1]} bed ${kind[2].trim()}${/to rent/i.test(listing) ? ' to rent' : ''}` : 'a home'
  return {
    what: prop ? `${desc} on ${prop}` : desc === 'a home' ? 'one of our homes' : desc,
    when: e.createdAt, price: Number(/£\s?([\d,]+)/.exec(listing)?.[1]?.replace(/,/g, '')) || null,
    beds: kind ? Number(kind[1]) : null, family: familyOf(listing), outward: outwardOf(prop), place: placeIn(prop),
  }
}

/** Their own words: questions in their enquiries, what they said they were looking for, our notes on them. */
function ownWords(c: Contact, mine: (typeof enquiries.$inferSelect)[]): string {
  const strip = (m: string) => m.split('\n').filter((l) => !/^(About|Listing|Property|Zoopla reference|OnTheMarket reference|Email subject|Subject|Type of enquiry|Location|Situation|Name|Email|Phone):/i.test(l)).join('\n')
  return [c.notes, c.wantedType, ...mine.map((e) => strip(e.message ?? ''))].filter(Boolean).join('\n')
}

export type Candidate = { recipient: EmailRecipient; match: Match; sentAt: string | null; reason: string | null }

/** Past applicants who fit this listing, with what we know about each, for drafting their email. */
export async function propertyEmailCandidates(p: FullProperty, base: string) {
  const all = await matchesForProperty(p)
  const asked = new Set((await db.select({ c: enquiries.contactId }).from(enquiries).where(eq(enquiries.propertyId, p.id))).map((r) => r.c))
  const matches = [...all.recent, ...all.older].filter((m) => !asked.has(m.contactId))
  const ids = matches.map((m) => m.contactId)
  if (!ids.length) return { ready: [] as Candidate[], skipped: { noEmail: 0, optedOut: 0 }, alreadyAsked: asked.size }
  const people = new Map((await db.select().from(contacts).where(inArray(contacts.id, ids))).map((c) => [c.id, c]))
  const enqs = await db.select().from(enquiries).where(and(inArray(enquiries.contactId, ids), ne(enquiries.kind, 'valuation')))
  const propIds = [...new Set(enqs.map((e) => e.propertyId).filter(Boolean))] as string[]
  const linked = new Map((propIds.length ? await db.select().from(properties).where(inArray(properties.id, propIds)) : []).map((x) => [x.id, x]))
  const sent = new Map((await db.select().from(propertyEmails).where(and(eq(propertyEmails.propertyId, p.id), eq(propertyEmails.status, 'sent')))).map((r) => [r.contactId, r.sentAt]))
  const skipped = { noEmail: 0, optedOut: 0 }
  const ready: Candidate[] = []
  for (const m of matches) {
    const c = people.get(m.contactId)
    if (!c) continue
    if (!c.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) { skipped.noEmail++; continue }
    if (c.marketingOptOut) { skipped.optedOut++; continue }
    const mine = enqs.filter((e) => e.contactId === c.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    const said = rank(interestsIn(ownWords(c, mine)))
    const likedText = mine.map((e) => (e.propertyId ? linked.get(e.propertyId) : undefined)).filter(Boolean)
      .map((x) => [...(x!.keyFeatures ?? []), x!.parking, x!.outsideSpace].filter(Boolean).join('\n')).join('\n')
    const liked = rank(interestsIn(likedText)).filter((t) => !said.includes(t))
    ready.push({
      match: m, sentAt: sent.get(c.id) ?? null, reason: m.reasons.join(' · '),
      recipient: {
        contactId: c.id, name: c.name, email: c.email.trim(), asked: mine.slice(0, 3).map((e) => askedFrom(e, e.propertyId ? linked.get(e.propertyId) : undefined)),
        budget: c.maxPrice, minBeds: c.minBeds, areas: c.areas, position: c.position, said, liked, reasons: m.reasons, unsubscribeUrl: unsubscribeUrl(base, c.id),
      },
    })
  }
  return { ready, skipped, alreadyAsked: asked.size }
}
const rank = (tags: Interest[]) => [...new Set(tags)]

export async function sentHistory(propertyId: string) {
  return db.select().from(propertyEmails).where(eq(propertyEmails.propertyId, propertyId)).orderBy(propertyEmails.sentAt)
}
