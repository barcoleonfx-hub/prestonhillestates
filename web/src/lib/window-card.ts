// Shop window display sheets: what goes on the card for one of our homes. Pure functions with no server imports, so
// the editor and the sheet itself work them out the same way. Everything comes from the listing; staff can change
// the wording and the photos before printing.

export type CardLayout = 'portrait' | 'landscape'
/** A3 is A4 scaled up by √2: the same design, printed bigger. */
export type CardPaper = 'a4' | 'a3'
/** office: an 8 mm white border, because office printers can't print to the edge of the paper. none: edge to edge (print shops). */
export type CardMargin = 'office' | 'none'
export type BadgeKind = 'auto' | 'none' | 'just-listed' | 'new-instruction' | 'reduced' | 'custom'
export type CardPhoto = { id: string; x: number; y: number }
export type CardData = {
  layout: CardLayout
  paper: CardPaper
  margin: CardMargin
  badge: BadgeKind
  badgeText: string
  headline: string
  description: string
  highlights: string[]
  photos: CardPhoto[]
  showQr: boolean
}

/** What the card needs from a listing. */
export type CardProperty = {
  ref: string
  channel: 'sale' | 'let'
  status: string
  headline: string | null
  summary: string | null
  description: string | null
  keyFeatures: string[]
  bedrooms: number | null
  bathrooms: number | null
  receptions: number | null
  floorAreaSqft: number | null
  typeLabel: string | null
  tenureLabel: string | null
  furnishingLabel: string | null
  epc: string | null
  publishedAt: string | null
  photos: { id: string; url: string; isCover: boolean; position: number }[]
}

/** Page size in millimetres, and how much the A4-sized sheet is scaled up to fill it. */
export function paperSize(paper: CardPaper, layout: CardLayout): { w: number; h: number; scale: number } {
  const [short, long] = paper === 'a3' ? [297, 420] : [210, 297]
  return { w: layout === 'landscape' ? long : short, h: layout === 'landscape' ? short : long, scale: paper === 'a3' ? Math.SQRT2 : 1 }
}

/** The white border for office printers, in millimetres on the printed page. Most can't print the outer 4 to 6 mm. */
export const PRINT_MARGIN_MM = 8

/**
 * Where the sheet sits on the page, in the sheet's own pixels (A4 is 794 × 1123): the border all round, and how much
 * the sheet shrinks to fit inside it (keeping its shape, centred).
 */
export function placement(paper: CardPaper, layout: CardLayout, margin: CardMargin): { pad: number; scale: number } {
  if (margin === 'none') return { pad: 0, scale: 1 }
  const { scale } = paperSize(paper, layout)
  const [W, H] = layout === 'landscape' ? [1123, 794] : [794, 1123]
  // 8 mm on the printed page; the A3 page is the A4 sheet scaled up, so its border is smaller in sheet pixels.
  const pad = (PRINT_MARGIN_MM / scale) * (794 / 210)
  return { pad, scale: Math.min((W - 2 * pad) / W, (H - 2 * pad) / H) }
}

export const MAX_PHOTOS = 4
export const MAX_HIGHLIGHTS = 5
export const HEADLINE_MAX = 60
export const DESCRIPTION_MAX = 230

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The first sentence or two of the listing's own words, no longer than a shop window can hold. */
export function shortDescription(...texts: (string | null | undefined)[]): string {
  for (const t of texts) {
    const clean = tidy((t ?? '').replace(/[*_#>]/g, ''))
    if (!clean) continue
    const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((x) => x.trim()) ?? [clean]
    let out = ''
    for (const s of sentences) {
      if ((out ? `${out} ${s}` : s).length > DESCRIPTION_MAX) break
      out = out ? `${out} ${s}` : s
    }
    if (!out) out = `${clean.slice(0, DESCRIPTION_MAX - 1).replace(/\s+\S*$/, '')}…`
    return out
  }
  return ''
}

/** "3 Bedroom Semi-Detached House", or the listing's own headline when it's short enough. */
export function defaultHeadline(p: Pick<CardProperty, 'headline' | 'bedrooms' | 'typeLabel'>): string {
  const own = tidy(p.headline ?? '')
  if (own && own.length <= HEADLINE_MAX) return own
  const beds = p.bedrooms == null ? '' : p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} Bedroom`
  const type = (p.typeLabel ?? '').replace(/\b\w/g, (c) => c.toUpperCase())
  return tidy(`${beds} ${p.bedrooms === 0 ? (type.replace(/^Studio\s*/i, '') || 'Apartment') : type || 'Home'}`)
}

/** Up to five short selling points from the key features, each short enough for one line. */
export function defaultHighlights(p: Pick<CardProperty, 'keyFeatures'>): string[] {
  const out: string[] = []
  for (const k of p.keyFeatures) {
    const t = tidy(k).replace(/[.;]+$/, '')
    if (!t || t.length > 42 || out.some((x) => x.toLowerCase() === t.toLowerCase())) continue
    out.push(t.charAt(0).toUpperCase() + t.slice(1))
    if (out.length === MAX_HIGHLIGHTS) break
  }
  return out
}

/** The cover first, then the others in their order. */
export function orderedPhotos(p: Pick<CardProperty, 'photos'>) {
  return [...p.photos].sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.position - b.position)
}

export function cardDefaults(p: CardProperty): CardData {
  return {
    layout: 'portrait', paper: 'a4', margin: 'office', badge: 'auto', badgeText: '', headline: defaultHeadline(p), description: shortDescription(p.summary, p.description),
    highlights: defaultHighlights(p), photos: orderedPhotos(p).slice(0, MAX_PHOTOS).map((x) => ({ id: x.id, x: 50, y: 50 })), showQr: true,
  }
}

/** Saved changes on top of the defaults; photos that are no longer on the listing are dropped. */
export function mergeCard(p: CardProperty, saved: Partial<CardData> | null): CardData {
  const d = cardDefaults(p)
  if (!saved) return d
  const ids = new Set(p.photos.map((x) => x.id))
  const photos = (saved.photos ?? d.photos).filter((x) => ids.has(x.id)).slice(0, MAX_PHOTOS)
  return {
    ...d, ...saved,
    highlights: (saved.highlights ?? d.highlights).map(tidy).filter(Boolean).slice(0, MAX_HIGHLIGHTS),
    photos: photos.length ? photos : d.photos,
  }
}

/** The ribbon across the main photo, or null. "Auto" only ever says what's true from the listing. */
export function badgeFor(p: Pick<CardProperty, 'status' | 'publishedAt' | 'channel'>, c: Pick<CardData, 'badge' | 'badgeText'>, now = new Date()): string | null {
  switch (c.badge) {
    case 'none': return null
    case 'just-listed': return 'Just listed'
    case 'new-instruction': return 'New instruction'
    case 'reduced': return 'Price reduced'
    case 'custom': return tidy(c.badgeText).slice(0, 28) || null
  }
  if (p.status === 'under_offer') return 'Under offer'
  if (p.status === 'sold_stc') return 'Sold STC'
  if (p.status === 'sold') return 'Sold'
  if (p.status === 'let_agreed') return 'Let agreed'
  if (p.publishedAt && now.getTime() - Date.parse(p.publishedAt) < 14 * 864e5) return 'Just listed'
  return null
}

/** "FOR SALE" or "TO LET", unless it's gone. */
export const bandFor = (p: Pick<CardProperty, 'channel'>) => (p.channel === 'let' ? 'To let' : 'For sale')

/** The facts row: beds, baths, receptions, size, tenure or furnishing, EPC. Only what the listing has. */
export function factsFor(p: CardProperty): { key: string; value: string; label: string }[] {
  const out: { key: string; value: string; label: string }[] = []
  if (p.bedrooms != null) out.push({ key: 'bed', value: p.bedrooms === 0 ? 'Studio' : String(p.bedrooms), label: p.bedrooms === 1 ? 'Bedroom' : p.bedrooms === 0 ? '' : 'Bedrooms' })
  if (p.bathrooms) out.push({ key: 'bath', value: String(p.bathrooms), label: p.bathrooms === 1 ? 'Bathroom' : 'Bathrooms' })
  if (p.receptions) out.push({ key: 'rec', value: String(p.receptions), label: p.receptions === 1 ? 'Reception' : 'Receptions' })
  if (p.floorAreaSqft) out.push({ key: 'size', value: p.floorAreaSqft.toLocaleString('en-GB'), label: 'Sq ft' })
  const t = p.channel === 'let' ? p.furnishingLabel : p.tenureLabel
  if (t) out.push({ key: 'tenure', value: t, label: '' })
  if (p.epc) out.push({ key: 'epc', value: p.epc, label: 'EPC' })
  return out.slice(0, 5)
}

/** "Guide price £650,000" into the small words and the big number. */
export function splitPrice(text: string): { lead: string; amount: string; tail: string } {
  const m = /^(.*?)(£[\d,]+(?:\.\d+)?)(.*)$/.exec(text)
  if (!m) return { lead: '', amount: text, tail: '' }
  return { lead: m[1].trim(), amount: m[2], tail: m[3].trim() }
}
