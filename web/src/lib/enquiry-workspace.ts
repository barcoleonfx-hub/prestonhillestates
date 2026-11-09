import 'server-only'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries } from '@/db/schema'
import { isValuation, sortEnquiry, type SideResult } from './enquiry-labels'
import type { EnquiryEmailContext, EnquiryEmailKind } from './enquiry-email'
import { mailboxStatus } from './mailbox'
import { getProperty, type FullProperty } from './properties'
import { emailProperty, knownBase } from './property-email-data'
import { googleSummary, reviewsFor } from './reviews-data'
import type { Review } from './reviews'
import { salesNear } from './sold-prices'
import { figureText, homeFrom, parseSaved } from './valuation-check'

const PHONE = '020 8904 9005'
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i
const gbp = (n: number) => `£${n.toLocaleString('en-GB')}`

/** Which set of emails fits: a sales or rental valuation, a buyer or a tenant. Unsorted ones default to sales. */
export const emailKindFor = (side: SideResult['side'], valuation: boolean): EnquiryEmailKind =>
  side === 'lettings' ? (valuation ? 'lettings-valuation' : 'tenant') : valuation ? 'sales-valuation' : 'buyer'

/** "Label: value" lines of an enquiry's message, and anything else as plain lines. */
export function detailLines(message: string | null): { label: string | null; value: string }[] {
  return (message ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
    // Form boilerplate says nothing about what they want.
    .filter((l) => !/^(you have a new form submission:?|new submission from contact form|subject:\s*new submission from contact form)$/i.test(l))
    .map((l) => {
      const m = /^([A-Z][A-Za-z ’'()/-]{1,32}):\s*(.+)$/.exec(l)
      return m ? { label: m[1], value: m[2] } : { label: null, value: l }
    })
    // Name, email and phone are shown at the top already.
    .filter((l) => !l.label || !/^(name|full name|your name|e-?mail|email address|your email|phone|telephone|tel|mobile|phone number|contact number)$/i.test(l.label))
}

/** The first real 5-star Google review that reads well in an email: not too short to say anything, not too long. */
function quote(list: Review[]) {
  const ok = list.filter((r) => r.source === 'Google review' && (r.rating ?? 0) >= 5 && r.text.length >= 80)
  // Reviews copied from a screenshot can be cut off ("…more"): an unfinished sentence reads badly in an email.
  ok.sort((a, b) => Number(/(…|\.\.\.)\s*$/.test(a.text)) - Number(/(…|\.\.\.)\s*$/.test(b.text)))
  const r = ok.find((x) => x.text.length <= 420) ?? ok[0]
  if (!r) return null
  const text = r.text.length > 420 ? `${r.text.slice(0, r.text.lastIndexOf(' ', 400))}…` : r.text
  return { text, name: r.name, date: r.date }
}

/** Everything the enquiry page needs: the enquiry, its property, how it was sorted, and the email context. */
export async function enquiryWorkspace(id: string, me: { name: string }) {
  await ready()
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, id) })
  if (!e) return null
  const [p, contact, box, base, google, salesReviews, lettingsReviews] = await Promise.all([
    e.propertyId ? getProperty(e.propertyId) : Promise.resolve(null as FullProperty | null),
    e.contactId ? db.query.contacts.findFirst({ where: eq(contacts.id, e.contactId) }) : Promise.resolve(undefined),
    mailboxStatus().catch(() => null),
    knownBase(),
    googleSummary().catch(() => ({ rating: null, count: null, url: null })),
    reviewsFor('sales', 12).catch(() => [] as Review[]),
    reviewsFor('lettings', 12).catch(() => [] as Review[]),
  ])
  const sorted = sortEnquiry(e, p?.channel, contact?.roles)
  const valuation = isValuation(e)
  const lines = detailLines(e.message)
  const field = (re: RegExp) => lines.find((l) => l.label && re.test(l.label))?.value ?? null
  // Their home (valuations) or the listing they asked about.
  const named = field(/^(address|property)$/i) ?? (() => { const a = field(/^about$/i); return a && !/^£/.test(a) ? a : null })()
  const address = (p ? null : named?.replace(/,?\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\s*$/i, '').trim()) || null
  const pcMatch = (e.postcode ?? named ?? '').match(POSTCODE)
  const postcode = pcMatch ? `${pcMatch[1]} ${pcMatch[2]}`.toUpperCase() : null
  const kind = emailKindFor(sorted.side, valuation)
  const ep = p ? emailProperty(p, base) : null
  const home = homeFrom(e.message)
  const near = postcode && valuation && sorted.side !== 'lettings' ? await salesNear(postcode, { limit: 4, type: home.type }).catch(() => null) : null
  const ctx: EnquiryEmailContext = {
    kind, name: e.name, address: address ?? (ep ? null : postcode), postcode,
    property: ep ? { url: ep.url, address: ep.address, priceText: ep.priceText, photo: ep.photos[0] ?? null, specs: ep.specs.slice(0, 3) } : null,
    sold: (near?.recent ?? []).slice(0, 4).map((s) => ({
      where: [s.street, s.postcode].filter(Boolean).join(', '), type: s.typeLabel, price: gbp(s.price),
      when: new Date(`${s.soldOn}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    })),
    base, sender: { name: me.name, phone: PHONE, email: box?.user ?? 'info@prestonhillestates.com' },
    // A real five-star Google review (short enough to read in an email), with the honest overall rating.
    brand: { rating: google.rating, count: google.count, reviewsUrl: google.url, sales: quote(salesReviews), lettings: quote(lettingsReviews) },
  }
  // What staff settled on in the valuation check, for the "Your valuation" email.
  const saved = parseSaved(e.valuation)
  const rent = kind === 'lettings-valuation'
  if (saved) {
    ctx.figure = figureText(saved.low, saved.high, rent) || undefined
    ctx.evidence = saved.comps.slice(0, 4).map((c) => ({
      where: c.address || 'A similar home', price: `£${c.price.toLocaleString('en-GB')}${c.kind === 'rent' || rent ? ' pcm' : ''}`,
      what: `${c.kind === 'sold' ? 'Sold' : c.kind === 'rent' ? 'Let' : rent ? 'Asking rent' : 'Asking price'}${c.beds ? ` · ${c.beds} bed` : ''}`,
    }))
  }
  return { e, p, contact: contact ?? null, sorted, valuation, kind, ctx, lines, saved, mailboxReady: !!box?.hasPassword }
}
