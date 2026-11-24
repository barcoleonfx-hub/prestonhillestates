import 'server-only'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { db, getClient, ready } from '@/db/client'
import { contacts, enquiries } from '@/db/schema'
import { anthropicKey } from './anthropic-key'
import { isValuation } from './enquiry-labels'
import { followupSettings } from './followups'
import { mailboxStatus } from './mailbox'

// Are the agents actually running? What each depends on (the background job, the follow-ups switch, the office
// mailbox, the Claude key), and where the recent valuation leads stand.

export type Check = { name: string; ok: boolean; detail: string; href?: string }
export const RECENT_DAYS = 30

/** Recent valuation leads still worth working: no reply yet, not booked, won or lost, not asked to stop. */
async function recentValuations() {
  const since = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString()
  const rows = await db.select({ e: enquiries, c: contacts }).from(enquiries).leftJoin(contacts, eq(enquiries.contactId, contacts.id))
    .where(and(gte(enquiries.createdAt, since), inArray(enquiries.status, ['new', 'contacted']))).orderBy(desc(enquiries.createdAt)).limit(500)
  return rows.filter(({ e, c }) => isValuation(e) && !e.lastInboundAt && !c?.doNotContact && e.outcome !== 'not_interested' && e.outcome !== 'do_not_call').map((r) => r.e)
}

/** Recent valuation leads that have never been followed up (from before follow-ups were switched on). */
export async function notStarted() {
  await ready()
  return (await recentValuations()).filter((e) => !e.followupState)
}

/** Recent valuation leads still on the earlier follow-ups (from before the Valuation agent's plan). */
export async function onOldPlan() {
  await ready()
  return (await recentValuations()).filter((e) => e.followupState === 'active' && e.followupPlan !== 'valuation')
}

export async function agentStatus() {
  await ready()
  const [beat, cfg, box, leads] = await Promise.all([
    getClient().execute(`SELECT last_run_at FROM jobs WHERE name = 'cron'`).then((r) => (r.rows[0]?.last_run_at as string | undefined) ?? null).catch(() => null),
    followupSettings(), mailboxStatus().catch(() => null), recentValuations(),
  ])
  const mins = beat ? Math.round((Date.now() - Date.parse(beat)) / 60e3) : null
  const key = anthropicKey()
  const checks: Check[] = [
    beat && mins! <= 10
      ? { name: 'Background job', ok: true, detail: `Running: last ran ${mins! <= 1 ? 'just now' : `${mins} minutes ago`}.` }
      : { name: 'Background job', ok: false, detail: beat ? `Last ran ${mins} minutes ago: it should run every 2 minutes. Check the service is up on Render.` : 'Hasn’t run since this update. It starts a minute or two after a deploy; if this stays, CRON_SECRET is missing on Render (Environment), and nothing automatic can run without it.' },
    cfg.on
      ? { name: 'Automatic follow-ups', ok: true, detail: `On since ${new Date(cfg.since ?? cfg.at ?? Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' })}: new enquiries are followed up.`, href: '/admin/follow-ups' }
      : { name: 'Automatic follow-ups', ok: false, detail: 'Off: the Valuation agent won’t call-list, email or write to anyone. Switch it on at the top of the Follow-ups page.', href: '/admin/follow-ups' },
    box?.hasPassword && box.enabled !== false && !box.lastError
      ? { name: 'Office mailbox', ok: true, detail: `Connected as ${box.user}.`, href: '/admin/email-inbox' }
      : { name: 'Office mailbox', ok: false, detail: !box?.hasPassword ? 'Not connected: no email (and no daily report) can be sent. Connect it on the Email inbox page.' : box.lastError ? `Connected, but the last check failed: ${box.lastError}` : 'Switched off on the Email inbox page.', href: '/admin/email-inbox' },
    'key' in key
      ? { name: 'Claude (the second read)', ok: true, detail: 'The API key is set: every agent email gets a second read, and the Director writes its view.' }
      : { name: 'Claude (the second read)', ok: false, detail: 'No API key, so fixed-wording emails go after passing every rule (no second read) and the daily report uses a plain summary. Add ANTHROPIC_API_KEY on Render.' },
  ]
  const onPlan = leads.filter((e) => e.followupState === 'active' && e.followupPlan === 'valuation').length
  const onOld = leads.filter((e) => e.followupState === 'active' && e.followupPlan !== 'valuation').length
  const never = leads.filter((e) => !e.followupState).length
  return { checks, leads: { total: leads.length, onPlan, onOld, never, other: leads.length - onPlan - onOld - never }, followupsOn: cfg.on }
}
