import 'server-only'
import { and, eq, inArray, isNull, like, or } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, mailMessages, settings } from '@/db/schema'
import { cleanLines, fixSmallPrint, parseZoopla } from './email-import'
import { checkMailbox } from './mailbox'
import { now } from './util'

// Zoopla valuation emails used to be read without the home's address (Zoopla labels it "Property:") or Zoopla's own
// estimate. Those enquiries are read again from the original email in the mail store, and their details filled in.
// Only enquiries still missing a postcode are touched; anything staff added (notes, the valuation check) is untouched.
// The mail store only copies the Inbox, so Zoopla emails a mail rule filed into a folder are read again from the
// mailbox itself, once (the last 60 days of every checked folder), only to fill these in: nothing new is added.

const LOOKED = 'repair_zoopla_lookback'

export async function repairZooplaValuations(): Promise<number> {
  await ready()
  const rows = await db.select({ id: enquiries.id, externalId: enquiries.externalId }).from(enquiries)
    .where(and(eq(enquiries.source, 'zoopla'), isNull(enquiries.postcode), like(enquiries.message, '%Zoopla valuation enquiry%')))
    .limit(200)
  const ids = rows.map((r) => r.externalId).filter((x): x is string => !!x)
  if (!rows.length) return 0
  const mails = !ids.length ? [] : await db.select({ messageId: mailMessages.messageId, subject: mailMessages.subject, body: mailMessages.body }).from(mailMessages).where(inArray(mailMessages.messageId, ids))
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
  if (fixed < rows.length) {
    // Taken before it starts, so two runs never do it at once; given back if the mailbox couldn't be read.
    const mine = await db.insert(settings).values({ key: LOOKED, value: now(), updatedAt: now() }).onConflictDoNothing()
    if (mine.rowsAffected) {
      const r = await checkMailbox({ lookBackDays: 60, repairOnly: true }).catch(() => ({ ran: false, error: 'failed' }) as { ran: boolean; error?: string })
      if (!r.ran || r.error) await db.delete(settings).where(eq(settings.key, LOOKED))
    }
  }
  return fixed
}

/**
 * OnTheMarket valuation emails used to be read with the small print at the bottom ("...Registered Office: 5 Churchill
 * Place, London E14 5HU") as the home's address. Those are put right from what was saved: their own address becomes
 * the home to value. Only enquiries that still have the small print are touched.
 */
export async function repairPortalSmallPrint(): Promise<number> {
  await ready()
  const rows = await db.select({ id: enquiries.id, message: enquiries.message, postcode: enquiries.postcode }).from(enquiries)
    .where(or(like(enquiries.message, '%trade marks%'), like(enquiries.message, '%Registered Office%'), like(enquiries.message, '%Churchill Place%')))
    .limit(500)
  let fixed = 0
  for (const r of rows) {
    const f = fixSmallPrint(r.message, r.postcode)
    if (!f) continue
    await db.update(enquiries).set({ message: f.message, postcode: f.postcode }).where(eq(enquiries.id, r.id))
    fixed++
  }
  return fixed
}
