import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { alertsOn, tenantList } from '@/lib/tenants'
import { mailboxStatus } from '@/lib/mailbox'
import { setTenantActive, setTenantAlerts } from '../../tenant-actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tenants' }

const gbp = (n: number) => `£${n.toLocaleString('en-GB')}`
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—')

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string }> }) {
  await requireAdmin()
  const sp = await searchParams
  const [rows, on, box] = await Promise.all([tenantList(), alertsOn(), mailboxStatus()])
  const active = rows.filter((r) => r.active && !r.optedOut)
  const month = rows.filter((r) => r.createdAt >= new Date(Date.now() - 30 * 86400000).toISOString()).length
  const q = (sp.q ?? '').trim().toLowerCase()
  const shown = rows.filter((r) => (sp.show === 'all' || (r.active && !r.optedOut)) && (!q || `${r.name} ${r.email ?? ''} ${r.phone ?? ''} ${r.areasList.join(' ')}`.toLowerCase().includes(q)))
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tenants</h1>
          <p className="sub">People who registered on the website for homes to rent. When a home to rent goes live that fits what they asked for, they’re emailed about it automatically, once per home.</p>
        </div>
        <div className="actions">
          <a className="btn btn-ghost" href="/renting" target="_blank" rel="noreferrer">See the sign-up page</a>
        </div>
      </div>

      <section className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="today-head">
          <div>
            <h2>{active.length} looking now{month ? ` · ${month} joined in the last 30 days` : ''}</h2>
            <p className="card-sub">
              {on ? 'Automatic emails are on: new homes to rent go out within about 10 minutes of being published, a few at a time, from the office mailbox.' : 'Automatic emails are off. Nobody is emailed until you turn them back on.'}
              {on && !box?.hasPassword ? ' The mailbox isn’t connected, so nothing can be sent: connect it in Email settings.' : ''}
            </p>
          </div>
          <form action={setTenantAlerts}><input type="hidden" name="on" value={on ? '0' : '1'} /><button className="btn btn-ghost btn-sm" type="submit">{on ? 'Turn off automatic emails' : 'Turn on automatic emails'}</button></form>
        </div>
      </section>

      <form className="lic-filters" action="/admin/tenants" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input className="input" name="q" defaultValue={sp.q} placeholder="Search name, email, phone or area" aria-label="Search" style={{ flex: '1 1 260px' }} />
        <select className="select" name="show" defaultValue={sp.show ?? ''} aria-label="Show"><option value="">Still looking</option><option value="all">Everyone</option></select>
        <button className="btn btn-dark btn-sm" type="submit">Filter</button>
      </form>

      <section className="card">
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Tenant</th><th>Rent up to</th><th>Bedrooms</th><th>Areas</th><th>Moving</th><th>Emails sent</th><th>Joined</th><th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.contactId}>
                  <td><Link className="addr-main" href={`/admin/contacts/${r.contactId}`}>{r.name}</Link><div className="addr-sub">{[r.email, r.phone].filter(Boolean).join(' · ')}</div>{r.notes ? <div className="addr-sub">“{r.notes}”</div> : null}</td>
                  <td className="addr-sub">{r.maxRent ? `${gbp(r.maxRent)} pcm` : 'Any'}</td>
                  <td className="addr-sub">{r.minBeds == null ? 'Any' : r.minBeds === 0 ? 'Studio+' : `${r.minBeds}+`}</td>
                  <td className="addr-sub">{r.areasList.join(', ') || 'Anywhere'}</td>
                  <td className="addr-sub">{r.moveBy ?? '—'}{r.pets ? <div>Has a pet</div> : null}{r.furnishing ? <div>{r.furnishing === 'furnished' ? 'Furnished' : 'Unfurnished'}</div> : null}</td>
                  <td className="addr-sub">{r.sent}{r.lastSentAt ? <div>last {day(r.lastSentAt)}</div> : null}</td>
                  <td className="addr-sub">{day(r.createdAt)}</td>
                  <td>
                    {r.optedOut ? <span className="addr-sub">Unsubscribed</span> : (
                      <form action={setTenantActive}><input type="hidden" name="contactId" value={r.contactId} /><input type="hidden" name="active" value={r.active ? '0' : '1'} /><button className="btn btn-ghost btn-sm" type="submit">{r.active ? 'Found a home: stop' : 'Start again'}</button></form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length ? <p className="card-sub" style={{ padding: '6px 20px 20px' }}>{rows.length ? 'Nobody matches.' : 'Nobody has registered yet. The sign-up form is on the Renting page and linked from every home to rent.'}</p> : null}
      </section>
    </>
  )
}
