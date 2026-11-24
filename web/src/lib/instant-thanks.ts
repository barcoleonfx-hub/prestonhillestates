import 'server-only'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { admins, contacts, enquiries, enquiryMessages } from '@/db/schema'
import { holdForApproval } from './agent-queue'
import { logAction } from './agents'
import { enquirySide, isValuation } from './enquiry-labels'
import { addressOf, followupSettings } from './followups'
import { thankYouEmail } from './followup-rules'
import { leadHistory } from './lead-history'
import { mailPaused, noteMailError } from './mail-health'
import { mailboxStatus, sendFromMailbox } from './mailbox'
import { knownBase, oneClickUrl, unsubscribeUrl } from './property-email-data'
import { senseCheck } from './sense-check'
import { now, uid } from './util'
import { quietReason } from './whatsapp'

// The Valuation agent's first touch: a thank-you minutes after a valuation request comes in (next morning if it
// arrives at night), so they hear from us while the OnTheMarket guide is being done. No figure. Not sent if anyone
// has already been in touch. It doesn't count as contacting them: the lead stays New, on the call list and the
// "Call now" alerts, until a person calls, WhatsApps or emails.

/** Requests older than this don't get one (a person will have picked them up). */
const WINDOW_HOURS = 48

export async function runThankYous(at = new Date()): Promise<{ sent: number }> {
  const cfg = await followupSettings()
  if (!cfg.on || quietReason(at) || mailPaused(at.getTime())) return { sent: 0 }
  await ready()
  const box = await mailboxStatus().catch(() => null)
  if (!box?.hasPassword) return { sent: 0 }
  // Only requests since follow-ups were switched on, from the last 48 hours, nobody has got back to.
  const since = new Date(Math.max(at.getTime() - WINDOW_HOURS * 3600e3, Date.parse(cfg.since ?? at.toISOString()))).toISOString()
  const rows = await db.select({ e: enquiries, c: contacts, owner: admins.name }).from(enquiries).leftJoin(contacts, eq(enquiries.contactId, contacts.id)).leftJoin(admins, eq(enquiries.ownerId, admins.id))
    .where(and(gte(enquiries.createdAt, since), inArray(enquiries.status, ['new', 'contacted']))).orderBy(desc(enquiries.createdAt)).limit(40)
  let sent = 0
  for (const { e, c, owner } of rows.filter((r) => isValuation(r.e) && (r.e.email?.trim() || r.c?.email))) {
    if (mailPaused()) break
    // Once per enquiry, whichever run gets there first.
    const claim = await getClient().execute({ sql: `INSERT OR IGNORE INTO jobs (name, last_run_at) VALUES (?, ?)`, args: [`thanks-${e.id}`, now()] })
    if (claim.rowsAffected !== 1) continue
    const r = await thankOne(e, c, owner, box.user)
    if (r === 'retry') await getClient().execute({ sql: `DELETE FROM jobs WHERE name = ?`, args: [`thanks-${e.id}`] })
    if (r === 'sent') sent++
  }
  return { sent }
}

async function thankOne(e: typeof enquiries.$inferSelect, c: typeof contacts.$inferSelect | null, owner: string | null, mailbox: string): Promise<'sent' | 'retry' | 'no'> {
  const to = (e.email?.trim() || c?.email || '').trim()
  // Someone already replied, called or WhatsApped: they've heard from us.
  const { touches } = await leadHistory(e.id)
  const done = touches.find((t) => t.by === 'staff' && t.channel !== 'letter')
  if (done || c?.doNotContact || c?.marketingOptOut) {
    await logAction({ agent: 'valuation', enquiryId: e.id, kind: 'thanks', status: 'skipped', title: `No thank-you email to ${e.name}: not needed`, detail: done ? `${done.who ?? 'The office'} was already in touch by ${done.channel}.` : 'They asked not to get emails.' })
    return 'no'
  }
  const base = await knownBase()
  const { address } = addressOf({ e, c, channel: null, ownerName: owner, p: null })
  const first = (e.name.trim().split(/\s+/)[0] ?? '').replace(/^(mr|mrs|ms|miss|dr)\.?$/i, '')
  const letting = enquirySide(e, null, c?.roles) === 'lettings'
  const m = thankYouEmail({ first, address, letting, me: owner ?? '', unsubscribeUrl: c ? unsubscribeUrl(base, c.id) : null })
  const headers: Record<string, string> = c ? { 'List-Unsubscribe': `<${oneClickUrl(base, c.id)}>, <mailto:${mailbox}?subject=Unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}
  const purpose = `The instant thank-you for a new ${letting ? 'rental ' : ''}valuation request: no figure yet (the report follows once the OnTheMarket guide is done), we'll call, and they can book a visit`
  const sc = await senseCheck({ agent: 'valuation', enquiryId: e.id, channel: 'email', to, subject: m.subject, text: m.text, purpose, template: true })
  if (sc.verdict === 'block') {
    await logAction({ agent: 'valuation', enquiryId: e.id, kind: 'thanks', status: 'blocked', title: `Didn’t send the thank-you to ${e.name}`, detail: `Blocked: ${sc.summary}.`, checks: sc.checks })
    return 'no'
  }
  if (sc.verdict === 'hold') {
    await holdForApproval({ agent: 'valuation', enquiryId: e.id, title: `Thank-you email to ${e.name}`, summary: sc.summary, checks: sc.checks, payload: { channel: 'email', to, subject: m.subject, text: m.text, html: m.html, headers, purpose, template: true } })
    return 'no'
  }
  const res = await sendFromMailbox({ to: [to], subject: m.subject, text: m.text, html: m.html, by: null, headers })
  if (!res.ok) {
    if (noteMailError(res.error)) return 'retry'
    await logAction({ agent: 'valuation', enquiryId: e.id, kind: 'thanks', status: 'blocked', title: `The thank-you to ${e.name} couldn’t be sent`, detail: res.error.slice(0, 300) })
    return 'no'
  }
  // In their conversation (so replies join it and nothing repeats it), but not counted as us getting in touch:
  // the lead stays New until a person calls, WhatsApps or emails.
  await db.insert(enquiryMessages).values({ id: uid(), enquiryId: e.id, messageId: res.messageId, direction: 'out', subject: m.subject, body: m.text, fromAddr: null, via: 'followup', sentBy: null, sentAt: now(), createdAt: now() }).onConflictDoNothing()
  await logAction({ agent: 'valuation', enquiryId: e.id, kind: 'thanks', status: 'done', title: `Sent the thank-you to ${e.name}`, detail: `${address ?? e.postcode ?? ''}: ${sc.summary}.`, checks: sc.checks })
  return 'sent'
}
