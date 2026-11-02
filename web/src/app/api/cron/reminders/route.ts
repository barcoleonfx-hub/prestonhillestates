import { timingSafeEqual } from 'node:crypto'
import { runDueReminders } from '@/lib/appointments'

export const dynamic = 'force-dynamic'

/**
 * Sends due reminders even when nobody has the portal open.
 * Call every 5 minutes from any scheduler with header "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not set' }, { status: 503 })
  const given = Buffer.from((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''))
  const want = Buffer.from(secret)
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: 'unauthorised' }, { status: 401 })
  const sent = await runDueReminders()
  return Response.json({ ok: true, sent })
}
