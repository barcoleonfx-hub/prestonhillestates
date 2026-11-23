import 'server-only'
import { and, eq, inArray, isNull, like, or } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, mailMessages, properties, settings } from '@/db/schema'
import { matchProperty } from './enquiry-links'
import { hintFrom } from './listing-match'
import { cleanLines, fixSmallPrint, parseOnTheMarket, parseZoopla } from './email-import'
import { repairOtmRow } from './email-intake'
import { checkMailbox } from './mailbox'
import { now } from './util'

// Zoopla valuation emails used to be read without the home's address (Zoopla labels it "Property:") or Zoopla's own
// estimate. Those enquiries are read again from the original email in the mail store, and their details filled in.
// Only enquiries still missing a postcode are touched; anything staff added (notes, the valuation check) is untouched.
// The mail store only copies the Inbox, so Zoopla emails a mail rule filed into a folder are read again from the
// mailbox itself, once (the last 60 days of every checked folder), only to fill these in: nothing new is added.

const LOOKED_YEAR = 'repair_zoopla_lookback_year'

export async function repairZooplaValuations(): Promise<number> {
  await ready()
  const rows = await db.select({ id: enquiries.id, externalId: enquiries.externalId }).from(enquiries)
    .where(and(eq(enquiries.source, 'zoopla'), isNull(enquiries.postcode), or(like(enquiries.message, '%Zoopla valuation enquiry%'), like(enquiries.message, '%aluation%'))))
    .limit(500)
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
    // Taken before it starts, so two runs never do it at once; given back if the mailbox couldn't be read. The first
    // look went back 60 days; the second goes back over a year, reading only Zoopla and OnTheMarket emails.
    const mine = await db.insert(settings).values({ key: LOOKED_YEAR, value: now(), updatedAt: now() }).onConflictDoNothing()
    if (mine.rowsAffected) {
      const r = await checkMailbox({ lookBackDays: 400, repairOnly: true }).catch(() => ({ ran: false, error: 'failed' }) as { ran: boolean; error?: string })
      if (!r.ran || r.error) await db.delete(settings).where(eq(settings.key, LOOKED_YEAR))
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

const OTM_LOOKED = 'repair_otm_cutoff_v1'

/**
 * OnTheMarket enquiries whose long comment was taken for the email's small print lost the listing underneath it (and
 * showed only the person's own address). Read again once: from the mail store where it has them, then the last 90
 * days of the mailbox for any it doesn't. Only enquiries without a property line are touched.
 */
export async function repairOtmCutOff(): Promise<number> {
  await ready()
  if (await db.query.settings.findFirst({ where: eq(settings.key, OTM_LOOKED) })) return 0
  // Taken before it starts, so two runs never do it at once; given back if the mailbox couldn't be read.
  const mine = await db.insert(settings).values({ key: OTM_LOOKED, value: now(), updatedAt: now() }).onConflictDoNothing()
  if (!mine.rowsAffected) return 0
  const rows = await db.select({ externalId: enquiries.externalId, message: enquiries.message }).from(enquiries)
    .where(and(eq(enquiries.source, 'onthemarket'), isNull(enquiries.propertyId))).limit(1000)
  const ids = rows.filter((r) => !/^property:/im.test(r.message ?? '')).map((r) => r.externalId).filter((x): x is string => !!x)
  let fixed = 0
  const mails = !ids.length ? [] : await db.select({ messageId: mailMessages.messageId, subject: mailMessages.subject, body: mailMessages.body }).from(mailMessages).where(inArray(mailMessages.messageId, ids))
  for (const m of mails) {
    const lead = m.body ? parseOnTheMarket(cleanLines(m.body)) : null
    if (!lead) continue
    const row = { source: 'onthemarket' as const, key: m.messageId, intent: lead.intent, about: lead.about, propertyPostcode: lead.propertyPostcode, name: lead.name, message: [...lead.details, m.subject ? `Email subject: ${m.subject}` : ''].filter(Boolean).join('\n') }
    if (await repairOtmRow(row).catch(() => false)) fixed++
  }
  if (fixed < ids.length) {
    const r = await checkMailbox({ lookBackDays: 90, repairOnly: true }).catch(() => ({ ran: false, error: 'failed' }) as { ran: boolean; error?: string })
    if (!r.ran || r.error) await db.delete(settings).where(eq(settings.key, OTM_LOOKED))
  }
  return fixed
}

// v2: also reads "Lettings enquiry" in the email subject (OnTheMarket viewing requests say nothing else).
const SIDE_FIXED = 'repair_listing_side_v2'

/**
 * Portal enquiries linked to the wrong one of two listings on the same street (a tenant enquiry linked to the flat
 * for sale in the same block). Once: each portal enquiry whose email says sale or let, but whose listing is the
 * other, is linked again to the right one, or unlinked if we have no listing on that side.
 */
export async function repairListingSide(): Promise<number> {
  await ready()
  const mine = await db.insert(settings).values({ key: SIDE_FIXED, value: now(), updatedAt: now() }).onConflictDoNothing()
  if (!mine.rowsAffected) return 0
  const rows = await db.select({ id: enquiries.id, message: enquiries.message, channel: properties.channel })
    .from(enquiries).innerJoin(properties, eq(enquiries.propertyId, properties.id))
    .where(and(eq(enquiries.kind, 'email'), inArray(enquiries.source, ['zoopla', 'onthemarket'])))
  let fixed = 0
  for (const r of rows) {
    const msg = r.message ?? ''
    const intent = /tenant|renter/i.test(msg.split('\n').find((l) => /^(zoopla|onthemarket) .*(enquiry|request)$/i.test(l)) ?? '') ? 'rent' : null
    const hint = hintFrom(msg, intent)
    if (!hint.channel || hint.channel === (r.channel === 'let' ? 'let' : 'sale')) continue
    const about = /^(?:about|property):\s*(.+)$/im.exec(msg)?.[1] ?? null
    const propertyId = await matchProperty(about, null, hint).catch(() => null)
    await db.update(enquiries).set({ propertyId }).where(eq(enquiries.id, r.id))
    fixed++
  }
  return fixed
}
