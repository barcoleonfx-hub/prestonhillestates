// The AI property email writer, the parts with no server code: the listing as a fact sheet (the only facts the
// writer may use), the choices staff make, and tidying what comes back so it fits the email (no greeting or sign-off,
// which the email adds itself; "- " bullets and **bold** as the email understands them).

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

/** Every place in the portal where the AI can write, and what it's writing there. */
export const AI_PLACES = {
  letter: { what: 'an email about one of our homes, to one person or many (it may be sent to a group)', words: '160 to 260', subject: true, greeting: false, bullets: true },
  'campaign-letter': { what: 'the opening message of an email newsletter to our contacts', words: '70 to 130', subject: false, greeting: true, bullets: false },
  'campaign-why': { what: 'the "why we love it" paragraph for a featured home in an email newsletter: two or three sentences, as you would tell a friend', words: '40 to 70', subject: false, greeting: false, bullets: false },
  'tailored-intro': { what: 'the opening paragraphs of a one-off email to a list of people (the greeting is added separately)', words: '100 to 180', subject: false, greeting: false, bullets: false },
  match: { what: 'a short personal note to one buyer or tenant about a home that matches what they want. The photos, price, highlights and why we thought of them are added underneath automatically, so don’t repeat those', words: '60 to 110', subject: false, greeting: true, bullets: false },
  enquiry: { what: 'an email replying to their enquiry', words: '140 to 240', subject: true, greeting: true, bullets: true },
  'enquiry-reply': { what: 'a reply in an ongoing email conversation about their enquiry (our name and office details are added below it)', words: '30 to 140', subject: false, greeting: true, bullets: false },
  whatsapp: { what: 'a WhatsApp message to them from our office phone, not an email. Use WhatsApp formatting: *single stars* for bold (never double stars), no headings, short paragraphs, and at most a few "- " bullet lines. Keep any link and any "Reply STOP" line from the brief exactly, and if the brief ends with a name (e.g. "Jamil, Preston Hill Estates"), end the same way', words: '50 to 150', subject: false, greeting: true, bullets: true },
  'listing-description': { what: 'the full description of one of our homes for its listing on our website and the property portals, not an email: no greeting, no sign-off, no subject. Staff have written a description; make it the best version of it. Open with what makes the home stand out for the people it suits best, then walk through the accommodation in a natural order (as the description and rooms give it), then the outside space, then the location and transport only as stated, and end with one short line inviting a viewing. Plain paragraphs separated by blank lines: no headings, no bullet points, no bold (the key features list is shown separately)', words: 'about the same number as staff wrote, or up to a third more if the facts allow', subject: false, greeting: false, bullets: false },
  'valuation-letter': { what: `a printed letter, posted to homeowners who asked us for a valuation (online, through Zoopla or OnTheMarket, or by phone) but haven't booked a visit yet. One letter is printed for each person, so write {first} for their first name and {home} for their house and street (e.g. "4 Kenton Park Avenue"), exactly like that, never a real name or address. The page already starts "Dear {first}," under the heading "Your free property report for {home}", and ends with the signature, so write neither. In the middle of the letter is a QR code that opens their own free property report: put a line with only ${'[QR CODE]'} where it goes, with the words that lead up to scanning it above that line and the rest below. The report is personal to their home: what similar homes nearby have sold for (HM Land Registry), their home's story through the years, what buyers will love about where they live (maps, stations, schools, shops and parks nearby), and how we'd sell it. Below the code, give a real reason to book a short free visit (about 30 minutes, no obligation), a little proof of who we are, and one clear way to book: keep every phone number and detail from the brief exactly. Plain paragraphs only: no bullet points, no bold, no headings. It must fit one A4 page with the address, heading and QR code`, words: '150 to 230 in all', subject: false, greeting: false, bullets: false },
  'thread-reply': { what: 'a reply to the latest email in this conversation (our name and office details are added below it, with their email quoted underneath)', words: '30 to 140', subject: false, greeting: true, bullets: false },
} as const
export type AiPlace = keyof typeof AI_PLACES

/** Tidy for a place: the greeting stays where the message includes one, and goes where the email adds its own. */
export function tidyFor(place: AiPlace, body: string): string {
  // WhatsApp bolds *single stars*.
  if (place === 'whatsapp') body = body.replace(/\*\*(.+?)\*\*/g, '*$1*')
  let out: string
  if (!AI_PLACES[place].greeting) out = tidyBody(body)
  else {
    const lines = body.replace(/\r/g, '').trim().split('\n')
    const greeting = /^(dear|hi|hello|good (morning|afternoon|evening))\b.{0,40},?$/i.test(lines[0]?.trim() ?? '') ? lines.shift()!.trim() : null
    const rest = tidyBody(lines.join('\n'))
    out = greeting ? `${greeting}\n\n${rest}` : rest
  }
  // A listing description and a printed letter are plain text: no bold and no bullets.
  if (place === 'listing-description' || place === 'valuation-letter') return out.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^- /gm, '')
  // WhatsApp messages use "•" bullets, like the ready-written ones.
  return place === 'whatsapp' ? out.replace(/^- /gm, '• ') : out
}
