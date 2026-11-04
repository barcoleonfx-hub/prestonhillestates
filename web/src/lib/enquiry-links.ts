import 'server-only'
import { and, isNull, like, ne, or, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { enquiries, properties, type Property } from '@/db/schema'

// Working out which listing an enquiry is about, from the street and postcode area in the email.

const OUTWARD = /\b([A-Z]{1,2}\d[A-Z\d]?)(?:\s*\d[A-Z]{2})?\b/i

/** "169, Chamberlayne Avenue, Wembley, HA9 8ST" → "Chamberlayne Avenue". */
export function streetOf(text: string | null | undefined): string | null {
  if (!text) return null
  const s = text.split(',').map((p) => p.trim().replace(/^\d+[a-z]?\s+/i, '')).find((p) => /[a-z]{3,}/i.test(p) && !/^\d/.test(p))
  return s ?? null
}

/** The postcode area ("HA9") in a piece of text, if there is one. */
export function outwardOf(text: string | null | undefined): string | null {
  const m = OUTWARD.exec(text ?? '')
  return m ? m[1].toUpperCase() : null
}

/** The listing an enquiry is about, when the street and postcode area match one of ours. */
export async function matchProperty(about: string | null, postcode: string | null): Promise<string | null> {
  const street = streetOf(about)
  if (!street) return null
  const outward = (postcode ? outwardOf(postcode) : null) ?? outwardOf(about?.split(',').pop())
  const st = `%${street.toLowerCase()}%`
  const rows = await db.select({ id: properties.id, postcode: properties.postcode }).from(properties)
    .where(or(like(sql`lower(${properties.street})`, st), like(sql`lower(${properties.displayAddress})`, st)))
    .limit(5)
  const hit = rows.find((r) => !outward || (r.postcode ?? '').toUpperCase().startsWith(outward)) ?? null
  return hit?.id ?? null
}

/** The street we'd expect an enquiry about this listing to mention. */
export function streetFor(p: Pick<Property, 'street' | 'displayAddress' | 'addressLine1'>): string | null {
  return (p.street?.trim() || streetOf(p.displayAddress) || streetOf(p.addressLine1)) ?? null
}

/**
 * Enquiries not linked to any listing that mention this one's street (and, where they give one,
 * the same postcode area). Used to link older emails to a property added after they were imported.
 */
export async function unlinkedFor(p: Property) {
  const street = streetFor(p)
  if (!street || street.length < 4) return []
  const outward = outwardOf(p.postcode)
  const rows = await db.select({ id: enquiries.id, message: enquiries.message }).from(enquiries)
    .where(and(isNull(enquiries.propertyId), ne(enquiries.kind, 'valuation'), like(sql`lower(coalesce(${enquiries.message}, ''))`, `%${street.toLowerCase()}%`)))
    .limit(500)
  return rows.filter((r) => {
    if (!outward) return true
    // Only the line that names the street counts, so "Kenton Road, HA3" doesn't match a Kenton Road in HA9.
    const line = (r.message ?? '').split('\n').find((l) => l.toLowerCase().includes(street.toLowerCase())) ?? ''
    const theirs = outwardOf(line)
    return !theirs || theirs === outward
  })
}
