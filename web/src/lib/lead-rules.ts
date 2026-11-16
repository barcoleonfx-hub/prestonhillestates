// The rules of the lead pipeline, kept free of server code so they're easy to test: the statuses, how events move a
// lead along, UK phone numbers in international (E.164) form, where a lead came from, and the consent wording.

export const LEAD_STATUSES = [
  { value: 'new', label: 'New', tone: 'gold' },
  { value: 'contacted', label: 'Contacted', tone: '' },
  { value: 'engaged', label: 'Engaged', tone: 'ok' },
  { value: 'viewing', label: 'Viewing / visit booked', tone: 'ok' },
  { value: 'offer', label: 'Offer', tone: 'ok' },
  { value: 'won', label: 'Won', tone: 'live' },
  { value: 'lost', label: 'Lost', tone: 'muted' },
  { value: 'dormant', label: 'Dormant', tone: 'muted' },
] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]['value']
export const isLeadStatus = (s: unknown): s is LeadStatus => LEAD_STATUSES.some((x) => x.value === s)
export const statusLabel = (s: string | null | undefined) => LEAD_STATUSES.find((x) => x.value === s)?.label ?? 'New'

/** Something that happened to a lead. */
export type LeadEventKind = 'outbound' | 'inbound' | 'booked' | 'lost' | 'won' | 'offer' | 'dormant'

/**
 * Where an event moves a lead. Moves only go forward, except that a reply wakes a dormant lead. Won and lost are
 * final unless staff change them by hand.
 */
export function nextStatus(current: string | null | undefined, event: LeadEventKind): LeadStatus {
  const cur: LeadStatus = isLeadStatus(current) ? current : 'new'
  if (cur === 'won' || cur === 'lost') return cur
  switch (event) {
    case 'outbound': return cur === 'new' || cur === 'dormant' ? 'contacted' : cur
    case 'inbound': return cur === 'new' || cur === 'contacted' || cur === 'dormant' ? 'engaged' : cur
    case 'booked': return cur === 'offer' ? cur : 'viewing'
    case 'offer': return 'offer'
    case 'won': return 'won'
    case 'lost': return 'lost'
    case 'dormant': return cur === 'contacted' || cur === 'engaged' || cur === 'new' ? 'dormant' : cur
  }
}

/** A lead nobody has heard from either way in this long goes dormant (unless it's further along). */
export const DORMANT_AFTER_DAYS = 60

/**
 * A phone number in international form (+447700900123), or null when it isn't a number we can use. UK numbers are
 * given in any of the usual ways (07700 900123, +44 7700 900123, 0044 7700..., 44 7700...); a number already
 * starting with + is accepted from other countries.
 */
export function toE164(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const plus = s.startsWith('+')
  let d = s.replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('00')) return check(`+${d.slice(2)}`)
  if (plus) return check(`+${d}`)
  if (d.startsWith('44') && (d.length === 12 || d.length === 11)) return check(`+${d}`)
  if (d.startsWith('0')) d = d.slice(1)
  // UK national numbers are 10 digits after the leading 0 (some older ones 9).
  if (d.length === 10 || d.length === 9) return check(`+44${d}`)
  return null
}
function check(e: string): string | null {
  if (!/^\+[1-9]\d{7,14}$/.test(e)) return null
  // UK: +44 then 9 or 10 digits, not starting 0.
  if (e.startsWith('+44') && !/^\+44[1-9]\d{8,9}$/.test(e)) return null
  return e
}
/** UK mobile numbers (07...): the ones WhatsApp can reach. */
export const isUkMobile = (e164: string | null | undefined) => !!e164 && /^\+447\d{9}$/.test(e164)

/** Where a lead came from, as captured by the website (first visit's advert or link, and the pages). */
export type Attribution = { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; referrer: string | null; landingPage: string | null }

/** Reads what a form sent (a JSON string or object) safely: short plain strings only, links without query strings. */
export function parseAttribution(raw: unknown): Attribution {
  let o: Record<string, unknown> = {}
  if (typeof raw === 'string') { try { o = JSON.parse(raw) as Record<string, unknown> } catch { o = {} } } else if (raw && typeof raw === 'object') o = raw as Record<string, unknown>
  const word = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/[^\w .:/+-]/g, '').slice(0, 80) || null : null)
  const link = (v: unknown) => {
    if (typeof v !== 'string' || !v.trim()) return null
    try { const u = new URL(v.trim(), 'https://example.invalid'); return `${u.host === 'example.invalid' ? '' : `${u.protocol}//${u.host}`}${u.pathname}`.slice(0, 200) } catch { return null }
  }
  return { utmSource: word(o.utm_source ?? o.utmSource), utmMedium: word(o.utm_medium ?? o.utmMedium), utmCampaign: word(o.utm_campaign ?? o.utmCampaign), referrer: link(o.referrer), landingPage: link(o.landing ?? o.landingPage) }
}

/** The words next to each consent box, stored with every consent so we can show exactly what someone agreed to. */
export const CONSENT_WORDING = {
  email: 'Email me new homes, local prices and news from Preston Hill Estates. I can unsubscribe at any time.',
  whatsapp: 'Preston Hill Estates can message me on WhatsApp about my enquiry and homes that suit me. I can reply STOP at any time.',
} as const
export type ConsentChannel = keyof typeof CONSENT_WORDING

/** "true", "on", "1", true: a ticked box. Anything else, including a missing field, is no. */
export const ticked = (v: unknown) => v === true || v === 'true' || v === 'on' || v === '1' || v === 1

/** The forms and tools that capture leads, so we can see which converts. */
export const LEAD_MAGNETS: Record<string, string> = {
  'valuation-page': 'Valuation page', 'valuation-popup': 'Valuation pop-up', 'home-valuation': 'Homepage valuation box',
  'property-enquiry': 'Property page enquiry', chat: 'Website chat', 'tenant-register': 'Tenant registration',
  'buyer-calculator': 'Borrowing calculator', 'rent-estimate': 'Rent estimate', import: 'Imported', email: 'Portal email',
}
