import 'server-only'
import { and, eq, gte, inArray, like, or } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins, calls, contacts, enquiries, enquiryMessages, followupLog, leadEvents, letterBatches, mailMessages, postalLetters } from '@/db/schema'
import type { Touch } from './lead-history-rules'

// Everything already done for a person, by anyone, on any channel: emails from the portal and from Apple Mail
// (matched by their address, not only replies), WhatsApps, calls and letters, across all their enquiries.

export async function leadHistory(enquiryId: string): Promise<{ touches: Touch[]; inbound: { at: string; text: string }[] }> {
  await ready()
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId) })
  if (!e) return { touches: [], inbound: [] }
  const c = e.contactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, e.contactId) }) : null
  const emails = [...new Set([e.email, c?.email].filter(Boolean).map((x) => x!.trim().toLowerCase()))]
  const theirs = await db.select({ id: enquiries.id, createdAt: enquiries.createdAt }).from(enquiries)
    .where(or(eq(enquiries.id, e.id), e.contactId ? eq(enquiries.contactId, e.contactId) : undefined, ...emails.map((m) => eq(enquiries.email, m))))
  const ids = theirs.map((x) => x.id)
  const from = theirs.map((x) => x.createdAt).sort()[0] ?? e.createdAt
  const [msgs, mail, events, callRows, steps, letters, staff] = await Promise.all([
    db.select().from(enquiryMessages).where(and(inArray(enquiryMessages.enquiryId, ids), gte(enquiryMessages.sentAt, from))),
    emails.length ? db.select({ messageId: mailMessages.messageId, subject: mailMessages.subject, body: mailMessages.body, via: mailMessages.via, sentBy: mailMessages.sentBy, sentAt: mailMessages.sentAt })
      .from(mailMessages).where(and(eq(mailMessages.direction, 'out'), gte(mailMessages.sentAt, from), or(...emails.map((m) => like(mailMessages.toAddrs, `%${m}%`))))).limit(200) : Promise.resolve([]),
    db.select().from(leadEvents).where(and(or(inArray(leadEvents.enquiryId, ids), e.contactId ? eq(leadEvents.contactId, e.contactId) : undefined), eq(leadEvents.kind, 'whatsapp'), gte(leadEvents.createdAt, from))),
    e.contactId ? db.select().from(calls).where(and(eq(calls.contactId, e.contactId), gte(calls.createdAt, from))) : Promise.resolve([]),
    db.select().from(followupLog).where(and(inArray(followupLog.enquiryId, ids), eq(followupLog.status, 'done'), inArray(followupLog.channel, ['call', 'whatsapp']))),
    db.select({ at: postalLetters.postedAt, created: postalLetters.createdAt, batch: letterBatches.id }).from(postalLetters).innerJoin(letterBatches, eq(postalLetters.batchId, letterBatches.id))
      .where(or(inArray(postalLetters.enquiryId, ids), e.contactId ? eq(postalLetters.contactId, e.contactId) : undefined)),
    db.select({ id: admins.id, name: admins.name }).from(admins),
  ])
  const name = (id: string | null | undefined) => (id ? staff.find((s) => s.id === id)?.name ?? null : null)
  const touches: Touch[] = []
  const seen = new Set<string>()
  for (const m of msgs.filter((x) => x.direction === 'out')) {
    if (m.messageId) seen.add(m.messageId)
    touches.push({ at: m.sentAt, channel: 'email', by: m.via === 'followup' ? 'agent' : 'staff', who: name(m.sentBy), text: `${m.subject ?? ''}\n${m.body ?? ''}` })
  }
  // Sent from Apple Mail (or the portal's own mail page) to their address, not already linked to the enquiry.
  for (const m of mail) {
    if (seen.has(m.messageId)) continue
    touches.push({ at: m.sentAt, channel: 'email', by: m.via === 'portal' && !m.sentBy ? 'agent' : 'staff', who: name(m.sentBy), text: `${m.subject ?? ''}\n${m.body ?? ''}` })
  }
  for (const ev of events.filter((x) => /^WhatsApp sent/i.test(x.detail ?? ''))) touches.push({ at: ev.createdAt, channel: 'whatsapp', by: 'staff', who: name(ev.createdBy), text: ev.detail ?? '' })
  for (const k of callRows) touches.push({ at: k.createdAt, channel: 'call', by: 'staff', who: name(k.createdBy), text: k.notes ?? '' })
  // A ticked-off call or WhatsApp step, unless the call or WhatsApp itself is already here (the same one).
  // (The agent ticking a step off because it was already done isn't another touch: that's "system".)
  for (const s of steps.filter((x) => x.createdBy && x.createdBy !== 'system')) {
    const same = touches.some((t) => t.channel === s.channel && Math.abs(Date.parse(t.at) - Date.parse(s.createdAt)) < 15 * 60e3)
    if (!same) touches.push({ at: s.createdAt, channel: s.channel as Touch['channel'], by: 'staff', who: name(s.createdBy), text: s.detail ?? '' })
  }
  for (const l of letters) touches.push({ at: l.at ?? l.created, channel: 'letter', by: /^(auto|follow)-/.test(l.batch) ? 'agent' : 'staff', text: 'Letter with their property report' })
  const inbound = msgs.filter((x) => x.direction === 'in').map((m) => ({ at: m.sentAt, text: `${m.subject ?? ''}\n${m.body ?? ''}` }))
  return { touches: touches.sort((a, b) => (a.at < b.at ? -1 : 1)), inbound: inbound.sort((a, b) => (a.at < b.at ? -1 : 1)) }
}

/** The conversation so far, short, for the sense-check's second read: so it can spot repeats. */
export async function historyBrief(enquiryId: string): Promise<string> {
  const { touches, inbound } = await leadHistory(enquiryId)
  const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }
  const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })
  const all = [
    ...touches.map((t) => ({ at: t.at, line: `${when(t.at)} · ${t.channel} from ${t.by === 'agent' ? 'the agent' : t.who ?? 'the office'}: ${clip(t.text, 400)}` })),
    ...inbound.map((m) => ({ at: m.at, line: `${when(m.at)} · email FROM THEM: ${clip(m.text, 400)}` })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1)).slice(-10)
  return all.length ? all.map((x) => x.line).join('\n') : ''
}
