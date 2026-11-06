// How an enquiry is described across the portal. Safe to import from client components.

export const ENQUIRY_SOURCES: Record<string, string> = {
  website: 'Website', zoopla: 'Zoopla', onthemarket: 'OnTheMarket', email: 'Email',
}

/** e.g. "Website viewing request", "Zoopla enquiry", "Email enquiry", "Buyer registration". */
export function enquiryLabel(e: { kind: string; source?: string | null }): string {
  const src = ENQUIRY_SOURCES[e.source ?? 'website'] ?? 'Website'
  if (e.kind === 'valuation') return `${src} valuation request`
  if (e.kind === 'buyer') return `${src} buyer registration`
  if (e.kind === 'email') return e.source === 'email' ? 'Email enquiry' : `${src} enquiry`
  return `${src} viewing request`
}

/** What happened when we followed an enquiry up. "Do not call back" also marks the person. */
export const ENQUIRY_OUTCOMES = [
  { value: 'not_interested', label: 'Not interested', tone: 'muted' },
  { value: 'open', label: 'Open to future calls', tone: 'ok' },
  { value: 'other_requirements', label: 'Other requirements', tone: 'gold' },
  { value: 'do_not_call', label: 'Do not call back', tone: 'warn' },
] as const

export type EnquiryOutcome = (typeof ENQUIRY_OUTCOMES)[number]['value']
export const outcomeText = (v: string | null | undefined) => ENQUIRY_OUTCOMES.find((o) => o.value === v)?.label ?? ''

/** Enquiries from the last 90 days are "recent": the people most likely to say yes. */
export const RECENT_DAYS = 90

export type EnquirySide = 'sales' | 'lettings'
export const SIDE_LABEL: Record<EnquirySide, string> = { sales: 'Sales', lettings: 'Lettings' }

// ---------- Sales or lettings ----------
// Every enquiry is sorted from what it actually says, strongest evidence first. Each answer carries the reason,
// shown on the enquiry, so a wrong one is easy to spot and move.

type SideInput = { side?: string | null; kind: string; intent?: string | null; message?: string | null }
export type SideResult = { side: EnquirySide | null; why: string }

const LET = /\b(to rent|to let|for rent|rental|rentals|renter|renters|renting|tenant|tenants|tenancy|letting|lettings|let agreed|landlord|landlords|pcm|p\.c\.m\.?|per calendar month|per month|per week|pw|p\/w|holding deposit|housing benefit|universal credit|dss|house share|flat share|room to rent)\b/i
const SALE = /\b(for sale|to buy|buying|buyer|buyers|purchase|purchasing|mortgage|mortgages|mortgage in principle|offer|offers|asking price|guide price|selling|sell|sold|vendor|vendors|freehold|leasehold|share of freehold|chain|chain[- ]free|first[- ]time buyer|cash buyer|stamp duty|conveyancing|valuation|valuations|value my|market appraisal|appraisal)\b/i
const RENTAL_VALUATION = /\b(rental valuation|rent(al)? (estimate|appraisal|valuation)|how much rent|what rent|letting valuation|let(ting)? my|rent (it|my|out)|to let out|landlord)\b/i
// The person's own circumstances, not what they want from us ("I'm currently renting" is often a buyer).
const SELF = /\b(currently renting|i('m| am) (currently )?renting|we('re| are) (currently )?renting|renting at the moment|my (current )?landlord|our (current )?landlord|currently (a )?tenants?|in rented accommodation)\b/gi

/** "Buyer", "renter", "valuation"… as a portal or form names the enquiry. */
function typeWord(t: string): EnquirySide | null {
  if (/\b(renter|tenant|rental|to rent|letting|lettings|landlord)\b/i.test(t)) return 'lettings'
  if (/\b(buyer|purchase|buy|for sale|vendor|seller|valuation|appraisal|valu)\b/i.test(t)) return 'sales'
  return null
}

/** A price: "£1,750 pcm" or "£350 pw" is a rent; "£718,000" is a sale price. */
function priceSide(t: string): { side: EnquirySide; price: string } | null {
  for (const m of t.matchAll(/£\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m)?\b([^£\n]{0,24})/gi)) {
    const after = m[3] ?? ''
    const unit = /^\s*(pcm|pw|p\/w|p\.c\.m|per\s+(calendar\s+)?month|per\s+week|a\s+month|a\s+week|monthly|weekly)/i.exec(after)?.[0].trim()
    const price = `£${m[1]}${m[2] ?? ''}${unit ? ` ${unit}` : ''}`
    if (/^\s*(pcm|pw|p\/w|p\.c\.m|per\s+(calendar\s+)?month|per\s+week|a\s+month|a\s+week|monthly|weekly|\/\s?(month|week|m|w)\b)/i.test(after)) return { side: 'lettings', price }
    const n = Number(m[1].replace(/,/g, '')) * (m[2]?.toLowerCase() === 'k' ? 1000 : m[2]?.toLowerCase() === 'm' ? 1_000_000 : 1)
    if (n >= 40_000) return { side: 'sales', price }
    if (n >= 150 && n <= 15_000 && !/deposit|fee|reservation|holding/i.test(after)) return { side: 'lettings', price }
  }
  return null
}

const labelled = (lines: string[], label: RegExp) => lines.find((l) => label.test(l))?.replace(label, '').trim() ?? null

/**
 * Sales or lettings, and why. Order: set by hand; the property it's about; the kind of enquiry (registrations,
 * valuation requests); for emails from Zoopla, OnTheMarket and the website, the listing price, the enquiry type,
 * what they asked for and the subject; then the words of the message itself; then what we know of the person.
 * `roles` are the contact's roles (e.g. "tenant,landlord") from Rentman or staff.
 */
export function sortEnquiry(e: SideInput, channel?: string | null, roles?: string | null): SideResult {
  const L = (why: string): SideResult => ({ side: 'lettings', why }), S = (why: string): SideResult => ({ side: 'sales', why })
  if (e.side === 'sales' || e.side === 'lettings') return { side: e.side, why: 'Set by hand' }
  if (channel === 'let') return L('Property to let')
  if (channel === 'sale') return S('Property for sale')
  if (e.kind === 'tenant') return L('Tenant registration')
  if (e.kind === 'buyer') return S('Buyer registration')
  const text = e.message ?? ''
  if (e.kind === 'valuation') {
    if (e.intent === 'letting') return L('Valuation: thinking of letting')
    if (e.intent === 'selling') return S('Valuation: thinking of selling')
    return RENTAL_VALUATION.test(text) ? L('Valuation: asked about rent') : S('Valuation request (not sure yet if selling or letting)')
  }
  if (e.intent === 'rent' || e.intent === 'letting') return L('Looking to rent')
  if (e.intent === 'buy' || e.intent === 'selling' || e.intent === 'sell') return S('Looking to buy or sell')

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  // 1. The listing they asked about: its price, or "for sale" / "to rent".
  for (const l of lines.filter((x) => /^(listing|about|property|price|rent)\s*:/i.test(x))) {
    const p = priceSide(l)
    if (p) return p.side === 'lettings' ? L(`Listing price ${p.price}`) : S(`Listing price ${p.price}`)
    if (/\b(to rent|to let|for rent)\b/i.test(l)) return L('Listing is to rent')
    if (/\bfor sale\b/i.test(l)) return S('Listing is for sale')
  }
  // 2. The enquiry type the portal or form gave ("Zoopla buyer enquiry", "Type of enquiry", "Wants").
  const header = lines.find((l) => /^(zoopla|onthemarket|rightmove)\b.*\b(enquiry|request)$/i.test(l))
  const kindSide = header ? typeWord(header) : null
  if (kindSide && header) return kindSide === 'lettings' ? L(header) : S(header)
  for (const [label, name] of [[/^type of enquiry\s*:/i, 'Type of enquiry'], [/^wants\s*:/i, 'Wants'], [/^looking for\s*:/i, 'Looking for']] as const) {
    const v = labelled(lines, label)
    const sd = v ? typeWord(v) : null
    if (sd && v) return sd === 'lettings' ? L(`${name}: ${v}`) : S(`${name}: ${v}`)
  }
  // 3. Any price in the message.
  const anyPrice = priceSide(text)
  // 4. The words: what they want, leaving out their own circumstances ("I'm currently renting").
  const body = lines.filter((l) => !/^(situation|my situation|their address)\s*:/i.test(l)).join('\n').replace(SELF, ' ')
  const lets = new Set([...body.matchAll(new RegExp(LET.source, 'gi'))].map((m) => m[0].toLowerCase()))
  const sales = new Set([...body.matchAll(new RegExp(SALE.source, 'gi'))].map((m) => m[0].toLowerCase()))
  if (RENTAL_VALUATION.test(body)) return L('Asked about letting or rent')
  if (anyPrice) return anyPrice.side === 'lettings' ? L(`Mentions ${anyPrice.price}`) : S(`Mentions ${anyPrice.price}`)
  if (lets.size > sales.size) return L(`Mentions ${[...lets].slice(0, 3).join(', ')}`)
  if (sales.size > lets.size) return S(`Mentions ${[...sales].slice(0, 3).join(', ')}`)
  // 5. Their situation, then what we already know about them.
  const situation = labelled(lines, /^(my )?situation\s*:/i)
  if (situation && /renter|looking to rent/i.test(situation) && !/buy|sell/i.test(situation)) return L(`Situation: ${situation}`)
  if (situation && /buyer|to sell|mortgage|investor|chain/i.test(situation)) return S(`Situation: ${situation}`)
  const r = (roles ?? '').split(',').filter(Boolean)
  if (r.length && r.every((x) => x === 'tenant' || x === 'landlord')) return L(`Known ${r.join(' and ')}`)
  if (r.length && r.every((x) => x === 'seller')) return S('Known seller')
  return { side: null, why: 'Nothing in the enquiry says' }
}

export const enquirySide = (e: SideInput, channel?: string | null, roles?: string | null) => sortEnquiry(e, channel, roles).side
