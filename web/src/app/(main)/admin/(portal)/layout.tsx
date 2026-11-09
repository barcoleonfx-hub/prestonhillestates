import Link from 'next/link'
import { and, count, desc, eq, isNull, lte, ne } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, properties, tasks } from '@/db/schema'
import { activeStaff } from '@/lib/appointments'
import { displayAddressFor } from '@/lib/properties'
import { requireAdmin } from '@/lib/auth'
import { listBetween, needingOutcome, toPending } from '@/lib/appointments'
import { addDays, londonToIso, todayLondon } from '@/lib/time'
import { LogoMark } from '@/components/Logo'
import { enquirySide } from '@/lib/enquiry-labels'
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
  const [fresh, todays, mine, overdueAll, [{ due }], staff, props] = await Promise.all([
    db.select({ side: enquiries.side, autoSide: enquiries.autoSide, sideWhy: enquiries.sideWhy, kind: enquiries.kind, intent: enquiries.intent, message: enquiries.message, channel: properties.channel, roles: contacts.roles })
      .from(enquiries).leftJoin(properties, eq(enquiries.propertyId, properties.id)).leftJoin(contacts, eq(enquiries.contactId, contacts.id)).where(eq(enquiries.handled, false)),
    listBetween(londonToIso(today, '00:00')!, londonToIso(addDays(today, 1), '00:00')!),
    needingOutcome(admin.id),
    admin.role === 'admin' ? needingOutcome() : Promise.resolve([]),
    db.select({ due: count() }).from(tasks).where(and(eq(tasks.assignedTo, admin.id), isNull(tasks.doneAt), lte(tasks.dueAt, endOfToday))),
    activeStaff(),
    db.select({ id: properties.id, ref: properties.ref, channel: properties.channel, displayAddress: properties.displayAddress, street: properties.street, town: properties.town, postcode: properties.postcode })
      .from(properties).where(ne(properties.status, 'withdrawn')).orderBy(desc(properties.updatedAt)).limit(400),
  ])
  // New enquiries per list; ones that can't be sorted count on both, so nobody misses them (each list says so).
  const sides = fresh.map((e) => enquirySide(e, e.channel, e.roles))
  const newSales = sides.filter((x) => x !== 'lettings').length, newLettings = sides.filter((x) => x !== 'sales').length
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
        <NavLinks newSales={newSales} newLettings={newLettings} today={upcomingToday} outcomes={Math.max(mine.length, overdueAll.length)} callbacks={due} isAdmin={admin.role === 'admin'} />
        <AlertCenter me={{ id: admin.id, name: admin.name }} initialPending={mine.map(toPending)} />
        <div className="admin-me">
          <div className="who">{admin.name}</div>
          <div className="em">{admin.email}</div>
          <form action={logout}>
            <button type="submit">Sign out</button>
          </form>
          {/* Which update the live site is running (Render sets this), so it's easy to tell when a change is live. */}
          {process.env.RENDER_GIT_COMMIT ? <div className="admin-version" title={process.env.RENDER_GIT_COMMIT}>Version {process.env.RENDER_GIT_COMMIT.slice(0, 7)}</div> : null}
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  )
}
