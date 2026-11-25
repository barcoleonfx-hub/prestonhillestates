import { timingSafeEqual } from 'node:crypto'
import { runDueReminders } from '@/lib/appointments'
import { runDueTasks } from '@/lib/contacts'
import { runRetention } from '@/lib/retention'
import { checkMailbox } from '@/lib/mailbox'
import { backfillAddresses, refreshSoldPrices } from '@/lib/sold-prices'
import { refreshPostcodeGeo } from '@/lib/postcode-geo'
import { runCampaigns } from '@/lib/campaign-data'
import { removeLicensingFiles } from '@/lib/cleanup'
import { runTenantAlerts } from '@/lib/tenants'
import { sortFromEmails } from '@/lib/enquiry-sort'
import { repairListingSide, repairOtmCutOff, repairPortalSmallPrint, repairZooplaValuations } from '@/lib/enquiry-repair'
import { backfillCallEnquiries } from '@/lib/call-enquiry'
import { refreshAreaPlaces } from '@/lib/area-places'
import { runFollowups } from '@/lib/followups'
import { runDirector } from '@/lib/director'
import { runBookedEmails } from '@/lib/booked-emails'
import { runThankYous } from '@/lib/instant-thanks'
import { runBriefings } from '@/lib/staff-briefing'
import { runNightShift } from '@/lib/night-shift'
import { repairFalseOpens } from '@/lib/booklet-share'
import { runReconnects } from '@/lib/reconnect'
import { runLetters } from '@/lib/letters'
import { markDormant } from '@/lib/leads'
import { after } from 'next/server'
import { getClient, ready } from '@/db/client'

export const dynamic = 'force-dynamic'

/**
 * Sends due reminders, picks up new enquiries from the mailbox and runs the 2-year clean-up, even when
 * nobody has the portal open. The server calls this itself every 2 minutes (see instrumentation.ts);
 * any outside scheduler can too, with header "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not set' }, { status: 503 })
  const given = Buffer.from((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''))
  const want = Buffer.from(secret)
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: 'unauthorised' }, { status: 401 })
  // A heartbeat, so the Agents page can show the background job is running.
  await ready().then(() => getClient().execute({ sql: `INSERT INTO jobs (name, last_run_at) VALUES ('cron', ?) ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at`, args: [new Date().toISOString()] })).catch(() => {})
  const [sent, callbacks, retention, mailbox] = await Promise.all([
    runDueReminders(), runDueTasks(), runRetention(),
    checkMailbox().catch((e) => ({ ran: true, error: String(e) })),
  ])
  // Land Registry sold prices: checked daily, reloaded when they publish (monthly). Runs after the reply.
  // Then, once, the address archive back to 1995 for the valuation address finder (a year per run until done).
  after(async () => {
    // Heavy jobs take turns: when one does real work, the rest wait for the next run (two minutes later),
    // so the server never does two memory-hungry things back to back.
    // Campaign emails are light (a dozen per run): always send them.
    await runCampaigns().catch((e) => console.error('campaign sending failed', e))
    await runLetters().catch((e) => console.error('property emails failed', e))
    // Leads nobody has heard from in 60 days go dormant (once a day, light).
    await markDormant().catch((e) => console.error('marking dormant leads failed', e))
    // New valuation requests: a thank-you within minutes, while the OnTheMarket guide is done (sense-checked).
    await runThankYous().catch((e) => console.error('thank-you emails failed', e))
    await runFollowups().catch((e) => console.error('follow-ups failed', e))
    // Booked valuations: a confirmation to the client, and a reminder the day before (sense-checked).
    await runBookedEmails().catch((e) => console.error('booking emails failed', e))
    // The night shift (1am to 6am): sorts emails, finds promises, drafts replies, builds reports, leaves the morning pack.
    await runNightShift().catch((e) => console.error('night shift failed', e))
    // The 10am staff briefings (one email per person).
    await runBriefings().catch((e) => console.error('staff briefings failed', e))
    // The Director's daily report to the office, once a day from 7:30am London.
    await runDirector().catch((e) => console.error('director report failed', e))
    await runReconnects().catch((e) => console.error('reconnect emails failed', e))
    await removeLicensingFiles().catch((e) => console.error('removing old licensing files failed', e))
    // New homes to rent emailed to registered tenants who'd want them (light: a few emails every 10 minutes).
    await runTenantAlerts().catch((e) => console.error('tenant alerts failed', e))
    // Sales or lettings for enquiries whose summary doesn't say, read from the original email (light).
    await sortFromEmails().catch((e) => console.error('sorting enquiries failed', e))
    // Zoopla valuations read before their address was picked up: read again from the original email (light).
    await repairZooplaValuations().catch((e) => console.error('repairing Zoopla valuations failed', e))
    await repairPortalSmallPrint().catch((e) => console.error('repairing portal small print failed', e))
    // Once: report "opens" recorded before the report was ever sent (link previews, the office) are cleared.
    await repairFalseOpens().catch((e) => console.error('clearing false report opens failed', e))
    // Once: OnTheMarket enquiries whose listing was cut off under a long comment.
    await repairOtmCutOff().catch((e) => console.error('repairing OnTheMarket listings failed', e))
    // Once: portal enquiries linked to the sale listing when they asked about the one to let (or the other way).
    await repairListingSide().catch((e) => console.error('repairing listing side failed', e))
    // Once: phone calls logged before calls made enquiries get theirs.
    await backfillCallEnquiries().catch((e) => console.error('enquiries from earlier calls failed', e))
    // Our own copy of places near homes (schools, shops, parks…) for the booklets: two small squares a run (light).
    await refreshAreaPlaces().catch((e) => console.error('area places failed', e))
    const heavy = [
      () => refreshSoldPrices(), // daily check, monthly reload
      () => backfillAddresses(), // once: the address archive back to 1995
      () => refreshPostcodeGeo(), // every few months
    ]
    for (const job of heavy) {
      try {
        const r = (await job()) as { ran?: boolean } | undefined
        if (r?.ran) break
      } catch (e) { console.error('background job failed', e); break }
    }
    const rss = Math.round(process.memoryUsage().rss / 1e6)
    if (rss > 380) console.warn(`background jobs: server memory ${rss} MB`)
  })
  return Response.json({ ok: true, sent, callbacks, retention, mailbox })
}
