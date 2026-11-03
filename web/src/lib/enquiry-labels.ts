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
