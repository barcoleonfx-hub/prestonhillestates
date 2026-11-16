// Checking a lead sent to /api/leads/import by another tool (kept free of server code so it's easy to test).

import { toE164 } from './lead-rules'

export const IMPORT_SOURCES = ['zoopla', 'onthemarket', 'website', 'email', 'phone', 'walk_in', 'referral', 'other'] as const
export type ImportSource = (typeof IMPORT_SOURCES)[number]
const KINDS = ['viewing', 'valuation', 'buyer', 'email'] as const
const INTENTS = ['selling', 'letting', 'unsure'] as const
export const MAX_IMPORT = 100

export type ImportLead = {
  name: string; email: string | null; phone: string | null; message: string | null; postcode: string | null
  source: ImportSource; kind: (typeof KINDS)[number]; intent: (typeof INTENTS)[number] | null
  propertyRef: string | null; externalId: string | null; consentEmail: boolean; consentWhatsapp: boolean
  attribution: { utm_source?: string; utm_medium?: string; utm_campaign?: string; referrer?: string; landing?: string }
}

const str = (v: unknown, n: number) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, n) : '')
const yes = (v: unknown) => v === true || v === 'true' || v === 'yes' || v === 1 || v === '1'

/** One lead, or why it can't be taken. Unknown fields are ignored. */
export function parseImportLead(raw: unknown): { ok: true; lead: ImportLead } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Each lead must be an object.' }
  const o = raw as Record<string, unknown>
  const name = str(o.name, 120)
  const email = str(o.email, 200).toLowerCase()
  const phone = str(o.phone, 40)
  if (!name) return { ok: false, error: 'name is required.' }
  if (!email && !phone) return { ok: false, error: 'email or phone is required.' }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: `email "${email}" isn't valid.` }
  if (phone && !toE164(phone)) return { ok: false, error: `phone "${phone}" isn't a number we can use.` }
  const source = str(o.source, 20).toLowerCase().replace(/[- ]/g, '_') || 'other'
  if (!(IMPORT_SOURCES as readonly string[]).includes(source)) return { ok: false, error: `source must be one of: ${IMPORT_SOURCES.join(', ')}.` }
  const kind = str(o.kind, 20).toLowerCase() || 'email'
  if (!(KINDS as readonly string[]).includes(kind)) return { ok: false, error: `kind must be one of: ${KINDS.join(', ')}.` }
  const intent = str(o.intent, 20).toLowerCase()
  if (intent && !(INTENTS as readonly string[]).includes(intent)) return { ok: false, error: `intent must be one of: ${INTENTS.join(', ')}.` }
  const postcode = str(o.postcode, 10).toUpperCase().replace(/\s+/g, ' ')
  const a = (k: string) => str(o[k], 200) || undefined
  return {
    ok: true,
    lead: {
      name, email: email || null, phone: phone || null, message: str(o.message, 4000) || null, postcode: postcode || null,
      source: source as ImportSource, kind: kind as ImportLead['kind'], intent: (intent || (kind === 'valuation' ? 'unsure' : null)) as ImportLead['intent'],
      propertyRef: str(o.property_ref ?? o.propertyRef, 40) || null, externalId: str(o.external_id ?? o.externalId, 120) || null,
      consentEmail: yes(o.consent_email), consentWhatsapp: yes(o.consent_whatsapp),
      attribution: { utm_source: a('utm_source'), utm_medium: a('utm_medium'), utm_campaign: a('utm_campaign'), referrer: a('referrer'), landing: a('landing_page') },
    },
  }
}

/** The body may be one lead, a list, or { leads: [...] }. */
export function leadsIn(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object' && Array.isArray((body as { leads?: unknown }).leads)) return (body as { leads: unknown[] }).leads
  if (body && typeof body === 'object') return [body]
  return null
}
