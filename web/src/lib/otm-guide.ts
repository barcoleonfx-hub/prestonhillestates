// Reads OnTheMarket's "Market Appraisal Guide" (made by Sprift): the PDF staff download from OnTheMarket for a
// home they're valuing. It has the home's official facts (floor area, title, council tax, EPC, flood risk,
// broadband), every sale on the street since 1995 and how prices in the district have moved over ten years.
// Pure: it works on the PDF's text and where each piece sits on the page (see otm-guide-pdf for the reading).

import type { LrType } from './sold-prices'

/** One piece of text on a page: page number (from 1), left and top in points, the text. */
export type GuideItem = { p: number; x: number; y: number; s: string }

export type GuideSale = { date: string; price: number }
export type GuideStreetHome = { address: string; type: string; sales: GuideSale[] }

export type OtmGuide = {
  /** The day the guide was made (yyyy-mm-dd). */
  made: string | null
  address: string | null
  postcode: string | null
  uprn: string | null
  sqft: number | null
  sqm: number | null
  plotAcres: number | null
  councilBand: string | null
  councilTax: number | null
  title: string | null
  tenure: string | null
  authority: string | null
  flood: string | null
  conservation: boolean | null
  planning: string[]
  /** As the guide words it, e.g. "Terraced House". */
  type: string | null
  beds: number | null
  baths: number | null
  outside: string | null
  parking: string | null
  broadband: { basic: number | null; superfast: number | null; ultrafast: number | null }
  epc: { address: string | null; validUntil: string | null; current: { score: number; band: string } | null; potential: { score: number; band: string } | null } | null
  street: GuideStreetHome[]
  /** Ten-year change in average prices in the district, in per cent. */
  growth: { flat: number | null; terraced: number | null; semi: number | null; detached: number | null }
}

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const num = (s: string | null | undefined) => {
  if (!s) return null
  const m = /-?\d[\d,]*(\.\d+)?/.exec(s)
  return m ? Number(m[0].replace(/,/g, '')) : null
}
const blank = (s: string | null | undefined) => (s && s.trim() && s.trim() !== '-' ? s.trim() : null)
const dmy = (s: string): string | null => {
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s.trim())
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Whether these look like the pages of a Market Appraisal Guide at all. */
export function isGuide(items: GuideItem[]): boolean {
  const all = squash(items.map((i) => i.s).join(' '))
  return all.includes('marketappraisalguide') || (all.includes('sprift') && all.includes('propertykeyfacts'))
}

/** The text just to the right of a label on the same line (within the label's column). */
function valueOf(items: GuideItem[], label: RegExp, opts: { page?: number; width?: number } = {}): string | null {
  const l = items.find((i) => (opts.page == null || i.p === opts.page) && label.test(i.s.trim()))
  if (!l) return null
  const w = opts.width ?? 170
  const parts = items.filter((i) => i.p === l.p && i !== l && i.x > l.x + 8 && i.x < l.x + w && Math.abs(i.y - l.y) <= 3)
    .sort((a, b) => a.x - b.x)
  const v = parts.map((i) => i.s.trim()).filter(Boolean).join(' ')
  return v || null
}

/** Every item on a line under a heading in the same column, until the footer. */
function under(items: GuideItem[], heading: string, width = 170): string[] {
  const h = items.find((i) => squash(i.s) === squash(heading))
  if (!h) return []
  return items.filter((i) => i.p === h.p && i.y > h.y + 4 && i.y < h.y + 140 && i.x >= h.x - 4 && i.x < h.x + width && i.s.trim())
    .sort((a, b) => a.y - b.y || a.x - b.x).map((i) => i.s.trim())
}

function madeOn(items: GuideItem[]): string | null {
  // "23" "rd" "November 2026" at the top of the first page.
  const first = items.filter((i) => i.p === 1 && i.y < 120).sort((a, b) => a.x - b.x)
  const text = first.map((i) => i.s.trim()).join(' ').replace(/\s+/g, ' ')
  const m = /(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/.exec(text)
  if (!m) return null
  const mo = MONTHS.indexOf(m[2].toLowerCase())
  return mo < 0 ? null : `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

function epcOf(items: GuideItem[]): OtmGuide['epc'] {
  const page = items.find((i) => /^Valid until/i.test(i.s.trim()))?.p ?? items.find((i) => i.s.trim() === 'Potential')?.p
  if (page == null) return null
  const on = items.filter((i) => i.p === page)
  const valid = on.find((i) => /^Valid until/i.test(i.s.trim()))
  const validUntil = valid ? dmy(valid.s.replace(/^Valid until\s*/i, '')) : null
  const cur = on.find((i) => i.s.trim() === 'Current'), pot = on.find((i) => i.s.trim() === 'Potential')
  const scores = on.filter((i) => /^\d{1,3}\s*\|?$/.test(i.s.trim()) && cur && pot && i.y > Math.max(cur.y, pot.y) + 4)
    .map((i) => {
      const band = on.find((b) => b !== i && /^[A-G]$/.test(b.s.trim()) && Math.abs(b.y - i.y) <= 3 && b.x > i.x && b.x < i.x + 30)
      return { i, score: Number(i.s.replace(/\D/g, '')), band: band?.s.trim() ?? null }
    })
    .filter((x) => x.band && x.score >= 1 && x.score <= 120)
  const nearest = (col?: GuideItem) => (col ? [...scores].sort((a, b) => Math.abs(a.i.x - col.x) - Math.abs(b.i.x - col.x))[0] : undefined)
  const c = nearest(cur), p = nearest(pot)
  const address = on.find((i) => POSTCODE.test(i.s) && i.s === i.s.toUpperCase() && i.s.length < 120)?.s.trim() ?? null
  const current = c ? { score: c.score, band: c.band! } : null
  const potential = p && p !== c ? { score: p.score, band: p.band! } : null
  if (!current && !potential && !validUntil) return null
  return { address, validUntil, current, potential }
}

const STREET_HEAD = /^(.+?,\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s+-\s+(.+)$/i

function streetSales(items: GuideItem[]): GuideStreetHome[] {
  const heads = items.filter((i) => STREET_HEAD.test(i.s.trim()))
  const homes = heads.map((h) => {
    const m = STREET_HEAD.exec(h.s.trim())!
    return { h, address: m[1].replace(/\s+/g, ' '), type: m[2].trim(), sales: [] as GuideSale[] }
  })
  const dates = items.filter((i) => /^\d{2}\/\d{2}\/\d{4}$/.test(i.s.trim()))
  for (const d of dates) {
    const date = dmy(d.s)
    const priceItem = items.find((i) => i.p === d.p && Math.abs(i.y - d.y) <= 3 && i.x > d.x && i.x < d.x + 200 && /^£[\d,]+$/.test(i.s.trim()))
    if (!date || !priceItem) continue
    // The heading above it in the same column.
    const home = homes.filter((x) => x.h.p === d.p && Math.abs(x.h.x - d.x) < 40 && x.h.y < d.y).sort((a, b) => b.h.y - a.h.y)[0]
    if (home) home.sales.push({ date, price: num(priceItem.s)! })
  }
  return homes.map(({ address, type, sales }) => ({ address, type, sales: sales.sort((a, b) => (a.date < b.date ? 1 : -1)) }))
}

function growthOf(items: GuideItem[]): OtmGuide['growth'] {
  const pct = (label: string) => {
    const l = items.find((i) => i.s.trim().toUpperCase() === label)
    if (!l) return null
    const v = items.find((i) => i.p === l.p && Math.abs(i.x - l.x) <= 6 && i.y > l.y && i.y < l.y + 24 && /^[+\-−]?\s*\d+(\.\d+)?\s*%$/.test(i.s.trim()))
    if (!v) return null
    const n = Number(v.s.replace(/[^\d.]/g, ''))
    return /^[\-−]/.test(v.s.trim()) ? -n : n
  }
  return { flat: pct('FLAT'), terraced: pct('TERRACED'), semi: pct('SEMI-DETACHED'), detached: pct('DETACHED') }
}

export function parseGuide(items: GuideItem[]): OtmGuide {
  const v = (re: RegExp, width?: number) => valueOf(items, re, { width })
  // "936 ft" "2" "87 m" "2": the area in square feet is on the label's line, square metres just below.
  const areaLabel = items.find((i) => /^Floor Area:?$/i.test(i.s.trim()))
  const near = areaLabel ? items.filter((i) => i.p === areaLabel.p && i.x > areaLabel.x + 8 && i.x < areaLabel.x + 170 && i.y >= areaLabel.y - 4 && i.y <= areaLabel.y + 18) : []
  const ft = near.find((i) => /ft/i.test(i.s)), m2 = near.find((i) => /\bm$|m²|sq\s*m/i.test(i.s.trim()))
  const titleLabel = items.find((i) => /^Land Registry$/i.test(i.s.trim()))
  const title = v(/^Title Number:?$/i) ?? (titleLabel ? valueOf(items, /^Land Registry$/i) : null)
  const first = items.filter((i) => i.p === 1)
  const address = first.find((i) => POSTCODE.test(i.s) && i.s.includes(','))?.s.trim().replace(/\s+/g, ' ') ?? null
  const pc = address ? POSTCODE.exec(address) : null
  const planning = under(items, 'PLANNING HISTORY').filter((s) => !/^no planning records/i.test(s))
  const conservation = v(/^Conservation Area:?$/i)
  return {
    made: madeOn(items),
    address,
    postcode: pc ? `${pc[1]} ${pc[2]}`.toUpperCase() : null,
    uprn: blank(v(/^UPRN:?$/i)),
    sqft: num(ft?.s),
    sqm: num(m2?.s),
    plotAcres: num(v(/^Plot Size:?$/i)),
    councilBand: blank(v(/^Council Tax Band:?$/i))?.toUpperCase().slice(0, 2) ?? null,
    councilTax: num(v(/^Annual Cost:?$/i)),
    title: blank(title),
    tenure: blank(v(/^Tenure:?$/i)),
    authority: blank(v(/^Local Authority:?$/i)),
    flood: blank(v(/^Flood Risk:?$/i)),
    conservation: conservation ? /^yes/i.test(conservation) : null,
    planning,
    type: blank(v(/^Property Type:?$/i)),
    beds: num(blank(v(/^Bedrooms:?$/i))),
    baths: num(blank(v(/^Bathrooms?:?$/i))),
    outside: blank(v(/^Outside Space:?$/i)),
    parking: blank(v(/^Parking:?$/i)),
    broadband: { basic: num(v(/^Basic:?$/i)), superfast: num(v(/^Superfast:?$/i)), ultrafast: num(v(/^Ultrafast:?$/i)) },
    epc: epcOf(items),
    street: streetSales(items),
    growth: growthOf(items),
  }
}

/** How many of the facts a valuation leans on were found (to warn staff when the guide was hard to read). */
export function guideGaps(g: OtmGuide): string[] {
  const out: string[] = []
  if (!g.type) out.push('property type')
  if (g.beds == null) out.push('bedrooms')
  if (g.sqft == null) out.push('floor area')
  if (!g.tenure) out.push('tenure')
  if (!g.epc?.current) out.push('energy rating')
  return out
}

/** The guide's property type → Land Registry's, for like-for-like sales. */
export function lrTypeOf(type: string | null): LrType | null {
  const t = (type ?? '').toLowerCase()
  if (!t) return null
  if (/flat|maisonette|apartment/.test(t)) return 'F'
  if (/semi/.test(t)) return 'S'
  if (/terrace|town ?house/.test(t)) return 'T'
  if (/detached/.test(t)) return 'D'
  if (/bungalow|cottage|house/.test(t)) return 'H'
  return null
}

/** "Terraced House" → "terraced house"; "Flat-Maisonette House" → "flat or maisonette". */
export function typeWords(type: string | null): string | null {
  if (!type) return null
  const t = type.trim().toLowerCase()
  if (/flat|maisonette/.test(t)) return 'flat or maisonette'
  return t.replace(/\s+/g, ' ')
}

export const TYPE_PLURAL: Record<string, string> = { F: 'flats and maisonettes', T: 'terraced houses', S: 'semi-detached houses', D: 'detached houses', H: 'houses' }

/** Rounds to the nearest £5,000 (sales) or £25 (rents). */
export const roundPrice = (n: number, rent: boolean) => (rent ? Math.round(n / 25) * 25 : Math.round(n / 5000) * 5000)

/**
 * A starting point for staff's price: the middle of the like-for-like sales (or rents), with a range either side.
 * Staff always set the final figures; this only saves them a sum.
 */
export function suggestPrice(prices: number[], rent: boolean): { asking: number; low: number; high: number } | null {
  if (prices.length < 3) return null
  const s = [...prices].sort((a, b) => a - b)
  const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  return { asking: roundPrice(mid, rent), low: roundPrice(mid * 0.96, rent), high: roundPrice(mid * 1.03, rent) }
}

/** Sales far from the rest (a share of a home, a wreck, a typo) say nothing about this one. */
export function withoutOutliers<T extends { price: number }>(list: T[]): T[] {
  if (list.length < 4) return list
  const s = list.map((x) => x.price).sort((a, b) => a - b)
  const mid = s[Math.floor(s.length / 2)]
  return list.filter((x) => x.price >= mid * 0.6 && x.price <= mid * 1.6)
}

/** Points worth making to the owner, from the facts (for "What this means for your sale"). */
export function guidePoints(g: OtmGuide, today: string, rent: boolean): { title: string; text: string }[] {
  const out: { title: string; text: string }[] = []
  const who = rent ? 'a tenant' : 'a buyer'
  const sale = rent ? 'letting' : 'sale'
  if (/freehold/i.test(g.tenure ?? '') && g.title) out.push({ title: rent ? 'Straightforward to let.' : 'A simpler sale.', text: rent ? 'Freehold with a registered title: no freeholder’s consent or lease terms to check before a tenancy.' : 'Freehold with a registered title: no lease, service charge or ground rent for a buyer’s solicitor to query.' })
  else if (/leasehold/i.test(g.tenure ?? '')) out.push({ title: 'Have the lease to hand.', text: rent ? 'We’ll check the lease allows letting, and what the service charge covers.' : 'A buyer’s solicitor will ask how many years are left, and about the service charge and ground rent. We’ll gather these early so nothing slows the sale.' })
  const fast = g.broadband.ultrafast ?? g.broadband.superfast
  if (fast && fast >= 300) out.push({ title: 'A selling point worth leading with.', text: `${g.broadband.ultrafast ? 'Ultrafast' : 'Superfast'} broadband is available, which matters to the many ${rent ? 'tenants' : 'buyers'} who work from home.` })
  const expired = g.epc?.validUntil && g.epc.validUntil < today
  if (!g.epc?.current || expired) out.push({ title: 'One thing to sort first.', text: `The ${expired ? 'new ' : ''}EPC. It’s required before ${rent ? 'a tenancy can start' : 'your home can be marketed'}; we book it, and it’s done before the photographs.` })
  else if (rent && g.epc.current && 'EFG'.includes(g.epc.current.band)) out.push({ title: 'Check the energy rating.', text: `It’s rated ${g.epc.current.band}. Homes need at least an E to be let, and the rules are tightening, so we’ll go through what would lift it.` })
  else if (g.epc.potential && g.epc.current && g.epc.potential.score - g.epc.current.score >= 10) out.push({ title: 'Room to improve.', text: `The energy rating is ${g.epc.current.band} now and could reach ${g.epc.potential.band}. ${rent ? 'Tenants' : 'Buyers'} notice running costs; we’ll go through the certificate’s suggestions with you.` })
  if (/very low|low/i.test(g.flood ?? '') && out.length < 4) out.push({ title: 'No worries about flooding.', text: `The flood risk is ${g.flood!.toLowerCase()}, so ${who}’s insurer and lender have nothing to ask about.` })
  if (out.length < 4) out.push(g.planning.length
    ? { title: 'Have your paperwork ready.', text: `${g.planning.length} planning record${g.planning.length === 1 ? ' is' : 's are'} on file. If the work was done, the completion certificates will help the ${sale} go smoothly.` }
    : { title: 'Have your paperwork ready.', text: 'No planning applications are recorded, so if you’ve made changes (a loft, an extension, a new boiler), the certificates will help.' })
  return out.slice(0, 4)
}
