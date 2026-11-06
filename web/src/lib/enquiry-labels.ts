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

const LET_WORDS = /\b(to rent|to let|for rent|rental|renting|rent it|pcm|p\.c\.m|per calendar month|tenant|tenants|tenancy|landlord|landlords|letting|lettings|let agreed|holding deposit|furnished)\b/i
const SALE_WORDS = /\b(for sale|to buy|buying|buyer|purchase|purchasing|mortgage|offer|asking price|selling|sell|sold|freehold|leasehold|share of freehold|chain|first[- ]time buyer|cash buyer)\b/i

/**
 * Sales or lettings? Set by hand if staff have moved it; otherwise from the property it's about, what kind of
 * enquiry it is, what the person said they wanted, and finally the words of their message. Null if it can't tell.
 */
export function enquirySide(e: { side?: string | null; kind: string; intent?: string | null; message?: string | null }, channel?: string | null): EnquirySide | null {
  if (e.side === 'sales' || e.side === 'lettings') return e.side
  if (channel === 'let') return 'lettings'
  if (channel === 'sale') return 'sales'
  if (e.kind === 'tenant') return 'lettings'
  if (e.kind === 'buyer') return 'sales'
  if (e.intent === 'rent' || e.intent === 'letting') return 'lettings'
  if (e.intent === 'buy' || e.intent === 'selling' || e.intent === 'sell') return 'sales'
  const t = e.message ?? ''
  const isLet = LET_WORDS.test(t), isSale = SALE_WORDS.test(t)
  return isLet && !isSale ? 'lettings' : isSale && !isLet ? 'sales' : null
}
