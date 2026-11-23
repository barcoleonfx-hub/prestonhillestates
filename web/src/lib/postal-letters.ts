import 'server-only'
// Printed letters to people who asked for a valuation: each one personal, with a QR code that opens their own
// property report (the valuation booklet at its private link) and an invitation to a free visit. Staff choose who
// to write to, print the batch on A4 (the address shows through a DL window envelope) and mark it as posted, which
// notes the letter on each lead so nobody is written to twice by mistake.

import QRCode from 'qrcode'
import { and, desc, eq, gte, inArray, isNotNull, like, ne, or } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { appointments, contacts, enquiries, leadEvents, letterBatches, postalLetters, settings } from '@/db/schema'
import { ENQUIRY_SOURCES, isValuation } from './enquiry-labels'
import { homeOf } from './enquiry-workspace'
import { shareFor } from './booklet-share'
import { knownBase } from './property-email-data'
import { leadEvent } from './leads'
import { addressLines, chooseByDefault, fillLetter, firstName, LETTER_AFTER, LETTER_BEFORE, OLD_LETTER, postable, shortHome, streetOf } from './postal-letter-rules'
import { AREAS } from './areas'
import { lrTypeFor, salesOnStreet } from './sold-prices'
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
  try {
    const v = JSON.parse(row?.value ?? '{}')
    // Words never changed from the old starting ones get the new starting ones.
    return { before: v.before && v.before !== OLD_LETTER.before ? v.before : LETTER_BEFORE, after: v.after && v.after !== OLD_LETTER.after ? v.after : LETTER_AFTER }
  } catch { return { before: LETTER_BEFORE, after: LETTER_AFTER } }
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

/** The facts printed beside the QR code: real sales on or near their road, and who's looking in their area. */
export type LetterFacts = {
  street: string | null; area: string | null
  sales: { where: string; when: string; price: number }[]
  salesWhere: 'street' | 'near' | null
  typical: { price: number; count: number; where: string } | null
  wanting: { count: number; who: 'buyers' | 'tenants' } | null
}
export type PrintedLetter = { id: string; name: string; first: string; lines: string[]; home: string | null; before: string[]; after: string[]; report: string; reportShort: string; qr: string; facts: LetterFacts }

const outwardOf = (pc: string | null) => (pc ?? '').toUpperCase().match(/^([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}$/)?.[1] ?? null
/** "THE DRIVE" or "the Drive" → "The Drive". */
const titleCase = (t: string) => (/[a-z]/.test(t) && /^[A-Z]/.test(t) ? t : t.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()))
const monthYear = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** People registered with us in the last year looking to buy (or rent) in this postcode district or area. */
async function wantingIn(outward: string, area: string | null, who: 'buyer' | 'tenant'): Promise<number> {
  const since = new Date(Date.now() - 365 * 864e5).toISOString()
  const places = [outward, ...AREAS.filter((a) => a.districts.includes(outward)).map((a) => a.name), ...(area ? [area] : [])]
  const rows = await db.select({ id: contacts.id }).from(contacts).where(and(
    like(contacts.roles, `%${who}%`), eq(contacts.doNotContact, false), gte(contacts.lastContactAt, since),
    or(...places.map((p) => like(contacts.areas, `%${p}%`)), like(contacts.address, `%${outward} %`), like(contacts.address, `%${outward}`)),
  ))
  return new Set(rows.map((r) => r.id)).size
}

/** What's printed beside the QR code for one home. Nothing is invented: anything we can't find is left out. */
async function letterFacts(lines: string[], letting: boolean, homeType: string | null): Promise<LetterFacts> {
  const pc = lines.find((l) => /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(l.trim())) ?? null
  const outward = outwardOf(pc)
  const street = streetOf(lines)
  const text = lines.join(' ').toLowerCase()
  const area = (outward ? AREAS.filter((a) => a.districts.includes(outward)) : []).sort((a, b) => Number(text.includes(b.name.toLowerCase())) - Number(text.includes(a.name.toLowerCase())))[0]?.name ?? null
  const empty: LetterFacts = { street, area, sales: [], salesWhere: null, typical: null, wanting: null }
  if (!pc || !outward) return empty
  const [sold, wanting] = await Promise.all([
    letting ? Promise.resolve(null) : salesOnStreet(street, pc, lrTypeFor(homeType)).catch(() => null),
    wantingIn(outward, area, letting ? 'tenant' : 'buyer').catch(() => 0),
  ])
  const onStreet = sold?.onStreet ?? []
  const pick = (onStreet.length ? onStreet : sold?.near?.recent ?? []).slice().sort((a, b) => (a.soldOn < b.soldOn ? 1 : -1)).slice(0, 3)
  return {
    street, area,
    // On their own road the road name is in the heading, so each sale says what kind of home it was instead.
    sales: pick.map((x) => ({ where: onStreet.length ? x.typeLabel : titleCase(x.street ?? x.postcode), when: monthYear(x.soldOn), price: x.price })),
    salesWhere: pick.length ? (onStreet.length ? 'street' : 'near') : null,
    typical: sold?.near?.stats.median12 && sold.near.stats.count12 >= 5 ? { price: sold.near.stats.median12, count: sold.near.stats.count12, where: sold.near.stats.label.replace(/^in\s+/, '') } : null,
    wanting: wanting >= 3 ? { count: wanting, who: letting ? 'tenants' : 'buyers' } : null,
  }
}

/** A batch ready to print: each letter's words, and the QR code for its report. */
export async function batchView(id: string): Promise<{ id: string; sender: string; createdAt: string; postedAt: string | null; letters: PrintedLetter[] } | null> {
  await ready()
  const b = await db.query.letterBatches.findFirst({ where: eq(letterBatches.id, id) })
  if (!b) return null
  const rows = await db.select().from(postalLetters).where(eq(postalLetters.batchId, id)).orderBy(postalLetters.name)
  const base = await knownBase()
  const es = rows.length ? await db.select({ id: enquiries.id, intent: enquiries.intent, message: enquiries.message }).from(enquiries).where(inArray(enquiries.id, rows.map((r) => r.enquiryId))) : []
  // Their kind of home, where the enquiry says ("Type: Semi-detached house"), so houses are compared with houses.
  const typeOf = new Map(es.map((e) => [e.id, /^(?:type|type of property|property type)\s*:\s*(.+)$/im.exec(e.message ?? '')?.[1]?.trim() ?? null]))
  const letting = new Map(es.map((e) => [e.id, e.intent === 'letting' || /\b(letting|rental valuation|rent(al)? estimate|landlord|to let)\b/i.test(e.message ?? '')]))
  const letters = await Promise.all(rows.map(async (r) => {
    const report = `${base}/report/${await shareFor(r.enquiryId)}?utm_source=letter`
    const first = firstName(r.name)
    const lines = r.address.split('\n')
    const facts = await letterFacts(lines, letting.get(r.enquiryId) ?? false, typeOf.get(r.enquiryId) ?? null)
    const v = { first, home: r.home, street: facts.street, area: facts.area }
    return {
      id: r.id, name: r.name, first, lines: r.address.split('\n'), home: r.home, facts,
      before: fillLetter(b.beforeText, v), after: fillLetter(b.afterText, v),
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
