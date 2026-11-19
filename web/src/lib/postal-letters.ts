import 'server-only'
// Printed letters to people who asked for a valuation: each one personal, with a QR code that opens their own
// property report (the valuation booklet at its private link) and an invitation to a free visit. Staff choose who
// to write to, print the batch on A4 (the address shows through a DL window envelope) and mark it as posted, which
// notes the letter on each lead so nobody is written to twice by mistake.

import QRCode from 'qrcode'
import { and, desc, eq, gte, inArray, isNotNull, ne } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { appointments, contacts, enquiries, leadEvents, letterBatches, postalLetters, settings } from '@/db/schema'
import { ENQUIRY_SOURCES, isValuation } from './enquiry-labels'
import { homeOf } from './enquiry-workspace'
import { shareFor } from './booklet-share'
import { knownBase } from './property-email-data'
import { leadEvent } from './leads'
import { addressLines, chooseByDefault, fillLetter, firstName, LETTER_AFTER, LETTER_BEFORE, postable, shortHome } from './postal-letter-rules'
import { now, uid } from './util'

export type LetterCandidate = {
  id: string; name: string; address: string; lines: string[]; postable: boolean; home: string | null
  source: string; createdAt: string; status: string; booked: boolean; lastLetterAt: string | null; tick: boolean; why: string | null
}

/** Valuation enquiries from the last `days` days that we may write to, newest first, with who to tick. */
export async function letterCandidates(days = 90): Promise<LetterCandidate[]> {
  await ready()
  const since = new Date(Date.now() - days * 864e5).toISOString()
  const rows = (await db.select({ e: enquiries, c: contacts }).from(enquiries).leftJoin(contacts, eq(enquiries.contactId, contacts.id))
    .where(and(gte(enquiries.createdAt, since), inArray(enquiries.kind, ['valuation', 'email']))).orderBy(desc(enquiries.createdAt)).limit(500))
    .filter(({ e, c }) => isValuation(e) && !c?.doNotContact && e.outcome !== 'not_interested' && e.outcome !== 'do_not_call')
  const ids = rows.map((r) => r.e.id)
  if (!ids.length) return []
  const [booked, letters] = await Promise.all([
    db.select({ id: appointments.enquiryId }).from(appointments).where(and(inArray(appointments.enquiryId, ids), eq(appointments.kind, 'valuation'), ne(appointments.status, 'cancelled'))),
    db.select({ id: postalLetters.enquiryId, at: postalLetters.postedAt }).from(postalLetters).where(and(inArray(postalLetters.enquiryId, ids), isNotNull(postalLetters.postedAt))),
  ])
  const bookedIds = new Set(booked.map((b) => b.id))
  // A letter about any of a person's enquiries counts for all of them.
  const personOf = new Map(rows.map(({ e }) => [e.id, e.contactId ?? e.id]))
  const last = new Map<string, string>()
  for (const l of letters) { const k = personOf.get(l.id) ?? l.id; if (l.at && (!last.get(k) || l.at > last.get(k)!)) last.set(k, l.at) }
  const seen = new Set<string>()
  return rows.flatMap(({ e, c }) => {
    // One letter per person: their newest valuation enquiry (the list is newest first).
    const person = e.contactId ?? e.id
    if (seen.has(person)) return []
    seen.add(person)
    const h = homeOf(e, true)
    // Their address from the enquiry, or what's on their record (sellers who rang in, or an address staff corrected).
    const fromEnquiry = addressLines(h.address, h.postcode)
    const fromRecord = addressLines(c?.address ?? null, h.postcode)
    const lines = postable(fromEnquiry) ? fromEnquiry : postable(fromRecord) ? fromRecord : fromEnquiry.length ? fromEnquiry : fromRecord
    const ok = postable(lines)
    const r = { postable: ok, booked: bookedIds.has(e.id), lastLetterAt: last.get(person) ?? null, status: e.status }
    return [{
      id: e.id, name: e.name, address: lines.join(', '), lines, home: shortHome(lines),
      source: ENQUIRY_SOURCES[e.source] ?? e.source, createdAt: e.createdAt, ...r, ...chooseByDefault(r),
    }]
  })
}

/** The words used last time (or the starting ones). */
export async function letterText(): Promise<{ before: string; after: string }> {
  await ready()
  const row = await db.query.settings.findFirst({ where: eq(settings.key, 'valuation_letter_text') })
  try { const v = JSON.parse(row?.value ?? '{}'); return { before: v.before || LETTER_BEFORE, after: v.after || LETTER_AFTER } } catch { return { before: LETTER_BEFORE, after: LETTER_AFTER } }
}

/** Saves a printing: the letters as they'll be printed (addresses as corrected), and keeps the words for next time. */
export async function createBatch(p: { items: { id: string; address: string }[]; before: string; after: string; sender: string; by: string }): Promise<string | null> {
  await ready()
  const ids = p.items.map((i) => i.id)
  if (!ids.length) return null
  const es = await db.select().from(enquiries).where(inArray(enquiries.id, ids))
  const byId = new Map(es.map((e) => [e.id, e]))
  const at = now(), batchId = uid()
  const rows = p.items.flatMap((i) => {
    const e = byId.get(i.id)
    const lines = addressLines(i.address)
    if (!e || !postable(lines)) return []
    return [{ id: uid(), batchId, enquiryId: e.id, contactId: e.contactId, name: e.name, address: lines.join('\n'), home: shortHome(lines), createdAt: at }]
  })
  if (!rows.length) return null
  // An address staff completed here is kept on their record, so next time it's already right.
  for (const r of rows) {
    if (!r.contactId) continue
    const c = await db.query.contacts.findFirst({ where: eq(contacts.id, r.contactId) })
    if (c && !postable(addressLines(c.address))) await db.update(contacts).set({ address: r.address.replace(/\n/g, ', '), updatedAt: at }).where(eq(contacts.id, c.id))
  }
  await db.insert(letterBatches).values({ id: batchId, sender: p.sender, beforeText: p.before, afterText: p.after, createdBy: p.by, createdAt: at })
  await db.insert(postalLetters).values(rows)
  const v = JSON.stringify({ before: p.before, after: p.after })
  await db.insert(settings).values({ key: 'valuation_letter_text', value: v, updatedAt: at }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: at } })
  return batchId
}

export type PrintedLetter = { id: string; name: string; first: string; lines: string[]; home: string | null; before: string[]; after: string[]; report: string; reportShort: string; qr: string }

/** A batch ready to print: each letter's words, and the QR code for its report. */
export async function batchView(id: string): Promise<{ id: string; sender: string; createdAt: string; postedAt: string | null; letters: PrintedLetter[] } | null> {
  await ready()
  const b = await db.query.letterBatches.findFirst({ where: eq(letterBatches.id, id) })
  if (!b) return null
  const rows = await db.select().from(postalLetters).where(eq(postalLetters.batchId, id)).orderBy(postalLetters.name)
  const base = await knownBase()
  const letters = await Promise.all(rows.map(async (r) => {
    const report = `${base}/report/${await shareFor(r.enquiryId)}?utm_source=letter`
    const first = firstName(r.name)
    return {
      id: r.id, name: r.name, first, lines: r.address.split('\n'), home: r.home,
      before: fillLetter(b.beforeText, { first, home: r.home }), after: fillLetter(b.afterText, { first, home: r.home }),
      report, reportShort: report.replace(/^https?:\/\//, '').replace(/\?.*$/, ''),
      qr: await QRCode.toDataURL(report, { margin: 0, width: 360, errorCorrectionLevel: 'M', color: { dark: '#1C1B19', light: '#FFFFFF' } }),
    }
  }))
  return { id: b.id, sender: b.sender, createdAt: b.createdAt, postedAt: b.postedAt, letters }
}

/** The letters are in the post: note it on each lead (it counts as us getting in touch). */
export async function markPosted(batchId: string, by: string): Promise<number> {
  await ready()
  const b = await db.query.letterBatches.findFirst({ where: eq(letterBatches.id, batchId) })
  if (!b || b.postedAt) return 0
  const at = now()
  await db.update(letterBatches).set({ postedAt: at, postedBy: by }).where(eq(letterBatches.id, batchId))
  await db.update(postalLetters).set({ postedAt: at }).where(eq(postalLetters.batchId, batchId))
  const rows = await db.select().from(postalLetters).where(eq(postalLetters.batchId, batchId))
  for (const r of rows) {
    await db.insert(leadEvents).values({ id: uid(), enquiryId: r.enquiryId, contactId: r.contactId, kind: 'letter', detail: `Letter posted: their property report and an invitation to a free valuation\nTo ${r.address.replace(/\n/g, ', ')}`, createdBy: by, createdAt: at })
    await leadEvent(r.enquiryId, 'outbound', { by, at, detail: 'letter posted' }).catch(() => {})
  }
  return rows.length
}

/** Recent printings, newest first. */
export async function recentBatches(limit = 10) {
  await ready()
  const bs = await db.select().from(letterBatches).orderBy(desc(letterBatches.createdAt)).limit(limit)
  if (!bs.length) return []
  const counts = await db.select({ b: postalLetters.batchId }).from(postalLetters).where(inArray(postalLetters.batchId, bs.map((b) => b.id)))
  return bs.map((b) => ({ ...b, count: counts.filter((c) => c.b === b.id).length }))
}
