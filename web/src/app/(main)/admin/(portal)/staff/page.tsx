import { asc } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins } from '@/db/schema'
import { requireRole } from '@/lib/auth'
import { setStaffActive, setStaffRole } from '../../staff-actions'
import { AddStaffForm, ResetPasswordButton } from './StaffForms'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Staff' }

export default async function StaffPage() {
  const me = await requireRole('admin')
  await ready()
  const staff = await db.select().from(admins).orderBy(asc(admins.name))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Staff</h1>
          <p className="sub">Everyone who can sign in to the portal. Each person gets appointment alerts and reminder emails.</p>
        </div>
      </div>
      <div className="two">
        <section className="card">
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last signed in</th><th></th></tr></thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id} style={s.active ? undefined : { opacity: 0.55 }}>
                    <td>
                      <div className="addr-main">{s.name}{s.id === me.id ? ' (you)' : ''}</div>
                      <div className="addr-sub">{s.email}{s.phone ? ` · ${s.phone}` : ''}</div>
                    </td>
                    <td>
                      {s.id === me.id ? <span className="pill gold">Admin</span> : (
                        <form action={setStaffRole} style={{ display: 'flex', gap: 6 }}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="role" value={s.role === 'admin' ? 'negotiator' : 'admin'} />
                          <span className={`pill${s.role === 'admin' ? ' gold' : ''}`}>{s.role === 'admin' ? 'Admin' : 'Negotiator'}</span>
                          <button className="btn btn-ghost btn-sm" type="submit">Make {s.role === 'admin' ? 'negotiator' : 'admin'}</button>
                        </form>
                      )}
                    </td>
                    <td>{s.active ? <span className="pill live"><span className="dot" />Active</span> : <span className="pill draft">Switched off</span>}</td>
                    <td className="num" style={{ color: 'var(--faint)', fontSize: '0.8rem' }}>
                      {s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }) : 'Never'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {s.id !== me.id ? (
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <ResetPasswordButton id={s.id} />
                          <form action={setStaffActive}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="active" value={s.active ? '0' : '1'} />
                            <button className={`btn btn-sm ${s.active ? 'btn-danger' : 'btn-ghost'}`} type="submit">{s.active ? 'Switch off' : 'Switch on'}</button>
                          </form>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card card-pad">
          <h2>Add a member of staff</h2>
          <p className="card-sub">They’ll get a starting password to change after signing in.</p>
          <AddStaffForm />
        </section>
      </div>
    </>
  )
}
