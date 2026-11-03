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
