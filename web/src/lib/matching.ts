import 'server-only'
import { and, eq, inArray, ne, or, like } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, properties, type Contact, type Property } from '@/db/schema'
import { enquiryLabel, RECENT_DAYS } from './enquiry-labels'
import { rolesOf } from './crm-options'

/**
 * Suggests past applicants for a listing: people whose earlier enquiries or stated requirements fit its
 * price, area, bedrooms and type. Everything is worked out from what we already hold; nothing is guessed.
 */

type Channel = 'sale' | 'let'
type Family = 'flat' | 'house'
type Signal = {
  price: number | null
  isBudget: boolean // contact's stated maximum, rather than the price of a home they asked about
  beds: number | null
  outward: string | null
  places: string[]
  family: Family | null
  channel: Channel | null
  date: string
  enquiryId: string | null
  propertyId: string | null
  what: string
}
type Candidate = { contact: Contact; signals: Signal[]; lastAt: string; latest: { id: string; label: string; date: string; outcome: string | null } | null }

export type Match = {
  contactId: string
  name: string
  phone: string | null
  email: string | null
  position: string | null
  score: number
  reasons: string[]
  lastAt: string
  latest: Candidate['latest']
}

// Places we cover and nearby; used to compare "Wembley" with "Wembley Park, HA9".
const PLACES = ['harrow on the hill', 'south harrow', 'north harrow', 'harrow weald', 'wembley park', 'preston road', 'rayners lane', 'northwick park',
  'harrow', 'kenton', 'wembley', 'pinner', 'stanmore', 'edgware', 'wealdstone', 'kingsbury', 'sudbury', 'alperton', 'queensbury', 'neasden', 'burnt oak',
  'colindale', 'hendon', 'greenford', 'northolt', 'ruislip', 'hatch end', 'belmont', 'canons park', 'brent']

const placesIn = (text: string | null | undefined) => {
  const t = ` ${(text ?? '').toLowerCase().replace(/[^a-z ]+/g, ' ')} `
  const found = PLACES.filter((p) => t.includes(` ${p} `))
  // "Wembley Park" also counts as Wembley, and so on.
  return [...new Set(found.flatMap((p) => [p, p.split(' ').find((w) => PLACES.includes(w)) ?? p]))]
}
const outwardIn = (text: string | null | undefined) => /\b([A-Z]{1,2}\d[A-Z\d]?)(?:\s*\d[A-Z]{2})?\b/i.exec(text ?? '')?.[1]?.toUpperCase() ?? null
const familyOf = (text: string | null | undefined): Family | null => {
  const t = (text ?? '').toLowerCase()
  if (/flat|maisonette|apartment|studio/.test(t)) return 'flat'
  if (/house|bungalow|semi|terrace|detached|cottage|town ?house/.test(t)) return 'house'
  return null
}
const money = (s: string | undefined) => (s ? Number(s.replace(/[,\s]/g, '')) || null : null)

function propSignals(p: Pick<Property, 'price' | 'bedrooms' | 'postcode' | 'town' | 'locality' | 'street' | 'displayAddress' | 'propertyType' | 'channel'>) {
  return {
    price: p.price, beds: p.bedrooms, outward: outwardIn(p.postcode) ?? outwardIn(p.displayAddress),
    places: placesIn([p.town, p.locality, p.street, p.displayAddress].filter(Boolean).join(' ')),
    family: familyOf(p.propertyType?.replace(/_/g, ' ')), channel: (p.channel === 'let' ? 'let' : 'sale') as Channel,
  }
}

/** What an enquiry tells us about what someone wants, from the listing it's linked to or from the email we imported. */
function enquirySignal(e: typeof enquiries.$inferSelect, linked: Property | undefined, roles: string[]): Signal | null {
  if (e.kind === 'valuation') return null // sellers and landlords, not applicants
  const msg = e.message ?? ''
  const listing = /^Listing:\s*(.+)$/im.exec(msg)?.[1] ?? ''
  const propertyLine = /^(?:Property|About):\s*(.+)$/im.exec(msg)?.[1] ?? ''
  const lookingFor = /^Looking for:\s*(.+)$/im.exec(msg)?.[1] ?? ''
  const t = msg.toLowerCase()
  const channel: Channel | null = linked ? (linked.channel === 'let' ? 'let' : 'sale')
    : /renter|tenant|to rent|pcm|per month|letting/.test(t) ? 'let'
      : /buyer|for sale|first-time buyer|cash buyer|mortgage/.test(t) ? 'sale'
        : roles.includes('tenant') && !roles.includes('buyer') ? 'let' : roles.includes('buyer') ? 'sale' : null
  const ps = linked ? propSignals(linked) : null
  return {
    price: ps?.price ?? money(/£\s?([\d,]+)/.exec(listing)?.[1]),
    isBudget: false,
    beds: ps?.beds ?? (Number(/(\d+)\s*bed/i.exec(`${listing} ${lookingFor}`)?.[1]) || null),
    outward: ps?.outward ?? outwardIn(propertyLine),
    places: ps?.places ?? placesIn(propertyLine),
    family: ps?.family ?? familyOf(`${listing} ${lookingFor}`),
    channel, date: e.createdAt, enquiryId: e.id, propertyId: e.propertyId,
    what: [enquiryLabel(e), linked ? linked.displayAddress ?? linked.street : propertyLine.replace(/\s*\([^)]*\)\s*$/, ''), listing.replace(/\s+–\s+/, ' · ')].filter(Boolean).join(' · '),
  }
}

/** The person's own stated requirements (call log, calculator sign-up or "Other requirements"). */
function profileSignal(c: Contact): Signal | null {
  if (!c.maxPrice && c.minBeds == null && !c.areas && !c.wantedType) return null
  const roles = rolesOf(c.roles)
  return {
    price: c.maxPrice, isBudget: true, beds: c.minBeds, outward: outwardIn(c.areas), places: placesIn(c.areas), family: familyOf(c.wantedType),
    channel: roles.includes('tenant') && !roles.includes('buyer') ? 'let' : roles.includes('buyer') && !roles.includes('tenant') ? 'sale' : null,
    date: c.updatedAt, enquiryId: null, propertyId: null, what: 'Their requirements',
  }
}

export async function loadCandidates(): Promise<Candidate[]> {
  await ready()
  const people = await db.select().from(contacts).where(and(
    eq(contacts.archived, false), eq(contacts.doNotContact, false),
    or(like(contacts.roles, '%buyer%'), like(contacts.roles, '%tenant%')),
  ))
  if (!people.length) return []
  const ids = people.map((c) => c.id)
  const enqs: (typeof enquiries.$inferSelect)[] = []
  for (let i = 0; i < ids.length; i += 400) {
    enqs.push(...await db.select().from(enquiries).where(and(inArray(enquiries.contactId, ids.slice(i, i + 400)), ne(enquiries.kind, 'valuation'))))
  }
  const propIds = [...new Set(enqs.map((e) => e.propertyId).filter(Boolean))] as string[]
  const linked = new Map((propIds.length ? await db.select().from(properties).where(inArray(properties.id, propIds)) : []).map((p) => [p.id, p]))
  const byContact = new Map<string, (typeof enquiries.$inferSelect)[]>()
  for (const e of enqs) byContact.set(e.contactId!, [...(byContact.get(e.contactId!) ?? []), e])

  return people.map((c) => {
    const mine = (byContact.get(c.id) ?? []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    const signals = [profileSignal(c), ...mine.map((e) => enquirySignal(e, e.propertyId ? linked.get(e.propertyId) : undefined, rolesOf(c.roles)))].filter(Boolean) as Signal[]
    const latest = mine[0] ? { id: mine[0].id, label: enquiryLabel(mine[0]), date: mine[0].createdAt, outcome: mine[0].outcome } : null
    const lastAt = [c.lastContactAt ?? c.createdAt, ...mine.map((e) => e.createdAt)].sort().pop()!
    return { contact: c, signals, lastAt, latest }
  }).filter((c) => c.signals.length)
}

const title = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase())

function scoreSignal(p: ReturnType<typeof propSignals> & { id: string }, s: Signal): { score: number; reasons: string[] } | null {
  if (s.propertyId === p.id) return { score: 100, reasons: ['Asked about this property'] }
  if (s.channel && s.channel !== p.channel) return null
  let score = 0
  const reasons: string[] = []
  let priceKnown = false
  let dims = 0 // how many of price, bedrooms and area fit
  let located = false
  if (p.price && s.price) {
    priceKnown = true
    if (s.isBudget) {
      const r = p.price / s.price
      if (r > 1.25) return null
      if (r <= 1) { score += 40; dims++; reasons.push('Budget fits') } else if (r <= 1.1) { score += 22; dims++; reasons.push('Just over budget') }
    } else {
      const d = Math.abs(p.price - s.price) / s.price
      if (d > 0.6) return null
      if (d <= 0.1) { score += 40; dims++; reasons.push('Similar price') } else if (d <= 0.2) { score += 28; dims++; reasons.push('Similar price') } else if (d <= 0.35) score += 12
    }
  }
  if (p.beds != null && s.beds != null) {
    if (s.isBudget) {
      if (p.beds < s.beds - 1) return null
      if (p.beds >= s.beds) { score += 20; dims++; reasons.push(`${p.beds} bed${p.beds === 1 ? '' : 's'}`) } else score += 5
    } else {
      const d = Math.abs(p.beds - s.beds)
      if (d === 0) { score += 20; dims++; reasons.push(`${p.beds} bed${p.beds === 1 ? '' : 's'}`) } else if (d === 1) score += 10
    }
  }
  const shared = p.places.find((x) => s.places.includes(x))
  if (p.outward && s.outward && p.outward === s.outward) { score += 30; dims++; located = true; reasons.push(shared ? `${title(shared)} ${p.outward}` : p.outward) }
  else if (shared) { score += 22; dims++; located = true; reasons.push(title(shared)) }
  else if (p.outward && s.outward && p.outward.replace(/\d.*/, '') === s.outward.replace(/\d.*/, '')) score += 6
  if (p.family && s.family && p.family === s.family) { score += 8; reasons.push(p.family === 'flat' ? 'Flat or maisonette' : 'House') }
  const recent = !s.isBudget && s.date >= new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()
  // Need at least two of price, bedrooms and area to fit, except a recent enquiry in the same area where we
  // don't know their price (OnTheMarket emails don't say): still worth a call.
  if (dims < 2 && !(located && recent && !priceKnown)) return null
  if (recent) { score += 10; reasons.push('Recent enquiry') }
  return { score, reasons }
}

const MIN_SCORE = 40

export function matchCandidates(prop: Property, cands: Candidate[]): { recent: Match[]; older: Match[] } {
  const ps = { ...propSignals(prop), id: prop.id }
  const recentFrom = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()
  const out: Match[] = []
  for (const c of cands) {
    // What they've told us they want rules out homes well beyond it, whatever they once enquired about.
    const stated = c.signals.find((x) => x.isBudget)
    if (stated && !c.signals.some((x) => x.propertyId === prop.id)) {
      if (stated.price && ps.price && ps.price / stated.price > 1.25) continue
      if (stated.beds != null && ps.beds != null && ps.beds < stated.beds - 1) continue
      if (stated.channel && stated.channel !== ps.channel) continue
    }
    let best: { score: number; reasons: string[] } | null = null
    for (const s of c.signals) {
      const r = scoreSignal(ps, s)
      if (r && (!best || r.score > best.score)) best = r
    }
    if (!best) continue
    let score = best.score
    const reasons = [...best.reasons]
    if (c.latest?.outcome === 'open') { score += 8; reasons.push('Open to future calls') }
    if (c.latest?.outcome === 'not_interested' && score < 100) score -= 15
    if (score < MIN_SCORE) continue
    out.push({
      contactId: c.contact.id, name: c.contact.name, phone: c.contact.phone, email: c.contact.email, position: c.contact.position,
      score: Math.min(score, 100), reasons, lastAt: c.lastAt, latest: c.latest,
    })
  }
  out.sort((a, b) => b.score - a.score || (a.lastAt < b.lastAt ? 1 : -1))
  return { recent: out.filter((m) => m.lastAt >= recentFrom).slice(0, 40), older: out.filter((m) => m.lastAt < recentFrom).slice(0, 40) }
}

export async function matchesForProperty(prop: Property) {
  return matchCandidates(prop, await loadCandidates())
}

/** Counts for the properties list, worked out in one pass. */
export async function matchCounts(props: Property[]): Promise<Record<string, { recent: number; total: number }>> {
  const cands = await loadCandidates()
  return Object.fromEntries(props.map((p) => {
    const m = matchCandidates(p, cands)
    return [p.id, { recent: m.recent.length, total: m.recent.length + m.older.length }]
  }))
}
