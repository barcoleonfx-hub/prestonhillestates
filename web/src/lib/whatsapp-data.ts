import 'server-only'
// What the WhatsApp button needs for one lead or person: their number, whether we may message them, the
// ready-written messages, and our live homes (for "a new home that might suit you").

import { and, asc, desc, eq, gte, lt, ne, or } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { appointments, type Contact, type Enquiry } from '@/db/schema'
import { isValuation } from './enquiry-labels'
import { toE164 } from './lead-rules'
import { listPublished } from './properties'
import { knownBase, listingOptions } from './property-email-data'
import { waBlocked, waTemplates, type WaContext, type WaTemplate } from './whatsapp'

export type WaHome = { id: string; channel: 'sale' | 'let'; label: string; line: string; url: string }
export type WaProps = {
  enquiryId: string | null; contactId: string | null; e164: string | null; first: string; me: string
  templates: WaTemplate[]; homes: WaHome[]; consent: boolean; blocked: string | null
}

/** Our live homes as one line each, with a link that shows "WhatsApp" as the source when they enquire. */
export async function waHomes(): Promise<WaHome[]> {
  const [live, base] = await Promise.all([listPublished({}).catch(() => []), knownBase()])
  return listingOptions(live, base).map((o) => ({
    id: o.id, channel: o.channel, label: o.label,
    line: [o.card.address, o.card.priceText, o.card.specs.slice(0, 2).join(', ')].filter(Boolean).join(', '),
    url: `${o.card.url}${o.card.url.includes('?') ? '&' : '?'}utm_source=whatsapp`,
  }))
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/London' })

/** Their next booked appointment, or failing that the last one in the past fortnight. */
async function appointmentFor(enquiryId: string | null, contactId: string | null): Promise<WaContext['appointment']> {
  const who = enquiryId && contactId ? or(eq(appointments.enquiryId, enquiryId), eq(appointments.contactId, contactId)) : enquiryId ? eq(appointments.enquiryId, enquiryId) : contactId ? eq(appointments.contactId, contactId) : null
  if (!who) return null
  const nowIso = new Date().toISOString()
  const live = and(who, ne(appointments.status, 'cancelled'))
  const [next] = await db.select().from(appointments).where(and(live, gte(appointments.startsAt, nowIso))).orderBy(asc(appointments.startsAt)).limit(1)
  const a = next ?? (await db.select().from(appointments).where(and(live, lt(appointments.startsAt, nowIso), gte(appointments.startsAt, new Date(Date.now() - 14 * 864e5).toISOString()))).orderBy(desc(appointments.startsAt)).limit(1))[0]
  if (!a) return null
  return { kind: a.kind === 'valuation' ? 'valuation' : a.kind === 'viewing' ? 'viewing' : 'other', when: when(a.startsAt), address: a.address, past: !next }
}

export async function waFor(p: { enquiry?: Enquiry | null; contact?: Contact | null; me: string; address?: string | null; isLet?: boolean; homes?: WaHome[] }): Promise<WaProps> {
  await ready()
  const e = p.enquiry ?? null, c = p.contact ?? null
  const e164 = c?.phoneE164 ?? toE164(e?.phone ?? c?.phone)
  const name = (e?.name ?? c?.name ?? '').trim()
  const first = /^(mr|mrs|ms|miss|dr)\.?$/i.test(name.split(/\s+/)[0] ?? '') ? '' : name.split(/\s+/)[0] ?? ''
  const kind: WaContext['kind'] = !e ? 'general' : isValuation(e) ? 'valuation' : e.kind === 'buyer' ? 'buyer' : e.kind === 'viewing' ? 'viewing' : 'general'
  const appointment = await appointmentFor(e?.id ?? null, c?.id ?? e?.contactId ?? null)
  return {
    enquiryId: e?.id ?? null, contactId: c?.id ?? e?.contactId ?? null, e164, first, me: p.me,
    templates: waTemplates({ first, me: p.me, kind, isLet: p.isLet, address: p.address ?? null, appointment }),
    homes: p.homes ?? [], consent: !!c?.whatsappOptInAt, blocked: waBlocked({ e164, doNotContact: c?.doNotContact, stoppedAt: c?.whatsappStoppedAt }),
  }
}
