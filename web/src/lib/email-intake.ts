import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { contacts, enquiries } from '@/db/schema'
import { upsertContact } from '@/lib/contacts'
import { matchProperty } from '@/lib/enquiry-links'
import type { ImportRow } from '@/lib/email-import'
import { uid } from '@/lib/util'

// Turning one parsed email into an enquiry linked to a contact. Used by the bulk import and the live mailbox.

/** "I am a first-time buyer" → "First time buyer", to match the positions used in the call log. */
export function position(situation: string | null): string | null {
  if (!situation) return null
  const t = situation.toLowerCase()
  if (/first[- ]time/.test(t)) return 'First time buyer'
  if (/cash/.test(t)) return 'Cash buyer'
  if (/under offer/.test(t)) return 'Under offer on theirs'
  if (/(have|has|got) a property to sell|need to sell|property to sell/.test(t)) return 'Property to sell'
  if (/nothing to sell|not need to sell|don.t need to sell/.test(t)) return 'Nothing to sell'
  if (/mortgage/.test(t)) return 'Mortgage agreed in principle'
  if (/invest/.test(t)) return 'Investor'
  return situation.replace(/^i am an?\s+/i, '').replace(/^./, (c) => c.toUpperCase()).slice(0, 80)
}

export const SOURCE_FOR_CONTACT: Record<string, string | null> = { zoopla: 'Zoopla', onthemarket: 'OnTheMarket', website: 'Our website', email: null }

/**
 * Saves one email as an enquiry on the date it was sent, creating or updating the person it came from.
 * Returns null if that email is already in the portal (matched by its Message-ID).
 * `startedAt` is when this batch began, so contacts created during it can have their date set to the email's.
 */
/** A Zoopla valuation saved before its address could be read: fill in the address and details. Adds nothing new. */
export async function repairZooplaRow(r: ImportRow): Promise<boolean> {
  if (r.source !== 'zoopla' || r.intent !== 'valuation' || !r.propertyPostcode) return false
  const res = await db.update(enquiries).set({ message: [r.about ? `About: ${r.about}` : '', r.message].filter(Boolean).join('\n').slice(0, 2000), postcode: r.propertyPostcode })
    .where(and(eq(enquiries.externalId, r.key), isNull(enquiries.postcode)))
  return res.rowsAffected > 0
}

export async function saveEmailRow(r: ImportRow, opts: { by: string | null; handled: boolean; startedAt: string }): Promise<{ enquiryId: string; contactId: string; propertyId: string | null } | null> {
  if (await db.query.enquiries.findFirst({ where: eq(enquiries.externalId, r.key) })) return null
  const contactId = await upsertContact({
    name: r.name, phone: r.phone, email: r.email,
    role: r.intent === 'rent' ? 'tenant' : r.intent === 'valuation' ? 'seller' : 'buyer',
    source: SOURCE_FOR_CONTACT[r.source] ?? null, by: opts.by, touch: false,
  })
  // Their "last contact" is the latest email's date, not today, so the 2-year rule treats them correctly.
  // Never move an existing contact's date backwards.
  const c = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) })
  if (c) {
    const createdByImport = c.createdAt >= opts.startedAt
    const known = c.lastContactAt && (!createdByImport || c.lastContactAt < opts.startedAt) ? c.lastContactAt : null
    const last = known && known > r.date ? known : r.date
    if (last !== c.lastContactAt) await db.update(contacts).set({ lastContactAt: last }).where(eq(contacts.id, contactId))
  }
  // Fill in what the lead told us, without overwriting anything staff have already recorded.
  if (c) {
    const patch: { position?: string; address?: string } = {}
    const pos = position(r.situation)
    if (pos && !c.position) patch.position = pos
    if (r.applicantAddress && !c.address) patch.address = r.applicantAddress
    if (Object.keys(patch).length) await db.update(contacts).set(patch).where(eq(contacts.id, contactId))
  }
  const propertyId = await matchProperty(r.about, r.propertyPostcode).catch(() => null)
  const id = uid()
  const res = await db.insert(enquiries).values({
    id, propertyId, postcode: r.intent === 'valuation' ? r.propertyPostcode : null, kind: 'email', source: r.source, externalId: r.key, contactId,
    name: r.name, phone: r.phone, email: r.email, handled: opts.handled, createdAt: r.date,
    message: [r.about ? `About: ${r.about}` : '', r.message].filter(Boolean).join('\n').slice(0, 2000),
  }).onConflictDoNothing()
  if (!res.rowsAffected) {
    // Already here. A Zoopla valuation saved before its address could be read gets the address now.
    await repairZooplaRow(r)
    return null
  }
  return { enquiryId: id, contactId, propertyId }
}
