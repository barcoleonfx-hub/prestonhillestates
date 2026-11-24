import 'server-only'
import { and, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins, appointments, contacts, enquiries } from '@/db/schema'
import { holdForApproval } from './agent-queue'
import { logAction } from './agents'
import { recordOutgoing } from './enquiry-thread'
import { enquirySide } from './enquiry-labels'
import { bookingEmail } from './followup-rules'
import { followupSettings } from './followups'
import { mailboxStatus, sendFromMailbox } from './mailbox'
import { knownBase, oneClickUrl, unsubscribeUrl } from './property-email-data'
import { senseCheck } from './sense-check'
import { fmtWhen } from './time'
import { mailPaused, noteMailError } from './mail-health'
import { now } from './util'
import { quietReason } from './whatsapp'

// The Valuation agent's emails about a booked valuation: a confirmation soon after it's booked, and a reminder the
// day before. Sense-checked like every agent email; one try each (marked before it goes, so never sent twice).

const HOUR = 3600e3

export async function runBookedEmails(at = new Date()): Promise<{ sent: number }> {
  const cfg = await followupSettings()
  if (!cfg.on || quietReason(at) || mailPaused(at.getTime())) return { sent: 0 }
  await ready()
  const box = await mailboxStatus().catch(() => null)
  if (!box?.hasPassword) return { sent: 0 }
  const t = at.getTime()
  const iso = (ms: number) => new Date(ms).toISOString()
  const [toConfirm, toRemind] = await Promise.all([
    db.select().from(appointments).where(and(eq(appointments.kind, 'valuation'), eq(appointments.status, 'scheduled'), isNotNull(appointments.enquiryId), isNull(appointments.clientConfirmedAt), gte(appointments.startsAt, iso(t + 2 * HOUR)), gte(appointments.createdAt, iso(t - 2 * 24 * HOUR)))).limit(10),
    db.select().from(appointments).where(and(eq(appointments.kind, 'valuation'), eq(appointments.status, 'scheduled'), isNotNull(appointments.enquiryId), isNull(appointments.clientRemindedAt), gte(appointments.startsAt, iso(t + 12 * HOUR)), lte(appointments.startsAt, iso(t + 36 * HOUR)), lte(appointments.createdAt, iso(t - 20 * HOUR)))).limit(10),
  ])
  let sent = 0
  for (const [kind, list] of [['confirm', toConfirm], ['reminder', toRemind]] as const) {
    for (const a of list) {
      if (mailPaused()) break
      // Mark it first: one try only (put back if the mail server is down).
      const col = kind === 'confirm' ? { clientConfirmedAt: now() } : { clientRemindedAt: now() }
      const where = kind === 'confirm' ? isNull(appointments.clientConfirmedAt) : isNull(appointments.clientRemindedAt)
      const claim = await db.update(appointments).set(col).where(and(eq(appointments.id, a.id), where))
      if (!claim.rowsAffected) continue
      if (await sendOne(kind, a, box.user)) sent++
    }
  }
  return { sent }
}

async function sendOne(kind: 'confirm' | 'reminder', a: typeof appointments.$inferSelect, mailbox: string): Promise<boolean> {
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, a.enquiryId!) })
  if (!e) return false
  const c = e.contactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, e.contactId) }) : null
  const to = (a.contactEmail || e.email || c?.email || '').trim()
  if (!to) return false
  const staff = await db.query.admins.findFirst({ where: eq(admins.id, a.staffId) })
  const base = await knownBase()
  const when = fmtWhen(a.startsAt)
  const first = (e.name.trim().split(/\s+/)[0] ?? '').replace(/^(mr|mrs|ms|miss|dr)\.?$/i, '')
  const letting = enquirySide(e, null, c?.roles) === 'lettings'
  const m = bookingEmail(kind, { first, when, address: a.address, staff: staff?.name ?? '', letting, me: staff?.name ?? '', unsubscribeUrl: c ? unsubscribeUrl(base, c.id) : null })
  const headers: Record<string, string> = c ? { 'List-Unsubscribe': `<${oneClickUrl(base, c.id)}>, <mailto:${mailbox}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}
  const purpose = `${kind === 'confirm' ? 'Confirming' : 'Reminding them of'} the valuation visit booked for ${when}${a.address ? ` at ${a.address}` : ''}, with ${staff?.name ?? 'our team'}`
  const sc = await senseCheck({ agent: 'valuation', enquiryId: e.id, channel: 'email', to, subject: m.subject, text: m.text, purpose, template: true, chase: false })
  const label = kind === 'confirm' ? 'booking confirmation' : 'day-before reminder'
  if (sc.verdict === 'block') {
    await logAction({ agent: 'valuation', enquiryId: e.id, kind: 'email', status: 'blocked', title: `Didn’t send the ${label} to ${e.name}`, detail: `Blocked: ${sc.summary}.`, checks: sc.checks })
    return false
  }
  if (sc.verdict === 'hold') {
    await holdForApproval({ agent: 'valuation', enquiryId: e.id, title: `${label[0].toUpperCase()}${label.slice(1)} to ${e.name}`, summary: sc.summary, checks: sc.checks, payload: { channel: 'email', to, subject: m.subject, text: m.text, html: m.html, headers, purpose, template: true, chase: false } })
    return false
  }
  const res = await sendFromMailbox({ to: [to], subject: m.subject, text: m.text, html: m.html, by: null, headers })
  if (!res.ok) {
    // The mailbox itself is down: try again next run rather than lose it.
    if (noteMailError(res.error)) {
      await db.update(appointments).set(kind === 'confirm' ? { clientConfirmedAt: null } : { clientRemindedAt: null }).where(eq(appointments.id, a.id))
      return false
    }
    await logAction({ agent: 'valuation', enquiryId: e.id, kind: 'email', status: 'blocked', title: `The ${label} to ${e.name} couldn’t be sent`, detail: res.error.slice(0, 300) })
    return false
  }
  await recordOutgoing(e.id, { messageId: res.messageId, subject: m.subject, body: m.text, by: null, via: 'followup' })
  await logAction({ agent: 'valuation', enquiryId: e.id, kind: 'email', status: 'done', title: `Sent the ${label} to ${e.name}`, detail: `${when}: ${sc.summary}.`, checks: sc.checks })
  return true
}
