import Link from 'next/link'
import { count, eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { listBetween, needingOutcome, toPending } from '@/lib/appointments'
import { addDays, londonToIso, todayLondon } from '@/lib/time'
import { LogoMark } from '@/components/Logo'
import { logout } from '../actions'
import { NavLinks } from './NavLinks'
import { AlertCenter } from './AlertCenter'

export const dynamic = 'force-dynamic'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()
  await ready()
  const today = todayLondon()
  const [[{ n }], todays, mine, overdueAll] = await Promise.all([
    db.select({ n: count() }).from(enquiries).where(eq(enquiries.handled, false)),
    listBetween(londonToIso(today, '00:00')!, londonToIso(addDays(today, 1), '00:00')!),
    needingOutcome(admin.id),
    admin.role === 'admin' ? needingOutcome() : Promise.resolve([]),
  ])
  const upcomingToday = todays.filter((a) => a.status === 'scheduled').length
  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <Link href="/admin" className="admin-brand">
          <LogoMark />
          <span>
            <span className="t1">PRESTON HILL</span>
            <br />
            <span className="t2">Property portal</span>
          </span>
        </Link>
        <NavLinks newEnquiries={n} today={upcomingToday} outcomes={Math.max(mine.length, overdueAll.length)} isAdmin={admin.role === 'admin'} />
        <AlertCenter me={{ id: admin.id, name: admin.name }} initialPending={mine.map(toPending)} />
        <div className="admin-me">
          <div className="who">{admin.name}</div>
          <div className="em">{admin.email}</div>
          <form action={logout}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  )
}
