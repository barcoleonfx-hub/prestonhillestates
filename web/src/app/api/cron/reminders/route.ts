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
import { repairZooplaValuations } from '@/lib/enquiry-repair'
import { after } from 'next/server'

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
    await removeLicensingFiles().catch((e) => console.error('removing old licensing files failed', e))
    // New homes to rent emailed to registered tenants who'd want them (light: a few emails every 10 minutes).
    await runTenantAlerts().catch((e) => console.error('tenant alerts failed', e))
    // Sales or lettings for enquiries whose summary doesn't say, read from the original email (light).
    await sortFromEmails().catch((e) => console.error('sorting enquiries failed', e))
    // Zoopla valuations read before their address was picked up: read again from the original email (light).
    await repairZooplaValuations().catch((e) => console.error('repairing Zoopla valuations failed', e))
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
