import { describe, expect, it } from 'vitest'
import { badgeFor, cardDefaults, defaultHeadline, defaultHighlights, factsFor, mergeCard, shortDescription, splitPrice, type CardProperty } from './window-card'

const p: CardProperty = {
  ref: 'PHE9002', channel: 'sale', status: 'available', headline: null,
  summary: 'A beautifully extended three bedroom semi-detached house on a quiet tree-lined road. The kitchen opens onto a 90ft garden. Close to Kenton station and good schools, with off-street parking for two cars and a garage.',
  description: null, keyFeatures: ['Three double bedrooms', 'Open-plan kitchen and family room with bi-fold doors onto the garden and a utility room', '90ft south-facing garden', 'Off-street parking', 'Three double bedrooms', 'Garage', 'Close to Kenton station'],
  bedrooms: 3, bathrooms: 2, receptions: 1, floorAreaSqft: 1250, typeLabel: 'Semi-detached house', tenureLabel: 'Freehold', furnishingLabel: null, epc: 'C',
  publishedAt: '2026-11-10T10:00:00Z', photos: [{ id: 'b', url: '/b.jpg', isCover: false, position: 1 }, { id: 'a', url: '/a.jpg', isCover: true, position: 3 }, { id: 'c', url: '/c.jpg', isCover: false, position: 2 }],
}
const NOW = new Date('2026-11-16T12:00:00Z')

describe('the words', () => {
  it('makes a short headline when the listing has none', () => {
    expect(defaultHeadline(p)).toBe('3 Bedroom Semi-Detached House')
    expect(defaultHeadline({ ...p, headline: 'Stunning family home with a 90ft garden' })).toBe('Stunning family home with a 90ft garden')
    expect(defaultHeadline({ ...p, bedrooms: 0, typeLabel: 'Flat' })).toBe('Studio Flat')
  })
  it('keeps whole sentences, short enough for a window', () => {
    expect(shortDescription(p.summary)).toBe(p.summary) // 214 characters: all three sentences fit
    const long = shortDescription(`${p.summary} It also has a loft room, a downstairs cloakroom and a large garage at the back.`)
    expect(long).toBe(p.summary)
    expect(long.length).toBeLessThanOrEqual(230)
    expect(shortDescription(null, '', 'Fallback text.')).toBe('Fallback text.')
  })
  it('picks short, different highlights', () => {
    expect(defaultHighlights(p)).toEqual(['Three double bedrooms', '90ft south-facing garden', 'Off-street parking', 'Garage', 'Close to Kenton station'])
  })
  it('splits the price into small words and a big number', () => {
    expect(splitPrice('Guide price £650,000')).toEqual({ lead: 'Guide price', amount: '£650,000', tail: '' })
    expect(splitPrice('£1,650 pcm')).toEqual({ lead: '', amount: '£1,650', tail: 'pcm' })
    expect(splitPrice('Price on application')).toEqual({ lead: '', amount: 'Price on application', tail: '' })
  })
})

describe('the photos and facts', () => {
  it('starts with the cover photo, then the listing order', () => {
    expect(cardDefaults(p).photos.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
  it('drops photos no longer on the listing, keeping the rest of what was saved', () => {
    const m = mergeCard(p, { headline: 'Mine', photos: [{ id: 'gone', x: 1, y: 1 }, { id: 'c', x: 20, y: 80 }] })
    expect(m.headline).toBe('Mine')
    expect(m.photos).toEqual([{ id: 'c', x: 20, y: 80 }])
  })
  it('shows only the facts the listing has', () => {
    expect(factsFor(p).map((f) => `${f.value} ${f.label}`.trim())).toEqual(['3 Bedrooms', '2 Bathrooms', '1 Reception', '1,250 Sq ft', 'Freehold'])
    expect(factsFor({ ...p, bathrooms: null, receptions: null, floorAreaSqft: null, tenureLabel: null }).map((f) => f.key)).toEqual(['bed', 'epc'])
  })
})

describe('the ribbon', () => {
  it('says only what is true', () => {
    expect(badgeFor(p, { badge: 'auto', badgeText: '' }, NOW)).toBe('Just listed')
    expect(badgeFor({ ...p, publishedAt: '2026-09-01T10:00:00Z' }, { badge: 'auto', badgeText: '' }, NOW)).toBeNull()
    expect(badgeFor({ ...p, status: 'under_offer' }, { badge: 'auto', badgeText: '' }, NOW)).toBe('Under offer')
    expect(badgeFor({ ...p, status: 'sold_stc' }, { badge: 'auto', badgeText: '' }, NOW)).toBe('Sold STC')
    expect(badgeFor(p, { badge: 'custom', badgeText: '  Chain free ' }, NOW)).toBe('Chain free')
    expect(badgeFor(p, { badge: 'none', badgeText: '' }, NOW)).toBeNull()
  })
})

describe('paper size', () => {
  it('A3 is the same sheet scaled up by √2', async () => {
    const { paperSize } = await import('./window-card')
    expect(paperSize('a4', 'portrait')).toEqual({ w: 210, h: 297, scale: 1 })
    expect(paperSize('a3', 'portrait')).toEqual({ w: 297, h: 420, scale: Math.SQRT2 })
    expect(paperSize('a3', 'landscape')).toEqual({ w: 420, h: 297, scale: Math.SQRT2 })
    // A4 × √2 ≈ A3, to within a millimetre.
    expect(Math.abs(210 * Math.SQRT2 - 297)).toBeLessThan(1)
  })
  it('older saved sheets default to A4', () => {
    expect(mergeCard(p, { headline: 'x' }).paper).toBe('a4')
  })
})

describe('printer margin', () => {
  it('keeps everything 8 mm in from the edge for office printers, keeping the shape', async () => {
    const { placement, PRINT_MARGIN_MM } = await import('./window-card')
    const mmPerPx = 210 / 794
    const a4 = placement('a4', 'portrait', 'office')
    expect(a4.pad * mmPerPx).toBeCloseTo(PRINT_MARGIN_MM, 5)
    // The sheet fits inside the border on both sides, centred: at least 8 mm everywhere.
    expect((794 - 794 * a4.scale) / 2 * mmPerPx).toBeGreaterThanOrEqual(PRINT_MARGIN_MM - 1e-9)
    expect((1123 - 1123 * a4.scale) / 2 * mmPerPx).toBeGreaterThanOrEqual(PRINT_MARGIN_MM - 1e-9)
    // On A3 the page is scaled up by √2, and the border is still 8 mm once printed.
    const a3 = placement('a3', 'landscape', 'office')
    expect(a3.pad * mmPerPx * Math.SQRT2).toBeCloseTo(PRINT_MARGIN_MM, 5)
    expect(placement('a4', 'portrait', 'none')).toEqual({ pad: 0, scale: 1 })
  })
  it('older saved sheets get the safe border', () => {
    expect(mergeCard(p, { headline: 'x' }).margin).toBe('office')
  })
})

describe('more words for bigger sheets', () => {
  it('pulls in more of the listing, in whole sentences, without repeating the summary', async () => {
    const { longerDescription } = await import('./window-card')
    const summary = 'A spacious three bedroom semi. Close to Preston Road.'
    const description = 'A spacious three bedroom semi. Close to Preston Road. The kitchen is newly fitted. The garden is 90ft long and faces south.'
    expect(longerDescription({ summary, description })).toBe(description)
    expect(longerDescription({ summary: 'One. Two.', description: 'Three. Four.' })).toBe('One. Two. Three. Four.')
    expect(longerDescription({ summary, description }, 60)).toBe('A spacious three bedroom semi. Close to Preston Road.')
  })
  it('offers up to eight highlights, starting with five', async () => {
    const { defaultHighlights, MAX_HIGHLIGHTS } = await import('./window-card')
    const many = { keyFeatures: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] }
    expect(defaultHighlights(many)).toHaveLength(5)
    expect(defaultHighlights(many, MAX_HIGHLIGHTS)).toHaveLength(8)
  })
})
