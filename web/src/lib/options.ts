// Listing vocabularies, modelled on the fields Rightmove, Zoopla and OnTheMarket
// ask agents for, plus National Trading Standards material information.

export type Option = { value: string; label: string }

export const CHANNELS: Option[] = [
  { value: 'sale', label: 'For sale' },
  { value: 'let', label: 'To let' },
]

export const STATUSES: (Option & { channels: string[] })[] = [
  { value: 'available', label: 'Available', channels: ['sale', 'let'] },
  { value: 'under_offer', label: 'Under offer', channels: ['sale'] },
  { value: 'sold_stc', label: 'Sold STC', channels: ['sale'] },
  { value: 'sold', label: 'Sold', channels: ['sale'] },
  { value: 'let_agreed', label: 'Let agreed', channels: ['let'] },
  { value: 'let', label: 'Let', channels: ['let'] },
  { value: 'withdrawn', label: 'Withdrawn', channels: ['sale', 'let'] },
]

export const PRICE_QUALIFIERS: Option[] = [
  { value: '', label: 'None' },
  { value: 'guide_price', label: 'Guide price' },
  { value: 'offers_over', label: 'Offers over' },
  { value: 'offers_in_excess_of', label: 'Offers in excess of' },
  { value: 'offers_in_region_of', label: 'Offers in the region of' },
  { value: 'fixed_price', label: 'Fixed price' },
  { value: 'from', label: 'From' },
  { value: 'poa', label: 'Price on application' },
]

export const RENT_FREQUENCIES: Option[] = [
  { value: 'pcm', label: 'Per calendar month' },
  { value: 'pw', label: 'Per week' },
  { value: 'pa', label: 'Per year' },
]

export const PROPERTY_TYPES: Option[] = [
  { value: 'detached_house', label: 'Detached house' },
  { value: 'semi_detached_house', label: 'Semi-detached house' },
  { value: 'terraced_house', label: 'Terraced house' },
  { value: 'end_terrace_house', label: 'End of terrace house' },
  { value: 'town_house', label: 'Town house' },
  { value: 'flat', label: 'Flat' },
  { value: 'maisonette', label: 'Maisonette' },
  { value: 'studio', label: 'Studio' },
  { value: 'bungalow', label: 'Bungalow' },
  { value: 'cottage', label: 'Cottage' },
  { value: 'land', label: 'Land' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'parking', label: 'Parking or garage' },
  { value: 'other', label: 'Other' },
]

export const TENURES: Option[] = [
  { value: '', label: 'Not specified' },
  { value: 'freehold', label: 'Freehold' },
  { value: 'leasehold', label: 'Leasehold' },
  { value: 'share_of_freehold', label: 'Share of freehold' },
  { value: 'commonhold', label: 'Commonhold' },
]

export const FURNISHING: Option[] = [
  { value: '', label: 'Not specified' },
  { value: 'furnished', label: 'Furnished' },
  { value: 'unfurnished', label: 'Unfurnished' },
  { value: 'part_furnished', label: 'Part furnished' },
  { value: 'flexible', label: 'Furnished or unfurnished' },
]

export const LET_TYPES: Option[] = [
  { value: '', label: 'Not specified' },
  { value: 'long_term', label: 'Long term' },
  { value: 'short_term', label: 'Short term' },
  { value: 'student', label: 'Student' },
  { value: 'commercial', label: 'Commercial' },
]

export const COUNCIL_TAX_BANDS: Option[] = [
  { value: '', label: 'Not specified' },
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((b) => ({ value: b, label: `Band ${b}` })),
  { value: 'exempt', label: 'Exempt' },
  { value: 'tbc', label: 'To be confirmed' },
]

export const EPC_RATINGS: Option[] = [
  { value: '', label: 'Not specified' },
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((b) => ({ value: b, label: b })),
]

export const MEDIA_KINDS = ['photo', 'floorplan', 'epc', 'brochure', 'video'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export const MEDIA_RULES: Record<MediaKind, { label: string; types: Record<string, string>; maxBytes: number }> = {
  photo: {
    label: 'Photos',
    types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
    maxBytes: 25 * 1024 * 1024,
  },
  floorplan: {
    label: 'Floorplans',
    types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' },
    maxBytes: 25 * 1024 * 1024,
  },
  epc: {
    label: 'EPC graph',
    types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' },
    maxBytes: 25 * 1024 * 1024,
  },
  brochure: {
    label: 'Brochure',
    types: { 'application/pdf': 'pdf' },
    maxBytes: 50 * 1024 * 1024,
  },
  video: {
    label: 'Video tour',
    types: { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' },
    maxBytes: 1024 * 1024 * 1024,
  },
}

export function labelFor(options: Option[], value: string | null | undefined): string {
  if (!value) return ''
  return options.find((o) => o.value === value)?.label ?? value
}

export function statusesFor(channel: string) {
  return STATUSES.filter((s) => s.channels.includes(channel))
}
