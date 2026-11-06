import 'server-only'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, mailMessages, properties } from '@/db/schema'
import { sortEmailText, sortEnquiry, type EnquirySide, type SideResult } from './enquiry-labels'
import { now } from './util'

// Enquiries whose saved summary doesn't say sales or lettings get three more looks, in the background:
//  1. the original email (subject and full text) from the mail store;
//  2. the address they gave, against every listing we've had (for sale or to let, live or not);
//  3. the same person's other enquiries (by contact, email or phone), when those all agree.
// The answer and the reason are saved. Each enquiry is checked once; up to 400 a run.

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i
const OUTWARD = /\b([A-Z]{1,2}\d[A-Z\d]?)\b(?:\s*\d[A-Z]{2})?\s*$/i
const STREET_WORDS = 'road|rd|avenue|ave|lane|ln|close|gardens|gdns|way|drive|dr|street|st|crescent|cres|court|ct|place|pl|grove|hill|park|rise|walk|mews|terrace|square|green|view|parade|vale|row|end|approach|chase|circus'
const STREET = new RegExp(`\\b((?:[a-z']+\\s){0,3}(?:${STREET_WORDS})(?:\\s(?:east|west|north|south))?)\\b`, 'i')
const norm = (s: string) => s.toLowerCase().replace(/\brd\b/g, 'road').replace(/\bave\b/g, 'avenue').replace(/\bgdns\b/g, 'gardens').replace(/\bst\b/g, 'street').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

type Addr = { number: string | null; street: string | null; postcode: string | null; outward: string | null }
function parseAddress(s: string): Addr {
  const pc = POSTCODE.exec(s)
  const postcode = pc ? `${pc[1]} ${pc[2]}`.toUpperCase() : null
  const outward = postcode ? postcode.split(' ')[0] : OUTWARD.exec(s.trim())?.[1]?.toUpperCase() ?? null
  const number = /(?:^|,\s*|flat\s+\w+,?\s*)(\d+[a-z]?)\b/i.exec(s)?.[1]?.toLowerCase() ?? null
  const st = STREET.exec(s.replace(/\d+[a-z]?\b/gi, ' '))?.[1]
  return { number, street: st ? norm(st).replace(/^(flat|apartment|the)\s+/, '') : null, postcode, outward }
}

type Listing = { id: string; channel: string; addr: Addr }

/** The listing(s) an address points at: same number and street, or same street in the same postcode area, all one channel. */
function listingSide(text: string, listings: Listing[]): SideResult | null {
  const lines = text.split('\n').map((l) => l.trim())
  const given = lines.map((l) => /^(about|property|address|regarding)\s*:\s*(.+)$/i.exec(l)?.[2]).filter((x): x is string => !!x && !/^£/.test(x))
  for (const g of given) {
    const a = parseAddress(g)
    if (!a.street) continue
    const sameStreet = listings.filter((l) => l.addr.street === a.street && (!a.outward || !l.addr.outward || l.addr.outward === a.outward))
    const exact = a.number ? sameStreet.filter((l) => l.addr.number === a.number) : []
    const pick = exact.length ? exact : a.postcode ? sameStreet.filter((l) => l.addr.postcode === a.postcode) : []
    const pool = pick.length ? pick : sameStreet
    const sides = new Set(pool.map((l) => l.channel))
    if (pool.length && sides.size === 1) {
      const side: EnquirySide = sides.has('let') ? 'lettings' : 'sales'
      const what = pick.length ? 'Same address as our listing' : `Our listing${pool.length > 1 ? 's' : ''} on ${g.replace(/,?\s*[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?\s*$/i, '').replace(/^\d+[a-z]?,?\s*/i, '')} ${pool.length > 1 ? 'are' : 'is'}`
      return { side, why: pick.length ? `${what} (${side === 'lettings' ? 'to let' : 'for sale'})` : `${what} ${side === 'lettings' ? 'to let' : 'for sale'}` }
    }
  }
  return null
}

const phoneKey = (p: string | null) => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null }

export async function sortFromEmails(): Promise<{ ran: boolean; checked: number; sorted: number }> {
  await ready()
  const rows = await db.select({ id: enquiries.id, kind: enquiries.kind, intent: enquiries.intent, message: enquiries.message, externalId: enquiries.externalId, contactId: enquiries.contactId, email: enquiries.email, phone: enquiries.phone })
    .from(enquiries).where(and(isNull(enquiries.side), isNull(enquiries.propertyId), isNull(enquiries.sideCheckedAt))).limit(400)
  if (!rows.length) return { ran: false, checked: 0, sorted: 0 }
  const todo = new Set(rows.filter((r) => !sortEnquiry(r).side).map((r) => r.id))

  // 1. The original emails.
  const ids = rows.filter((r) => todo.has(r.id)).map((r) => r.externalId).filter((x): x is string => !!x)
  const mails = new Map<string, { subject: string | null; body: string | null }>()
  for (let i = 0; i < ids.length; i += 100) {
    for (const m of await db.select({ id: mailMessages.messageId, subject: mailMessages.subject, body: mailMessages.body }).from(mailMessages).where(inArray(mailMessages.messageId, ids.slice(i, i + 100)))) mails.set(m.id, m)
  }
  // 2. Every listing we've had.
  const listings: Listing[] = (await db.select({ id: properties.id, channel: properties.channel, a1: properties.addressLine1, street: properties.street, postcode: properties.postcode, display: properties.displayAddress }).from(properties))
    .map((p) => {
      const a = parseAddress([p.a1, p.street, p.postcode].filter(Boolean).join(', ') || p.display || '')
      return { id: p.id, channel: p.channel, addr: { ...a, street: (p.street ? parseAddress(p.street).street ?? norm(p.street) : null) ?? a.street } }
    })
  // 3. What each person's other enquiries are.
  const everyone = todo.size ? await db.select({ id: enquiries.id, side: enquiries.side, autoSide: enquiries.autoSide, sideWhy: enquiries.sideWhy, kind: enquiries.kind, intent: enquiries.intent, message: enquiries.message, contactId: enquiries.contactId, email: enquiries.email, phone: enquiries.phone, channel: properties.channel })
    .from(enquiries).leftJoin(properties, eq(enquiries.propertyId, properties.id)) : []
  const byPerson = new Map<string, Set<EnquirySide>>()
  for (const e of everyone) {
    const s = sortEnquiry(e, e.channel).side
    if (!s) continue
    for (const k of [e.contactId && `c:${e.contactId}`, e.email && `e:${e.email.trim().toLowerCase()}`, phoneKey(e.phone) && `p:${phoneKey(e.phone)}`]) if (k) (byPerson.get(k) ?? byPerson.set(k, new Set()).get(k)!).add(s)
  }

  let sorted = 0
  const t = now()
  for (const r of rows) {
    let res: SideResult | null = null
    if (todo.has(r.id)) {
      const mail = r.externalId ? mails.get(r.externalId) : undefined
      if (mail) res = sortEmailText(mail.subject ?? '', (mail.body ?? '').slice(0, 20000))
      if (!res?.side) res = listingSide(r.message ?? '', listings)
      if (!res?.side) {
        const sides = new Set<EnquirySide>()
        for (const k of [r.contactId && `c:${r.contactId}`, r.email && `e:${r.email.trim().toLowerCase()}`, phoneKey(r.phone) && `p:${phoneKey(r.phone)}`]) if (k) for (const s of byPerson.get(k) ?? []) sides.add(s)
        if (sides.size === 1) { const s = [...sides][0]; res = { side: s, why: `Their other enquiries are ${s}` } }
      }
    }
    if (res?.side) sorted++
    await db.update(enquiries).set({ autoSide: res?.side ?? null, sideWhy: res?.side ? res.why : null, sideCheckedAt: t }).where(eq(enquiries.id, r.id))
  }
  return { ran: true, checked: rows.length, sorted }
}
