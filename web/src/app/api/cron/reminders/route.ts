import { timingSafeEqual } from 'node:crypto'
import { runDueReminders } from '@/lib/appointments'
import { runDueTasks } from '@/lib/contacts'
import { runRetention } from '@/lib/retention'
import { checkMailbox } from '@/lib/mailbox'
import { backfillAddresses, refreshSoldPrices } from '@/lib/sold-prices'
import { refreshPostcodeGeo } from '@/lib/postcode-geo'
import { runCampaigns } from '@/lib/campaign-data'
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
    // Email campaigns: the next few emails, within the daily limit.
    await runCampaigns().catch((e) => console.error('campaign sending failed', e))
    await refreshSoldPrices().catch((e) => console.error('sold prices refresh failed', e))
    await backfillAddresses().catch((e) => console.error('address backfill failed', e))
    await refreshPostcodeGeo().catch((e) => console.error('postcode positions failed', e))
  })
  return Response.json({ ok: true, sent, callbacks, retention, mailbox })
}
