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
import { placesNear } from './area-facts'
import { osgbToLatLon } from './geo'
import { demandNear, epcConfigured, epcHistory, ourHomesNear, parseHomeAddress, saleHistory, streetRecord } from './home-history'
import { cached } from './lookup-cache'
import { positionOf } from './postcode-geo'
import { geocodeHome, mapboxToken, walkingTimes } from './mapbox'
import type { BookletArea, BookletStory } from './booklet'
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

/** The council for a postcode (postcodes.io, kept for a year), and where to search its planning applications. */
const PLANNING: Record<string, string> = {
  harrow: 'https://www.harrow.gov.uk/planning-developments',
  brent: 'https://pa.brent.gov.uk/online-applications/',
}
async function councilOf(postcode: string): Promise<{ name: string; planningUrl: string | null } | null> {
  const r = await cached<string>(`council:${postcode}`, 365, async () => {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}?filter=admin_district`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(`postcodes.io answered ${res.status}`)
    return ((await res.json()) as { result?: { admin_district?: string } }).result?.admin_district ?? null
  })
  const fallback: Record<string, string> = { HA0: 'Brent', HA9: 'Brent', NW10: 'Brent', HA1: 'Harrow', HA2: 'Harrow', HA5: 'Harrow' }
  const name = r.data ?? fallback[postcode.split(' ')[0]] ?? null
  return name ? { name, planningUrl: PLANNING[name.toLowerCase()] ?? null } : null
}

const TYPE_WORD: Record<string, string> = { F: 'Flat or maisonette', T: 'Terraced house', S: 'Semi-detached house', D: 'Detached house' }

/** Where the home is, what's around it, and its own story. Every part is optional: what can't be found is left out. */
async function areaAndStory(postcode: string | null, address: string | null, rent: boolean, home: { type: string | null; typeLabel: string | null; beds: number | null }): Promise<{ area: BookletArea; story: BookletStory }> {
  const empty: BookletStory = { sales: [], epcs: [], epcKey: epcConfigured(), street: null, demand: null, ours: [], council: null, facts: [], errors: [] }
  if (!postcode) return { area: { home: null, postcode: null, approx: true, walked: false, mapToken: mapboxToken(), places: [], source: 'none', error: 'no postcode', pending: false }, story: empty }
  const pos = await positionOf(postcode).catch(() => null)
  const pcAt = pos ? osgbToLatLon(pos.e, pos.n) : null
  // The house itself, if Mapbox finds its exact address in this postcode; otherwise the postcode's centre.
  const exact = address ? await geocodeHome(address, postcode).catch(() => null) : null
  const at = exact ?? pcAt
  const addr = parseHomeAddress(address)
  const [places, sales, epcs, street, demand, ours, council] = await Promise.all([
    at ? placesNear(postcode, at).catch((e) => ({ places: [], source: 'none', error: String(e), pending: false })) : Promise.resolve({ places: [], source: 'none', error: 'postcode not found on the map', pending: false }),
    addr ? saleHistory(postcode, addr).catch((e) => ({ sales: [], error: String(e) })) : Promise.resolve({ sales: [], error: 'no house number in the address' }),
    addr ? epcHistory(postcode, addr).catch((e) => ({ certs: [], error: String(e) })) : Promise.resolve({ certs: [], error: epcConfigured() ? 'no house number in the address' : 'no EPC key set' }),
    streetRecord(postcode, addr?.street ?? null).catch(() => null),
    demandNear(postcode, rent).catch(() => null),
    at ? ourHomesNear(at, rent).catch(() => []) : Promise.resolve([]),
    councilOf(postcode).catch(() => null),
  ])
  // Real walking times along streets (Mapbox), in place of the estimates from straight-line distance.
  let walked = false
  if (at && places.places.length) {
    const times = await walkingTimes(at, places.places).catch(() => null)
    if (times) {
      places.places = places.places.map((p, i) => (times[i] && times[i].minutes > 0 ? { ...p, minutes: times[i].minutes, metres: times[i].metres > 0 ? times[i].metres : p.metres } : p))
      walked = times.some((x) => x.minutes > 0)
    }
  }
  const latestEpc = epcs.certs[epcs.certs.length - 1]
  const tenure = [...sales.sales].reverse().find((s) => s.tenure)?.tenure ?? null
  const facts = [
    { label: 'Type', value: home.typeLabel ?? (home.type ? TYPE_WORD[home.type] ?? '' : latestEpc?.propertyType ?? '') },
    { label: 'Bedrooms', value: home.beds != null ? String(home.beds) : '' },
    { label: 'Tenure', value: tenure ?? '' },
    { label: 'Floor area', value: latestEpc?.floorArea ? `${Math.round(latestEpc.floorArea * 10.764).toLocaleString('en-GB')} sq ft` : '' },
    { label: 'Energy rating', value: latestEpc?.rating ? `${latestEpc.rating}${latestEpc.potential && latestEpc.potential !== latestEpc.rating ? `, could be ${latestEpc.potential}` : ''}` : '' },
    { label: 'Council', value: council?.name ?? '' },
  ].filter((f) => f.value)
  return {
    area: { home: at, postcode, approx: !exact, walked, mapToken: mapboxToken(), places: places.places, source: places.source, error: places.error, pending: places.pending },
    story: {
      sales: sales.sales, epcs: epcs.certs, epcKey: epcConfigured(),
      street: street && addr?.street ? { name: addr.street.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()), ...street } : null,
      demand: demand ? { ...demand, outward: postcode.split(' ')[0] } : null,
      ours, council, facts,
      errors: [sales.error && `Sale history: ${sales.error}`, epcs.error && `Energy certificates: ${epcs.error}`, places.error && `Places nearby: ${places.error}`].filter((x): x is string => !!x),
    },
  }
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
  // The home staff typed on the booklet wins: if it has a postcode, the map, places, sales and story are for that
  // address. (The defaults still come from the enquiry, so a saved change is never mistaken for the default.)
  let lookPc = postcode, lookAddr = address
  const typedPc = saved.home?.match(POSTCODE)
  if (saved.home && typedPc) {
    lookPc = `${typedPc[1]} ${typedPc[2]}`.toUpperCase()
    lookAddr = saved.home.replace(/\([^)]*\)/g, '').replace(POSTCODE, '').replace(/[\s,]+$/, '').trim() || null
  }

  // The evidence: what similar homes sold (or let) for nearby, and what's on OnTheMarket now.
  const [near, rents, otm, base, google, revs] = await Promise.all([
    !rent && lookPc ? salesNear(lookPc, { type: home.type, limit: 10 }).catch(() => null) : Promise.resolve(null),
    rent && lookPc ? rentCheck(lookPc, home.beds).catch(() => null) : Promise.resolve(null),
    lookPc ? otmAskingPrices(lookPc, { rent, beds: home.beds }).catch(() => null) : Promise.resolve(null),
    knownBase(),
    googleSummary().catch(() => ({ rating: null, count: null, url: null })),
    reviewsFor(rent ? 'lettings' : 'sales', 20).catch(() => []),
  ])
  const { area, story } = await areaAndStory(lookPc, lookAddr, rent, home)
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
    story: '',
    showPaid: true,
  }
  const where = rent ? (rents ? `homes we’ve let near ${lookPc}` : null) : near ? `${near.where}${near.typed && home.typeLabel ? `, ${home.typeLabel.toLowerCase()}` : ''}` : null
  return {
    id, enquiryId, defaults, saved, comps, compsWhere: where,
    estimate: rents ? { low: rents.low, high: rents.high, rent: true, basis: `${home.beds != null ? `${home.beds}-bed homes, ` : ''}from ${rents.basis}` } : null,
    otm: otm ? { url: otm.url, error: otm.error ?? null } : null,
    area, story,
    reviews: pickReviews(revs), google: { rating: google.rating, count: google.count },
    prepared: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }),
    base,
  }
}
