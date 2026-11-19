import 'server-only'
// What the WhatsApp button needs for one lead or person: their number, whether we may message them, the
// ready-written messages, and our live homes (for "a new home that might suit you").

import { cache } from 'react'
import { and, asc, desc, eq, gte, lt, ne, or } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { appointments, type Contact, type Enquiry, type Property } from '@/db/schema'
import { COUNCIL_TAX_BANDS, FURNISHING, PROPERTY_TYPES, TENURES, labelFor } from './options'
import { descriptionUpTo, longerDescription } from './window-card'
import { isValuation } from './enquiry-labels'
import { toE164 } from './lead-rules'
import { displayAddressFor, getProperty, listPublished, priceLabel, slugFor } from './properties'
import { knownBase, listingNamedIn, listingOptions } from './property-email-data'
import { googleSummary } from './reviews-data'
import { shareFor } from './booklet-share'
import { defaultPropertyOptions, nextTwoDays, propertyMessage, waBlocked, waTemplates, type WaContext, type WaListing, type WaTemplate } from './whatsapp'

export type WaHome = { id: string; channel: 'sale' | 'let'; label: string; line: string; url: string }
export type WaProps = {
  enquiryId: string | null; contactId: string | null; e164: string | null; first: string; me: string
  templates: WaTemplate[]; homes: WaHome[]; consent: boolean; blocked: string | null
  /** Messages about one of our homes: offered for sales and lettings enquiries (not valuations). */
  property: boolean
  /** The homes staff can choose from, and the one the enquiry is about (or seems to be about). */
  listings: WaListing[]; listingId: string | null
  isLet: boolean; days: string
  /** The general first reply, for when a message isn't about a particular home. */
  general: string
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const tidy = (t: string | null | undefined) => (t ?? '').replace(/[*_#>]/g, '').replace(/\s+/g, ' ').trim()

/** One of our homes as the WhatsApp messages describe it: only what the listing itself says. */
export function toWaListing(p: Property, base: string): WaListing {
  const type = labelFor(PROPERTY_TYPES, p.propertyType).toLowerCase()
  const what = p.bedrooms === 0 || p.propertyType === 'studio' ? 'studio flat' : `${p.bedrooms ? `${p.bedrooms} bedroom ` : ''}${type && type !== 'other' ? type : 'home'}`
  const facts: WaListing['facts'] = []
  const add = (key: string, text: string | null | undefined | false, on = true) => { if (text) facts.push({ key, text, on }) }
  add('beds', p.bedrooms ? plural(p.bedrooms, 'bedroom') : null)
  add('baths', p.bathrooms ? plural(p.bathrooms, 'bathroom') : null)
  add('receptions', p.receptions ? plural(p.receptions, 'reception') : null)
  add('size', p.floorAreaSqft ? `${p.floorAreaSqft.toLocaleString('en-GB')} sq ft` : null)
  if (p.channel === 'let') {
    add('furnishing', labelFor(FURNISHING, p.furnishing) || null)
    const today = new Date().toISOString().slice(0, 10)
    add('available', p.availableFrom ? (p.availableFrom <= today ? 'Available now' : `Available from ${new Date(`${p.availableFrom.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`) : null)
    add('deposit', p.deposit ? `Deposit £${p.deposit.toLocaleString('en-GB')}` : null, false)
    add('term', p.minTenancyMonths ? `Minimum term ${plural(p.minTenancyMonths, 'month')}` : null, false)
  } else {
    const tenure = labelFor(TENURES, p.tenure)
    add('tenure', tenure && p.tenure ? `${tenure}${p.tenure === 'leasehold' && p.leaseYearsRemaining ? ` (${p.leaseYearsRemaining} years left)` : ''}` : null)
  }
  add('parking', p.parking ? cap(tidy(p.parking)) : null, false)
  add('outside', p.outsideSpace ? cap(tidy(p.outsideSpace)) : null, false)
  add('epc', p.epcCurrent ? `EPC ${p.epcCurrent}` : null, false)
  add('tax', p.councilTaxBand ? `Council tax band ${labelFor(COUNCIL_TAX_BANDS, p.councilTaxBand).replace(/^band\s*/i, '') || p.councilTaxBand}` : null, false)
  const features: string[] = []
  for (const k of p.keyFeatures ?? []) { const t = tidy(k).replace(/[.;]+$/, ''); if (t && !features.some((x) => x.toLowerCase() === t.toLowerCase())) features.push(cap(t)) }
  return {
    id: p.id, channel: p.channel === 'let' ? 'let' : 'sale', status: p.status, what, address: displayAddressFor(p), price: priceLabel(p), facts,
    short: descriptionUpTo(280, p.summary, p.description), long: longerDescription(p, 650), features: features.slice(0, 12),
    url: `${base}/properties/${slugFor(p)}?utm_source=whatsapp`, tour: p.virtualTourUrl?.trim() || null,
  }
}

/** Our live homes, worked out once per page. */
const liveHomes = cache(async () => listPublished({}).catch(() => []))

/** Our live homes as one line each, with a link that shows "WhatsApp" as the source when they enquire. */
export async function waHomes(): Promise<WaHome[]> {
  const [live, base] = await Promise.all([liveHomes(), knownBase()])
  return listingOptions(live, base).map((o) => ({
    id: o.id, channel: o.channel, label: o.label,
    line: [o.card.address, o.card.priceText, o.card.specs.slice(0, 2).join(', ')].filter(Boolean).join(', '),
    url: `${o.card.url}${o.card.url.includes('?') ? '&' : '?'}utm_source=whatsapp`,
  }))
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/London' })

/** Their next booked appointment, or failing that the last one in the past fortnight. */
async function appointmentFor(enquiryId: string | null, contactId: string | null): Promise<WaContext['appointment']> {
  const who = enquiryId && contactId ? or(eq(appointments.enquiryId, enquiryId), eq(appointments.contactId, contactId)) : enquiryId ? eq(appointments.enquiryId, enquiryId) : contactId ? eq(appointments.contactId, contactId) : null
  if (!who) return null
  const nowIso = new Date().toISOString()
  const live = and(who, ne(appointments.status, 'cancelled'))
  const [next] = await db.select().from(appointments).where(and(live, gte(appointments.startsAt, nowIso))).orderBy(asc(appointments.startsAt)).limit(1)
  const a = next ?? (await db.select().from(appointments).where(and(live, lt(appointments.startsAt, nowIso), gte(appointments.startsAt, new Date(Date.now() - 14 * 864e5).toISOString()))).orderBy(desc(appointments.startsAt)).limit(1))[0]
  if (!a) return null
  return { kind: a.kind === 'valuation' ? 'valuation' : a.kind === 'viewing' ? 'viewing' : 'other', when: when(a.startsAt), address: a.address, past: !next }
}

export async function waFor(p: { enquiry?: Enquiry | null; contact?: Contact | null; me: string; address?: string | null; isLet?: boolean; homes?: WaHome[]; allListings?: boolean }): Promise<WaProps> {
  await ready()
  const e = p.enquiry ?? null, c = p.contact ?? null
  const e164 = c?.phoneE164 ?? toE164(e?.phone ?? c?.phone)
  const name = (e?.name ?? c?.name ?? '').trim()
  const first = /^(mr|mrs|ms|miss|dr)\.?$/i.test(name.split(/\s+/)[0] ?? '') ? '' : name.split(/\s+/)[0] ?? ''
  const valuation = !!e && isValuation(e)
  const [appointment, base, google] = await Promise.all([appointmentFor(e?.id ?? null, c?.id ?? e?.contactId ?? null), knownBase(), googleSummary().catch(() => null)])
  // The home they asked about: the one the enquiry is linked to, or one its text clearly names (portal emails).
  const property = !!e && !valuation
  const live = property && (p.allListings || !e?.propertyId) ? await liveHomes() : []
  const linked = property && e?.propertyId ? await getProperty(e.propertyId).catch(() => null) : null
  const namedId = property && !linked && live.length ? listingNamedIn(`${e?.message ?? ''}\n${e?.postcode ?? ''}`, live) : null
  const target = linked ?? live.find((x) => x.id === namedId) ?? null
  const asked = target ? toWaListing(target, base) : null
  const listings = p.allListings ? live.map((x) => toWaListing(x, base)) : []
  if (asked && !listings.some((l) => l.id === asked.id)) listings.unshift(asked)
  // A portal email about one of our homes (Rightmove, Zoopla…) is a viewing request too.
  const kind: WaContext['kind'] = !e ? 'general' : valuation ? 'valuation' : asked || e.kind === 'viewing' ? 'viewing'
    : e.kind === 'buyer' ? 'buyer' : e.kind === 'tenant' ? 'tenant' : 'general'
  const isLet = asked ? asked.channel === 'let' : p.isLet ?? e?.intent === 'rent'
  // Their personal property report (valuations).
  const report = e && valuation ? await shareFor(e.id).then((t) => `${base}/report/${t}`).catch(() => null) : null
  const rating = google?.rating && google.count ? { rating: google.rating, count: google.count } : null
  const days = nextTwoDays()
  // About one of our homes, the dialog builds the first reply from the listing (price, facts, its own description, key
  // features, link); the ready-written one is the general reply, for when staff choose "no particular home".
  const templates = waTemplates({ first, me: p.me, kind: asked ? 'general' : kind, isLet, address: p.address ?? asked?.address ?? null, appointment, report, rating, days })
  const general = templates[0]?.text ?? ''
  if (asked) templates[0] = { ...templates[0], text: propertyMessage({ first, me: p.me, days }, asked, defaultPropertyOptions(asked), 'first') }
  return {
    enquiryId: e?.id ?? null, contactId: c?.id ?? e?.contactId ?? null, e164, first, me: p.me, templates,
    homes: p.homes ?? [], consent: !!c?.whatsappOptInAt, blocked: waBlocked({ e164, doNotContact: c?.doNotContact, stoppedAt: c?.whatsappStoppedAt }),
    property, listings, listingId: asked?.id ?? null, isLet, days, general,
  }
}
