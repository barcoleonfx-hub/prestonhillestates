import 'server-only'
// The lead pipeline on the server: events that move a lead along (emails, calls, replies, viewings), changes made by
// hand, consent, leads going quiet, and one timeline per lead built from everything we hold.

import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { admins, appointments, calls, consents, contacts, enquiries, enquiryMessages, enquiryNotes, leadEvents } from '@/db/schema'
import { CONSENT_WORDING, DORMANT_AFTER_DAYS, LEAD_MAGNETS, nextStatus, parseAttribution, statusLabel, ticked, toE164, type Attribution, type ConsentChannel, type LeadEventKind, type LeadStatus } from './lead-rules'
import { now, uid } from './util'

const WHY: Record<LeadEventKind, string> = {
  outbound: 'we got in touch', inbound: 'they replied', booked: 'a viewing or visit was booked', offer: 'an offer was made',
  won: 'marked as won', lost: 'marked as lost', dormant: `no contact for ${DORMANT_AFTER_DAYS} days`,
}

/**
 * Something happened on a lead: we contacted them, they replied, a viewing was booked... Updates the first/last
 * contact times and moves the status on (logged on the timeline). The first person to contact a lead with no owner
 * becomes its owner.
 */
export async function leadEvent(enquiryId: string, kind: LeadEventKind, opts: { by?: string | null; at?: string; detail?: string } = {}) {
  await ready()
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId) })
  if (!e) return
  const at = opts.at ?? now()
  const to = nextStatus(e.status, kind)
  const patch: Partial<typeof enquiries.$inferInsert> = {}
  if (kind === 'outbound') {
    if (!e.firstContactedAt) patch.firstContactedAt = at
    if (!e.lastOutboundAt || e.lastOutboundAt < at) patch.lastOutboundAt = at
    if (!e.ownerId && opts.by && opts.by !== 'system') patch.ownerId = opts.by
  }
  if (kind === 'inbound' && (!e.lastInboundAt || e.lastInboundAt < at)) patch.lastInboundAt = at
  if (to !== e.status) patch.status = to
  if (Object.keys(patch).length) await db.update(enquiries).set(patch).where(eq(enquiries.id, enquiryId))
  if (to !== e.status) {
    await db.insert(leadEvents).values({ id: uid(), enquiryId, contactId: e.contactId, kind: 'status', detail: `${statusLabel(e.status)} → ${statusLabel(to)}: ${opts.detail ?? WHY[kind]}`, createdBy: opts.by ?? 'system', createdAt: at })
  }
}

/** An event about a person (a call) applies to their most recent open lead. */
export async function contactLeadEvent(contactId: string, kind: LeadEventKind, opts: { by?: string | null; at?: string; detail?: string } = {}) {
  await ready()
  const open = await db.select({ id: enquiries.id }).from(enquiries)
    .where(and(eq(enquiries.contactId, contactId), sql`${enquiries.status} NOT IN ('won', 'lost')`)).orderBy(desc(enquiries.createdAt)).limit(1)
  if (open[0]) await leadEvent(open[0].id, kind, opts)
}

/** Staff set the status by hand (any status, including back from won or lost). */
export async function setLeadStatus(enquiryId: string, status: LeadStatus, by: string) {
  await ready()
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId) })
  if (!e || e.status === status) return
  await db.update(enquiries).set({ status }).where(eq(enquiries.id, enquiryId))
  await db.insert(leadEvents).values({ id: uid(), enquiryId, contactId: e.contactId, kind: 'status', detail: `${statusLabel(e.status)} → ${statusLabel(status)}: changed by hand`, createdBy: by, createdAt: now() })
}

export async function setLeadOwner(enquiryId: string, ownerId: string | null, by: string) {
  await ready()
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId) })
  if (!e || e.ownerId === ownerId) return
  const who = ownerId ? (await db.query.admins.findFirst({ where: eq(admins.id, ownerId) }))?.name ?? 'someone' : 'nobody'
  await db.update(enquiries).set({ ownerId }).where(eq(enquiries.id, enquiryId))
  await db.insert(leadEvents).values({ id: uid(), enquiryId, contactId: e.contactId, kind: 'owner', detail: `Now looked after by ${who}`, createdBy: by, createdAt: now() })
}

/** Where a new lead came from: the advert or link, the pages, and which form or tool. */
export async function setLeadSource(enquiryId: string, a: Attribution, magnet: keyof typeof LEAD_MAGNETS | string | null) {
  await ready()
  await db.update(enquiries).set({ utmSource: a.utmSource, utmMedium: a.utmMedium, utmCampaign: a.utmCampaign, referrer: a.referrer, landingPage: a.landingPage, leadMagnet: magnet }).where(eq(enquiries.id, enquiryId))
}

/**
 * Consent ticked on a form: logged with the exact wording and where, and set on the person. An unticked box isn't
 * a "no": it leaves any earlier consent as it was. Ticking "email me" again after unsubscribing counts as opting
 * back in.
 */
export async function recordConsents(input: { contactId: string | null; enquiryId?: string | null; email?: boolean; whatsapp?: boolean; source: string }) {
  if (!input.contactId) return
  await ready()
  const at = now()
  for (const ch of ['email', 'whatsapp'] as ConsentChannel[]) {
    if (!input[ch]) continue
    await db.insert(consents).values({ id: uid(), contactId: input.contactId, enquiryId: input.enquiryId ?? null, channel: ch, granted: true, wording: CONSENT_WORDING[ch], source: input.source, createdAt: at })
    await db.update(contacts).set(ch === 'email' ? { emailOptInAt: at, marketingOptOut: false, consentSource: input.source, updatedAt: at } : { whatsappOptInAt: at, consentSource: input.source, updatedAt: at }).where(eq(contacts.id, input.contactId))
    await db.insert(leadEvents).values({ id: uid(), enquiryId: input.enquiryId ?? null, contactId: input.contactId, kind: 'consent', detail: `Agreed to ${ch === 'email' ? 'emails' : 'WhatsApp messages'} (${input.source})`, createdBy: 'system', createdAt: at })
  }
}

/** Consent withdrawn (unsubscribe, STOP, or staff on their behalf): logged, and the opt-in cleared. */
export async function withdrawConsent(contactId: string, channel: ConsentChannel, source: string, by = 'system') {
  await ready()
  const at = now()
  await db.insert(consents).values({ id: uid(), contactId, enquiryId: null, channel, granted: false, wording: null, source, createdAt: at })
  await db.update(contacts).set(channel === 'email' ? { emailOptInAt: null, marketingOptOut: true, updatedAt: at } : { whatsappOptInAt: null, updatedAt: at }).where(eq(contacts.id, contactId))
  await db.insert(leadEvents).values({ id: uid(), enquiryId: null, contactId, kind: 'consent', detail: `Stopped ${channel === 'email' ? 'emails' : 'WhatsApp messages'} (${source})`, createdBy: by, createdAt: at })
}

/**
 * A lead from a website form: where it came from (advert, pages, which form) and any consent ticked. `field` reads
 * the submitted form (FormData or JSON); `magnet` is the form's own tag unless the page sent a known one.
 */
export async function captureLead(p: { enquiryId: string | null; contactId: string | null; field: (k: string) => unknown; magnet: string }) {
  try {
    const sent = p.field('magnet')
    const magnet = typeof sent === 'string' && sent in LEAD_MAGNETS ? sent : p.magnet
    if (p.enquiryId) await setLeadSource(p.enquiryId, parseAttribution(p.field('attribution')), magnet)
    await recordConsents({ contactId: p.contactId, enquiryId: p.enquiryId, email: ticked(p.field('consent_email')), whatsapp: ticked(p.field('consent_whatsapp')), source: LEAD_MAGNETS[magnet] ?? magnet })
  } catch (e) { console.error('recording the lead source and consent failed', e) }
}

/** Keeps the international phone number in step with the one we hold. */
export async function syncPhoneE164(contactId: string | null) {
  if (!contactId) return
  const c = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) })
  if (!c) return
  const e = toE164(c.phone)
  if (e !== c.phoneE164) await db.update(contacts).set({ phoneE164: e }).where(eq(contacts.id, contactId))
}

/** Once a day: leads nobody has heard from either way in 60 days go dormant. */
export async function markDormant(): Promise<{ ran: boolean; count?: number }> {
  await ready()
  const nowIso = now()
  const claim = await getClient().execute({
    sql: `INSERT INTO jobs (name, last_run_at) VALUES ('lead_dormant', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`,
    args: [nowIso, new Date(Date.now() - 23 * 3600_000).toISOString()],
  })
  if (claim.rowsAffected !== 1) return { ran: false }
  const cutoff = new Date(Date.now() - DORMANT_AFTER_DAYS * 86400_000).toISOString()
  const quiet = await db.select({ id: enquiries.id }).from(enquiries)
    .where(and(inArray(enquiries.status, ['new', 'contacted', 'engaged']), sql`max(coalesce(${enquiries.lastInboundAt}, ''), coalesce(${enquiries.lastOutboundAt}, ''), ${enquiries.createdAt}) < ${cutoff}`)).limit(500)
  for (const q of quiet) await leadEvent(q.id, 'dormant', { at: nowIso })
  return { ran: true, count: quiet.length }
}

// ---------- the timeline ----------

export type TimelineItem = { at: string; kind: 'created' | 'email-in' | 'email-out' | 'note' | 'call' | 'appointment' | 'status' | 'owner' | 'consent' | 'whatsapp' | 'import' | 'other'; title: string; body: string | null; by: string | null }

/** Everything that's happened on a lead, newest first: emails, notes, calls, viewings, status changes, consent. */
export async function leadTimeline(enquiryId: string): Promise<TimelineItem[]> {
  await ready()
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId) })
  if (!e) return []
  const [msgs, notes, evs, appts, callRows, staff] = await Promise.all([
    db.select().from(enquiryMessages).where(eq(enquiryMessages.enquiryId, enquiryId)),
    db.select().from(enquiryNotes).where(eq(enquiryNotes.enquiryId, enquiryId)),
    db.select().from(leadEvents).where(e.contactId ? or(eq(leadEvents.enquiryId, enquiryId), and(eq(leadEvents.contactId, e.contactId), isNull(leadEvents.enquiryId))) : eq(leadEvents.enquiryId, enquiryId)),
    db.select().from(appointments).where(e.contactId ? or(eq(appointments.enquiryId, enquiryId), eq(appointments.contactId, e.contactId)) : eq(appointments.enquiryId, enquiryId)),
    e.contactId ? db.select().from(calls).where(eq(calls.contactId, e.contactId)) : Promise.resolve([]),
    db.select({ id: admins.id, name: admins.name }).from(admins),
  ])
  const who = (id: string | null | undefined) => (!id || id === 'system' ? null : staff.find((s) => s.id === id)?.name ?? null)
  const short = (t: string | null | undefined, n = 280) => { const x = (t ?? '').trim(); return x ? (x.length > n ? `${x.slice(0, n)}…` : x) : null }
  const items: TimelineItem[] = [
    { at: e.createdAt, kind: 'created', title: `Enquiry received${e.leadMagnet && LEAD_MAGNETS[e.leadMagnet] ? ` · ${LEAD_MAGNETS[e.leadMagnet]}` : ` · ${e.source}`}${e.utmSource ? ` (${[e.utmSource, e.utmMedium, e.utmCampaign].filter(Boolean).join(' / ')})` : ''}`, body: short(e.message), by: null },
    ...msgs.map((m) => ({ at: m.sentAt, kind: (m.direction === 'in' ? 'email-in' : 'email-out') as TimelineItem['kind'], title: m.direction === 'in' ? `They replied: ${m.subject ?? ''}` : `Email sent: ${m.subject ?? ''}`, body: short(m.body), by: who(m.sentBy) })),
    // Notes that just record an email being sent repeat the email itself.
    ...notes.filter((n) => !/^Email sent:/.test(n.body)).map((n) => ({ at: n.createdAt, kind: 'note' as const, title: 'Note', body: short(n.body, 600), by: who(n.createdBy) })),
    ...evs.map((v) => ({ at: v.createdAt, kind: (['status', 'owner', 'consent', 'whatsapp', 'import'].includes(v.kind) ? v.kind : 'other') as TimelineItem['kind'], title: v.detail ?? v.kind, body: null, by: who(v.createdBy) })),
    ...appts.map((a) => ({ at: a.createdAt, kind: 'appointment' as const, title: `${a.kind === 'valuation' ? 'Valuation' : 'Viewing'} booked for ${new Date(a.startsAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}${a.status === 'cancelled' ? ' (cancelled)' : ''}`, body: short(a.outcomeNotes ?? a.notes), by: who(a.createdBy) })),
    ...callRows.map((c) => ({ at: c.createdAt, kind: 'call' as const, title: `${c.direction === 'out' ? 'Called them' : 'They called'}${c.nextStep ? ` · next: ${c.nextStep.replace(/_/g, ' ')}` : ''}`, body: short(c.notes), by: who(c.createdBy) })),
  ]
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}
