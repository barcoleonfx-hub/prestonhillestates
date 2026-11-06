// The valuation check on a valuation enquiry: an estimate from HM Land Registry sales nearby (or, for lettings,
// our lets and the official rent figures), links that open the same search on Rightmove, Zoopla and
// OnTheMarket for staff to look at themselves, the comparable homes staff note down, and the figure they settle on.
// Pure helpers live here; the data loading is in valuation-check-data.ts.

export type CheckComp = { source: string; kind: 'sold' | 'asking' | 'rent'; price: number; address: string; beds?: number | null; link?: string | null }
export type SavedValuation = { comps: CheckComp[]; low: number | null; high: number | null; note: string | null; savedAt: string; savedBy: string | null }

export const SOURCES = ['Rightmove', 'Zoopla', 'OnTheMarket', 'Our own', 'Other'] as const

export function parseSaved(raw: string | null | undefined): SavedValuation | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return { comps: Array.isArray(v.comps) ? v.comps : [], low: Number(v.low) || null, high: Number(v.high) || null, note: v.note ?? null, savedAt: v.savedAt ?? '', savedBy: v.savedBy ?? null }
  } catch { return null }
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
/** "£550,000" or "£550,000 to £575,000", and "a month" for rents. */
export function figureText(low: number | null, high: number | null, rent = false): string {
  if (!low && !high) return ''
  const a = low ?? high!, b = high ?? low!
  const r = a === b ? gbp(a) : `${gbp(Math.min(a, b))} to ${gbp(Math.max(a, b))}`
  return rent ? `${r} a month` : r
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const roundTo = (n: number, step: number) => Math.round(n / step) * step

/**
 * One suggested range from all the evidence: the Land Registry estimate, sold prices staff found, and asking
 * prices less 3% (homes usually sell a little under the asking price). Each comparable counts once; the
 * Land Registry figure counts as much as all the sales it's built from, up to three.
 */
export function suggested(lr: { mid: number; count: number } | null, comps: CheckComp[], rent: boolean): { low: number; high: number; basis: string } | null {
  const pts: number[] = []
  const parts: string[] = []
  if (lr) { for (let i = 0; i < Math.min(3, lr.count); i++) pts.push(lr.mid); parts.push(rent ? 'our rent estimate' : 'Land Registry sales nearby') }
  const sold = comps.filter((c) => c.kind === 'sold' || c.kind === 'rent'), asking = comps.filter((c) => c.kind === 'asking')
  for (const c of sold) pts.push(c.price)
  for (const c of asking) pts.push(c.price * (rent ? 1 : 0.97))
  if (sold.length) parts.push(`${sold.length} ${rent ? 'rent' : 'sold price'}${sold.length === 1 ? '' : 's'} you found`)
  if (asking.length) parts.push(`${asking.length} asking price${asking.length === 1 ? '' : 's'}${rent ? '' : ' (less 3%)'}`)
  if (!pts.length) return null
  const mid = median(pts)
  const step = rent ? 25 : 5000
  return { low: roundTo(mid * 0.97, step), high: roundTo(mid * 1.03, step), basis: parts.join(', ') }
}

/** Searches on the portals for staff to open and look at (we never fetch these pages ourselves). */
export function portalLinks(postcode: string | null, opts: { rent: boolean; beds: number | null }) {
  if (!postcode) return []
  const pc = postcode.toUpperCase().trim().replace(/\s+/g, ' ')
  const slug = pc.toLowerCase().replace(' ', '-')
  const outward = pc.split(' ')[0].toLowerCase()
  const beds = opts.beds ?? null
  const q = encodeURIComponent(pc)
  return opts.rent ? [
    { label: 'OnTheMarket: homes to rent nearby', href: `https://www.onthemarket.com/to-rent/property/${slug}/?radius=0.5${beds ? `&min-bedrooms=${beds}&max-bedrooms=${beds}` : ''}` },
    { label: 'Zoopla: homes to rent nearby', href: `https://www.zoopla.co.uk/to-rent/property/${outward}/?q=${q}&radius=0.5${beds ? `&beds_min=${beds}&beds_max=${beds}` : ''}` },
    { label: 'Rightmove: what sold nearby', href: `https://www.rightmove.co.uk/house-prices/${slug}.html` },
  ] : [
    { label: 'Rightmove: sold prices for this postcode', href: `https://www.rightmove.co.uk/house-prices/${slug}.html` },
    { label: 'Rightmove: sold prices in the area', href: `https://www.rightmove.co.uk/house-prices/${outward}.html` },
    { label: 'OnTheMarket: similar homes for sale', href: `https://www.onthemarket.com/for-sale/property/${slug}/?radius=0.5${beds ? `&min-bedrooms=${beds}&max-bedrooms=${beds}` : ''}` },
    { label: 'Zoopla: similar homes for sale', href: `https://www.zoopla.co.uk/for-sale/property/${outward}/?q=${q}&radius=0.5${beds ? `&beds_min=${beds}&beds_max=${beds}` : ''}` },
  ]
}

/** What the enquiry says about the home: Land Registry type (F/T/S/D) and bedrooms, from the valuation form. */
export function homeFrom(message: string | null): { type: 'F' | 'T' | 'S' | 'D' | null; typeLabel: string | null; beds: number | null } {
  const t = message ?? ''
  const typeLine = /^(?:type|property type|type of property)\s*:\s*(.+)$/im.exec(t)?.[1] ?? ''
  const type = /flat|maisonette|apartment|studio/i.test(typeLine) ? 'F' : /semi/i.test(typeLine) ? 'S' : /terrace|town ?house/i.test(typeLine) ? 'T' : /detached|bungalow/i.test(typeLine) ? 'D' : null
  const beds = Number(/^(?:bedrooms?|beds?)\s*:\s*(\d+)/im.exec(t)?.[1] ?? /\b(\d)\s*(?:bed|bedroom)/i.exec(t)?.[1] ?? NaN)
  return { type, typeLabel: typeLine || null, beds: Number.isFinite(beds) ? beds : null }
}
