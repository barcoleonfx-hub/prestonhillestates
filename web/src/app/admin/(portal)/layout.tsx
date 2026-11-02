import Link from 'next/link'
import { and, count, desc, eq, isNull, lte, ne } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, properties, tasks } from '@/db/schema'
import { activeStaff } from '@/lib/appointments'
import { displayAddressFor } from '@/lib/properties'
import { requireAdmin } from '@/lib/auth'
import { listBetween, needingOutcome, toPending } from '@/lib/appointments'
import { addDays, londonToIso, todayLondon } from '@/lib/time'
import { LogoMark } from '@/components/Logo'
import { logout } from '../actions'
import { NavLinks } from './NavLinks'
import { AlertCenter } from './AlertCenter'
import { CallDrawer } from './CallDrawer'

export const dynamic = 'force-dynamic'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()
  await ready()
  const today = todayLondon()
  const endOfToday = londonToIso(addDays(today, 1), '00:00')!
  const [[{ n }], todays, mine, overdueAll, [{ due }], staff, props] = await Promise.all([
    db.select({ n: count() }).from(enquiries).where(eq(enquiries.handled, false)),
    listBetween(londonToIso(today, '00:00')!, londonToIso(addDays(today, 1), '00:00')!),
    needingOutcome(admin.id),
    admin.role === 'admin' ? needingOutcome() : Promise.resolve([]),
    db.select({ due: count() }).from(tasks).where(and(eq(tasks.assignedTo, admin.id), isNull(tasks.doneAt), lte(tasks.dueAt, endOfToday))),
    activeStaff(),
    db.select({ id: properties.id, ref: properties.ref, channel: properties.channel, displayAddress: properties.displayAddress, street: properties.street, town: properties.town, postcode: properties.postcode })
      .from(properties).where(ne(properties.status, 'withdrawn')).orderBy(desc(properties.updatedAt)).limit(400),
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
        <CallDrawer
          me={{ id: admin.id, name: admin.name }}
          staff={staff.map((s) => ({ id: s.id, name: s.name }))}
          props={props.map((p) => ({ id: p.id, ref: p.ref, channel: p.channel, label: displayAddressFor(p) || 'Untitled' }))}
        />
        <NavLinks newEnquiries={n} today={upcomingToday} outcomes={Math.max(mine.length, overdueAll.length)} callbacks={due} isAdmin={admin.role === 'admin'} />
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
