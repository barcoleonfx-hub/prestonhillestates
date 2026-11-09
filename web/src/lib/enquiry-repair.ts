import 'server-only'
import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, mailMessages } from '@/db/schema'
import { cleanLines, parseZoopla } from './email-import'

// Zoopla valuation emails used to be read without the home's address (Zoopla labels it "Property:") or Zoopla's own
// estimate. Those enquiries are read again from the original email in the mail store, and their details filled in.
// Only enquiries still missing a postcode are touched; anything staff added (notes, the valuation check) is untouched.

export async function repairZooplaValuations(): Promise<number> {
  await ready()
  const rows = await db.select({ id: enquiries.id, externalId: enquiries.externalId }).from(enquiries)
    .where(and(eq(enquiries.source, 'zoopla'), isNull(enquiries.postcode), like(enquiries.message, '%Zoopla valuation enquiry%')))
    .limit(200)
  const ids = rows.map((r) => r.externalId).filter((x): x is string => !!x)
  if (!ids.length) return 0
  const mails = await db.select({ messageId: mailMessages.messageId, subject: mailMessages.subject, body: mailMessages.body }).from(mailMessages).where(inArray(mailMessages.messageId, ids))
  const byId = new Map(mails.map((m) => [m.messageId, m]))
  let fixed = 0
  for (const r of rows) {
    const m = r.externalId ? byId.get(r.externalId) : undefined
    if (!m?.body) continue
    const lead = parseZoopla(cleanLines(m.body))
    if (!lead?.propertyPostcode) continue
    const message = [lead.about ? `About: ${lead.about}` : '', ...lead.details, m.subject ? `Email subject: ${m.subject}` : ''].filter(Boolean).join('\n').slice(0, 2000)
    await db.update(enquiries).set({ message, postcode: lead.propertyPostcode }).where(eq(enquiries.id, r.id))
    fixed++
  }
  return fixed
}
