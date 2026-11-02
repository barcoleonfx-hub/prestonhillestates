import Link from 'next/link'
import { count, eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { LogoMark } from '@/components/Logo'
import { logout } from '../actions'
import { NavLinks } from './NavLinks'

export const dynamic = 'force-dynamic'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()
  await ready()
  const [{ n }] = await db.select({ n: count() }).from(enquiries).where(eq(enquiries.handled, false))
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
        <NavLinks newEnquiries={n} />
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
