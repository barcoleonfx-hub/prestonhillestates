import { currentAdmin } from '@/lib/auth'
import { markAlertsRead, needingOutcome, runDueReminders, toPending, unreadAlerts } from '@/lib/appointments'

export const dynamic = 'force-dynamic'

/** Polled by every open portal tab: raises due reminders, then returns this person's unread alerts and overdue outcomes. */
export async function GET() {
  const me = await currentAdmin()
  if (!me) return Response.json({ error: 'signed out' }, { status: 401 })
  await runDueReminders()
  const [alerts, pending] = await Promise.all([unreadAlerts(me.id), needingOutcome(me.id)])
  return Response.json({ alerts, pending: pending.map(toPending), serverTime: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Acknowledge alerts ("Got it"). */
export async function POST(req: Request) {
  const me = await currentAdmin()
  if (!me) return Response.json({ error: 'signed out' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : []
  await markAlertsRead(me.id, ids)
  return Response.json({ ok: true })
}
