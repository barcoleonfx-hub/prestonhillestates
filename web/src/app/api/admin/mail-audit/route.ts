import { currentAdmin } from '@/lib/auth'
import { auditCsv, auditState } from '@/lib/mail-audit'

export const dynamic = 'force-dynamic'

/** The audit summary as a spreadsheet: categories, monthly totals and sender domains only. Admins only. */
export async function GET() {
  const me = await currentAdmin()
  if (!me || me.role !== 'admin') return new Response('Admins only', { status: 403 })
  const s = await auditState()
  if (s.status !== 'done' || !s.result) return new Response('No audit yet', { status: 404 })
  return new Response(auditCsv(s.result), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="inbox-audit-${s.finishedAt?.slice(0, 10)}.csv"` },
  })
}
