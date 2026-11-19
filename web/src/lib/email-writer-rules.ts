// The AI property email writer, the parts with no server code: the listing as a fact sheet (the only facts the
// writer may use), the choices staff make, and tidying what comes back so it fits the email (no greeting or sign-off,
// which the email adds itself; "- " bullets and **bold** as the email understands them).

export const AUDIENCES = [
  { key: 'auto', label: 'Let the AI decide' },
  { key: 'first-time', label: 'First-time buyers' },
  { key: 'family', label: 'Families' },
  { key: 'investor', label: 'Investors and landlords' },
  { key: 'downsizer', label: 'Downsizers' },
  { key: 'professional', label: 'Professionals and couples' },
  { key: 'tenant', label: 'Tenants' },
] as const
export type AudienceKey = (typeof AUDIENCES)[number]['key']

export const LENGTHS = { short: 'Short (about 90 words)', standard: 'Standard (about 160 words)', detailed: 'Detailed (about 260 words)' } as const
export type LengthKey = keyof typeof LENGTHS
export const TONES = { warm: 'Warm and personal', polished: 'Polished and professional', punchy: 'Short and punchy' } as const
export type ToneKey = keyof typeof TONES

/** A home as the writer sees it. Every value comes from the listing; anything missing is simply left out. */
export type WriterHome = {
  channel: 'sale' | 'let'
  status: string
  headline: string | null
  address: string
  price: string
  type: string | null
  bedrooms: number | null
  bathrooms: number | null
  receptions: number | null
  floorAreaSqft: number | null
  tenure: string | null
  leaseYears: number | null
  serviceCharge: number | null
  groundRent: number | null
  councilTax: string | null
  epc: string | null
  parking: string | null
  outside: string | null
  heating: string | null
  furnishing: string | null
  availableFrom: string | null
  deposit: number | null
  newBuild: boolean
  summary: string | null
  description: string | null
  features: string[]
  rooms: { name: string; dimensions: string | null; description: string | null }[]
  url: string
}

/** Who the email is to, when it's one person: what they told us they're looking for. */
export type WriterReader = { role: string | null; minBeds: number | null; maxPrice: number | null; areas: string | null; position: string | null } | null

const clean = (t: string | null | undefined) => (t ?? '').replace(/[*_#>]/g, '').replace(/\s+/g, ' ').trim()
const money = (n: number) => `£${n.toLocaleString('en-GB')}`

/** The listing as a plain fact sheet: the only facts the writer may use. */
export function factSheet(h: WriterHome): string {
  const line = (k: string, v: string | number | null | undefined | false) => (v || v === 0 ? `${k}: ${v}` : null)
  const out = [
    line('Listing', h.channel === 'let' ? 'To let' : 'For sale'),
    line('Status', h.status === 'available' ? null : h.status.replace(/_/g, ' ')),
    line('Headline', clean(h.headline)),
    line('Address (as advertised)', h.address),
    line('Price', h.price),
    line('Type', h.type),
    line('Bedrooms', h.bedrooms === 0 ? 'Studio' : h.bedrooms),
    line('Bathrooms', h.bathrooms),
    line('Reception rooms', h.receptions),
    line('Floor area', h.floorAreaSqft ? `${h.floorAreaSqft.toLocaleString('en-GB')} sq ft` : null),
    line('New build', h.newBuild ? 'Yes' : null),
    line('Tenure', h.tenure),
    line('Lease remaining', h.leaseYears ? `${h.leaseYears} years` : null),
    line('Service charge', h.serviceCharge ? `${money(h.serviceCharge)} a year` : null),
    line('Ground rent', h.groundRent ? `${money(h.groundRent)} a year` : null),
    line('Council tax band', h.councilTax),
    line('EPC rating', h.epc),
    line('Parking', clean(h.parking)),
    line('Outside space', clean(h.outside)),
    line('Heating', clean(h.heating)),
    line('Furnishing', h.furnishing),
    line('Available from', h.availableFrom),
    line('Deposit', h.deposit ? money(h.deposit) : null),
  ].filter(Boolean) as string[]
  if (h.features.length) out.push(`Key features:\n${h.features.map((f) => `- ${clean(f)}`).join('\n')}`)
  if (clean(h.summary)) out.push(`Summary (the listing's own words):\n${clean(h.summary)}`)
  if (clean(h.description)) out.push(`Full description (the listing's own words):\n${clean(h.description).slice(0, 6000)}`)
  const rooms = h.rooms.filter((r) => r.name.trim()).slice(0, 30)
  if (rooms.length) out.push(`Rooms:\n${rooms.map((r) => `- ${clean(r.name)}${r.dimensions ? ` (${clean(r.dimensions)})` : ''}${r.description ? `: ${clean(r.description)}` : ''}`).join('\n')}`)
  return out.join('\n')
}

/** What the reader told us they want, in words (for one person). */
export function readerNotes(r: WriterReader): string | null {
  if (!r) return null
  const parts = [
    r.role ? `They are a ${r.role}.` : '',
    r.minBeds != null ? `They want at least ${r.minBeds === 0 ? 'a studio' : `${r.minBeds} bedrooms`}.` : '',
    r.maxPrice ? `Their budget is up to ${money(r.maxPrice)}.` : '',
    r.areas ? `Areas they like: ${r.areas}.` : '',
    r.position ? `Their position: ${r.position}.` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

/**
 * Tidy the body for the email: no greeting or sign-off (the email has its own), bullets as "- ", at most one blank
 * line between paragraphs.
 */
export function tidyBody(body: string): string {
  const lines = body.replace(/\r/g, '').split('\n').map((l) => l.replace(/^\s*[•*·]\s+/, '- ').replace(/\s+$/, ''))
  while (lines.length && (!lines[0].trim() || /^(dear|hi|hello|good (morning|afternoon|evening))\b.{0,40},?$/i.test(lines[0].trim()))) lines.shift()
  const signoff = /^(kind regards|best regards|warm regards|regards|best wishes|many thanks|thanks|yours sincerely|yours faithfully|with best wishes),?$/i
  const cut = lines.findIndex((l) => signoff.test(l.trim()))
  const kept = cut >= 0 ? lines.slice(0, cut) : lines
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
