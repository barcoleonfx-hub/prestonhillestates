import Link from 'next/link'
import type { MailThread } from '@/db/schema'
import { areaLabel } from '@/lib/mail-areas'

export const ago = (iso: string | null) => {
  if (!iso) return ''
  const h = (Date.now() - new Date(iso).getTime()) / 3600000
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`
  if (h < 24) return `${Math.round(h)} h`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'}`
}
const STATUS: Record<string, [string, string]> = {
  pending: ['Waiting for us', 'warn'], replied: ['Replied', 'ok'], done: ['Dealt with', 'ok'], info: ['For info', ''], promo: ['Newsletter', ''], sent: ['Sent', ''],
}

/** One conversation in a list. */
export function MailRow({ t, showArea = true, wait = false, compact = false }: { t: MailThread; showArea?: boolean; wait?: boolean; compact?: boolean }) {
  const [label, tone] = STATUS[t.status] ?? ['', '']
  return (
    <Link href={`/admin/mail/${t.id}`} className={`mr${t.status === 'pending' ? ' mr-pending' : ''}`}>
      <span className="mr-who">{t.counterpartName || t.counterpart || 'Unknown sender'}{t.messageCount > 1 ? <small> · {t.messageCount}</small> : null}</span>
      <span className="mr-subj">{t.subject}</span>
      <span className="mr-meta">
        {showArea ? <span className="pill">{areaLabel(t.area)}</span> : null}
        {wait && t.status === 'pending' ? <span className="pill warn">Waiting {ago(t.lastInAt)}</span> : <span className={`pill ${tone}`}>{label}</span>}
        {compact ? null : <span className="mr-when">{new Date(t.lastAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}</span>}
      </span>
    </Link>
  )
}
