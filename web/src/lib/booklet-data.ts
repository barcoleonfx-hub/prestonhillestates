import 'server-only'
import { and, desc, eq, ne } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { appointments, booklets } from '@/db/schema'
import { getAppointment, type ApptRow } from './appointments'
import { defaultLetter, greetingFor, type BookletComp, type BookletFields, type BookletInput, type BookletKind, type BookletReview } from './booklet'
import { enquiryWorkspace } from './enquiry-workspace'
import { otmAskingPrices } from './otm-check'
import { knownBase } from './property-email-data'
import { googleSummary, reviewsFor } from './reviews-data'
import { LETTINGS, feeIncVat } from './site'
import { salesNear } from './sold-prices'
import { fmtWhen } from './time'
import { figureText, homeFrom } from './valuation-check'
import { rentCheck } from './valuation-check-data'

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i
const month = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const truncated = (t: string) => /(…|\.\.\.)\s*$/.test(t)

/** Saved changes to a booklet. */
export async function savedBooklet(id: string): Promise<Partial<BookletFields>> {
  await ready()
  const r = await db.query.booklets.findFirst({ where: eq(booklets.id, id) })
  try { return r ? (JSON.parse(r.data) as Partial<BookletFields>) : {} } catch { return {} }
}

/** The valuation appointment booked for an enquiry (the next one, or else the latest). */
async function valuationFor(enquiryId: string): Promise<ApptRow | null> {
  const rows = await db.select({ id: appointments.id, startsAt: appointments.startsAt }).from(appointments)
    .where(and(eq(appointments.enquiryId, enquiryId), eq(appointments.kind, 'valuation'), ne(appointments.status, 'cancelled')))
    .orderBy(desc(appointments.startsAt)).limit(5)
  const now = new Date().toISOString()
  const next = [...rows].reverse().find((r) => r.startsAt >= now) ?? rows[0]
  return next ? getAppointment(next.id) : null
}

/** Real reviews for the reviews page: one long one to feature, then short ones. Never a review cut off mid-sentence. */
function pickReviews(list: { text: string; name: string; date?: string; rating?: number; source: string }[]): BookletReview[] {
  const ok = list.filter((r) => (r.rating ?? 0) >= 4 && r.source === 'Google review' && !truncated(r.text)).map((r) => ({ text: r.text, name: r.name, date: r.date, rating: r.rating ?? 5 }))
  const big = ok.find((r) => r.rating === 5 && r.text.length >= 80 && r.text.length <= 380)
  const small = ok.filter((r) => r !== big && r.text.length <= 170).slice(0, 3)
  return big ? [big, ...small] : small.slice(0, 3)
}

/**
 * Everything a booklet needs, for an enquiry (id = enquiry id) or a valuation booked straight into the diary
 * (id = "a-" + appointment id).
 */
export async function bookletInput(id: string, me: { name: string }): Promise<BookletInput | null> {
  await ready()
  let name = '', address: string | null = null, postcode: string | null = null, kind: BookletKind = 'sales'
  let appt: ApptRow | null = null, enquiryId: string | null = null
  let home = { type: null as 'F' | 'T' | 'S' | 'D' | null, typeLabel: null as string | null, beds: null as number | null }
  let savedComps: BookletComp[] = [], savedFigure = ''
  if (id.startsWith('a-')) {
    appt = await getAppointment(id.slice(2))
    if (!appt) return null
    if (appt.enquiryId) return bookletInput(appt.enquiryId, me)
    name = appt.contactName ?? ''
    address = appt.location || null
    const m = (appt.location ?? '').match(POSTCODE)
    postcode = m ? `${m[1]} ${m[2]}`.toUpperCase() : null
  } else {
    const w = await enquiryWorkspace(id, me)
    if (!w) return null
    enquiryId = id
    name = w.e.name
    postcode = w.ctx.postcode
    address = w.ctx.address && w.ctx.address !== postcode ? w.ctx.address : null
    kind = w.kind === 'lettings-valuation' || w.kind === 'tenant' ? 'lettings' : 'sales'
    home = homeFrom(w.e.message)
    appt = await valuationFor(id)
    if (w.saved) {
      savedFigure = figureText(w.saved.low, w.saved.high, kind === 'lettings')
      savedComps = w.saved.comps.map((c, i) => ({
        key: `v${i}:${c.price}`, group: c.kind === 'asking' ? 'market' : 'evidence', where: c.address || 'A similar home',
        what: [c.kind === 'sold' ? 'Sold' : c.kind === 'rent' ? 'Let' : 'Asking', c.beds ? `${c.beds} bed` : null].filter(Boolean).join(' · '),
        price: c.price, rent: c.kind === 'rent' || kind === 'lettings', source: c.source,
      }))
    }
  }
  const saved = await savedBooklet(id)
  const k: BookletKind = saved.kind ?? kind
  const rent = k === 'lettings'

  // The evidence: what similar homes sold (or let) for nearby, and what's on OnTheMarket now.
  const [near, rents, otm, base, google, revs] = await Promise.all([
    !rent && postcode ? salesNear(postcode, { type: home.type, limit: 10 }).catch(() => null) : Promise.resolve(null),
    rent && postcode ? rentCheck(postcode, home.beds).catch(() => null) : Promise.resolve(null),
    postcode ? otmAskingPrices(postcode, { rent, beds: home.beds }).catch(() => null) : Promise.resolve(null),
    knownBase(),
    googleSummary().catch(() => ({ rating: null, count: null, url: null })),
    reviewsFor(rent ? 'lettings' : 'sales', 20).catch(() => []),
  ])
  const comps: BookletComp[] = [...savedComps]
  for (const s of near?.recent ?? []) {
    comps.push({ key: `lr:${s.street}|${s.postcode}|${s.soldOn}|${s.price}`, group: 'evidence', where: [s.street, s.postcode].filter(Boolean).join(', '), what: `${s.typeLabel} · sold ${month(s.soldOn)}`, price: s.price, rent: false, source: 'HM Land Registry', metres: s.metres ?? null })
  }
  for (const n of rents?.nearby ?? []) {
    comps.push({ key: `let:${n.area}|${n.beds}|${n.rent}`, group: 'evidence', where: n.area, what: `${n.beds} bed · let by us · ${n.km} km away`, price: n.rent, rent: true, source: 'Our lets' })
  }
  for (const l of otm?.listings ?? []) {
    comps.push({ key: `otm:${l.address ?? ''}|${l.price}`, group: 'market', where: l.address ?? 'A similar home nearby', what: [l.beds != null ? `${l.beds} bed` : null, rent ? 'to rent now' : 'for sale now'].filter(Boolean).join(' · '), price: l.price, rent, source: 'OnTheMarket' })
  }

  const homeType = [home.beds != null ? `${home.beds}-bed` : null, home.typeLabel?.toLowerCase()].filter(Boolean).join(' ')
  const hasPc = !!(address && postcode && address.toUpperCase().replace(/\s/g, '').includes(postcode.replace(/\s/g, '')))
  const homeLine = [address, hasPc ? null : postcode].filter(Boolean).join(', ') || (homeType ? `Your ${homeType}` : 'Your home')
  const defaults: BookletFields = {
    // What we worked out it is; staff can switch it (the rest of the defaults follow what it's switched to).
    kind,
    forName: name,
    home: homeType && address ? `${homeLine} (${homeType})` : homeLine,
    visit: appt ? `${fmtWhen(appt.startsAt)} · ${appt.staffName}` : '',
    greeting: greetingFor(name),
    letter: defaultLetter(k),
    figure: savedFigure,
    asking: '',
    fee: rent ? `${LETTINGS.percent}%${LETTINGS.vat === 'plus' ? ` + VAT (${feeIncVat()}% including VAT)` : ''} of the monthly rent` : '',
    hide: [],
  }
  const where = rent ? (rents ? `homes we’ve let near ${postcode}` : null) : near ? `${near.where}${near.typed && home.typeLabel ? `, ${home.typeLabel.toLowerCase()}` : ''}` : null
  return {
    id, enquiryId, defaults, saved, comps, compsWhere: where,
    estimate: rents ? { low: rents.low, high: rents.high, rent: true, basis: `${home.beds != null ? `${home.beds}-bed homes, ` : ''}from ${rents.basis}` } : null,
    otm: otm ? { url: otm.url, error: otm.error ?? null } : null,
    reviews: pickReviews(revs), google: { rating: google.rating, count: google.count },
    prepared: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }),
    base,
  }
}
