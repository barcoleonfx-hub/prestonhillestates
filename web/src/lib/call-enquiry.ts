import 'server-only'
// A phone call, walk-in or email from someone asking about one of our homes (or about selling or letting theirs) is
// an enquiry, just like one from the website or a portal: it shows in the enquiry lists with the home it's about, and
// the WhatsApp and email messages know which home that is. They've already spoken to us, so it starts as Engaged
// (no automatic follow-up emails) and belongs to whoever took the call.

import { and, desc, eq, gte, isNull } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { calls, contacts, enquiries, properties } from '@/db/schema'
import { gbp } from './booklet'
import { leadEvent } from './leads'
import { now, uid } from './util'

const SOURCE: Record<string, string> = { in: 'phone', walk_in: 'walk_in', email_in: 'email' }
const HOW: Record<string, string> = { in: 'Phone call', walk_in: 'Came into the office', email_in: 'Emailed us' }
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i

/** Calls that make an enquiry: someone getting in touch with us, as a buyer, tenant, seller or landlord. */
export const callMakesEnquiry = (direction: string, callerType: string) => direction in SOURCE && ['buyer', 'tenant', 'seller', 'landlord'].includes(callerType)

/** What the enquiry is: a viewing (a particular home), a registration, or a valuation. */
export function enquiryShape(callerType: string, propertyId: string | null): { kind: string; intent: string } {
  if (callerType === 'seller') return { kind: 'valuation', intent: 'selling' }
  if (callerType === 'landlord') return { kind: 'valuation', intent: 'letting' }
  if (propertyId) return { kind: 'viewing', intent: callerType === 'tenant' ? 'rent' : 'buy' }
  return callerType === 'tenant' ? { kind: 'tenant', intent: 'rent' } : { kind: 'buyer', intent: 'buy' }
}

/**
 * The enquiry for a logged call: a new one, or the open one from the last 30 days about the same home (or of the same
 * kind, when there's no home), so ringing twice about Milton Avenue doesn't make two.
 */
export async function enquiryFromCall(p: { contactId: string; callerType: string; direction: string; propertyId: string | null; notes: string | null; by: string; at?: string }): Promise<string | null> {
  await ready()
  if (!callMakesEnquiry(p.direction, p.callerType)) return null
  const c = await db.query.contacts.findFirst({ where: eq(contacts.id, p.contactId) })
  if (!c) return null
  const at = p.at ?? now()
  const { kind, intent } = enquiryShape(p.callerType, p.propertyId)
  const since = new Date(Date.parse(at) - 30 * 864e5).toISOString()
  const [open] = await db.select({ id: enquiries.id }).from(enquiries)
    .where(and(eq(enquiries.contactId, p.contactId), gte(enquiries.createdAt, since), isNull(enquiries.outcome),
      p.propertyId ? eq(enquiries.propertyId, p.propertyId) : and(isNull(enquiries.propertyId), eq(enquiries.kind, kind))))
    .orderBy(desc(enquiries.createdAt)).limit(1)
  if (open) {
    await db.update(enquiries).set({ handled: true }).where(eq(enquiries.id, open.id))
    await leadEvent(open.id, 'inbound', { by: p.by, at, detail: (HOW[p.direction] ?? 'Call').toLowerCase() }).catch(() => {})
    return open.id
  }
  const home = p.propertyId ? await db.query.properties.findFirst({ where: eq(properties.id, p.propertyId) }) : null
  const wants = [c.minBeds ? `${c.minBeds}+ bedrooms` : '', c.maxPrice ? `up to ${gbp(c.maxPrice)}` : '', c.areas ? `in ${c.areas}` : ''].filter(Boolean).join(', ')
  const pc = (c.address ?? '').match(POSTCODE)
  const message = [
    `${HOW[p.direction] ?? 'Call'} (logged by staff)`,
    home ? `Property: ${home.displayAddress ?? home.street ?? ''} (${home.ref})` : '',
    kind === 'valuation' && c.address ? `Their address: ${c.address}` : '',
    wants ? `Looking for: ${wants}` : '',
    c.position ? `Position: ${c.position}` : '',
    p.notes ? `Notes: ${p.notes}` : '',
  ].filter(Boolean).join('\n')
  const id = uid()
  await db.insert(enquiries).values({
    id, propertyId: p.propertyId, kind, intent, name: c.name, phone: c.phone, email: c.email, message, contactId: c.id,
    postcode: kind === 'valuation' && pc ? `${pc[1]} ${pc[2]}`.toUpperCase() : null,
    source: SOURCE[p.direction] ?? 'phone', handled: true, ownerId: p.by, createdAt: at,
  })
  // They got in touch and we spoke: Engaged straight away.
  await leadEvent(id, 'inbound', { by: p.by, at, detail: (HOW[p.direction] ?? 'Call').toLowerCase() }).catch(() => {})
  return id
}

/**
 * Once: calls logged before calls made enquiries (in the last 120 days), where nothing else was logged for that
 * person around the same time, get their enquiry now, dated when the call was.
 */
export async function backfillCallEnquiries(): Promise<{ ran: boolean; made?: number }> {
  await ready()
  const claim = await getClient().execute({ sql: `INSERT INTO jobs (name, last_run_at) VALUES ('call_enquiries_v1', ?) ON CONFLICT(name) DO NOTHING`, args: [now()] })
  if (claim.rowsAffected !== 1) return { ran: false }
  const since = new Date(Date.now() - 120 * 864e5).toISOString()
  const rows = await db.select().from(calls).where(gte(calls.createdAt, since)).orderBy(calls.createdAt).limit(2000)
  let made = 0
  for (const r of rows) {
    if (!callMakesEnquiry(r.direction, r.callerType)) continue
    const day = 864e5, t = Date.parse(r.createdAt)
    const near = await db.select({ id: enquiries.id, createdAt: enquiries.createdAt }).from(enquiries).where(eq(enquiries.contactId, r.contactId))
    if (near.some((e) => Math.abs(Date.parse(e.createdAt) - t) < day)) continue
    if (await enquiryFromCall({ contactId: r.contactId, callerType: r.callerType, direction: r.direction, propertyId: r.propertyId, notes: r.notes, by: r.createdBy, at: r.createdAt })) made++
  }
  return { ran: true, made }
}
