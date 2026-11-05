import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { rentalRegister } from '@/lib/licensing'
import { bucketOf, councilLabel } from '@/lib/licensing-rules'
import { LicTabs } from '../LicTabs'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'All properties' }

type SP = { show?: string; q?: string; src?: string }

export default async function AllPropertiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin()
  const sp = await searchParams
  const [current, old] = await Promise.all([rentalRegister(), rentalRegister({ archived: true })])
  const rows = [...current.rows, ...old.rows].sort((a, b) => a.address.localeCompare(b.address, 'en-GB', { numeric: true }))
  const show = sp.show ?? 'current'
  const q = (sp.q ?? '').trim().toLowerCase()
  const fromRentman = rows.filter((r) => r.rentmanRef).length
  const notOnRentman = current.rows.filter((r) => !r.rentmanRef).length
  const shown = rows.filter((r) =>
    (show === 'all' || (show === 'archived' ? r.archived : !r.archived)) &&
    (!sp.src || (sp.src === 'rentman' ? !!r.rentmanRef : !r.rentmanRef)) &&
    (!q || `${r.address} ${r.sheetAddress ?? ''} ${r.postcode ?? ''} ${r.rentmanRef ?? ''} ${r.landlordName ?? ''} ${r.landlordRef ?? ''}`.toLowerCase().includes(q)))
  const link = (patch: Partial<SP>) => { const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]); const s = p.toString(); return `/admin/licensing/properties${s ? `?${s}` : ''}` }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>All properties</h1>
          <p className="sub">Every property on Rentman, current and archived. Your licensing spreadsheet is matched against this list, and Selective licensing works out where each current one stands.</p>
        </div>
        <div className="actions">
          <Link className="btn btn-gold" href="/admin/licensing/import">Import from Rentman</Link>
        </div>
      </div>
      <LicTabs on="properties" tracked={current.rows.length} all={rows.length} />

      {!rows.length ? (
        <section className="card card-pad lic-empty">
          <h2>Start with your Rentman list</h2>
          <ol>
            <li>In Rentman, export the property list (Propref, Number, Street, Town, Postcode, Rental, Archived, Llord) to Excel.</li>
            <li>Import it here: every property comes in with its exact address and postcode. Archived ones are kept for matching but not tracked.</li>
            <li>Then import your licensing spreadsheet. Each row is matched to its Rentman property, even when it’s shortened or misspelt.</li>
          </ol>
          <div className="actions" style={{ marginTop: 14 }}><Link className="btn btn-gold" href="/admin/licensing/import">Import a spreadsheet</Link></div>
        </section>
      ) : (
        <>
          <div className="lic-tiles">
            <Link href={link({ show: undefined, src: undefined })} className={`lic-tile t-green${show === 'current' && !sp.src ? ' on' : ''}`}><b>{current.rows.length}</b><span>Current (tracked for licensing)</span></Link>
            <Link href={link({ show: 'all', src: 'rentman' })} className={`lic-tile t-blue${sp.src === 'rentman' ? ' on' : ''}${fromRentman ? '' : ' zero'}`}><b>{fromRentman}</b><span>From Rentman</span></Link>
            <Link href={link({ show: undefined, src: 'other' })} className={`lic-tile t-amber${sp.src === 'other' ? ' on' : ''}${notOnRentman ? '' : ' zero'}`} title="Current properties that came from a spreadsheet or were added by hand, and haven’t been matched to a Rentman property."><b>{notOnRentman}</b><span>Not matched to Rentman</span></Link>
            <Link href={link({ show: 'archived', src: undefined })} className={`lic-tile t-grey${show === 'archived' ? ' on' : ''}${old.rows.length ? '' : ' zero'}`}><b>{old.rows.length}</b><span>Archived</span></Link>
          </div>

          <form className="lic-filters" action="/admin/licensing/properties">
            <input className="input" name="q" defaultValue={sp.q} placeholder="Search address, postcode, Rentman ref or landlord" aria-label="Search" />
            <select className="select" name="show" defaultValue={show} aria-label="Show">
              <option value="current">Current</option><option value="archived">Archived</option><option value="all">Current and archived</option>
            </select>
            {sp.src ? <input type="hidden" name="src" value={sp.src} /> : null}
            <button className="btn btn-dark btn-sm" type="submit">Filter</button>
            {Object.values(sp).some(Boolean) ? <Link className="btn btn-ghost btn-sm" href="/admin/licensing/properties">Clear</Link> : null}
          </form>

          <section className="card">
            <div className="table-wrap">
              <table className="list lic-table lic-props">
                <thead><tr><th>Property</th><th>Rentman</th><th>Area</th><th>Rent</th><th>Landlord</th><th>Licensing</th></tr></thead>
                <tbody>
                  {shown.slice(0, 1500).map((r) => {
                    const b = bucketOf(r.a.bucket)
                    return (
                      <tr key={r.id}>
                        <td>
                          <Link className="addr-main" href={`/admin/licensing/${r.id}`}>{r.address}</Link>
                          <div className="addr-sub">{r.postcode ?? 'No postcode'}</div>
                          {r.sheetAddress ? <div className="addr-sub">On your licensing sheet as “{r.sheetAddress}”</div> : null}
                        </td>
                        <td className="addr-sub">{r.rentmanRef ? <>Ref {r.rentmanRef}{r.rentmanArchived ? <div>Archived on Rentman</div> : null}</> : 'Not matched'}</td>
                        <td className="addr-sub">{r.council ? councilLabel(r.council) : '—'}{r.ward ? <><br />{r.ward}</> : null}</td>
                        <td className="addr-sub">{r.rentPcm ? `£${r.rentPcm.toLocaleString('en-GB')} pcm` : '—'}</td>
                        <td className="addr-sub">{r.landlordName ?? (r.landlordRef ? `Landlord no. ${r.landlordRef}` : '—')}</td>
                        <td>{r.archived ? <span className="lic-pill t-grey">Archived</span> : <span className={`lic-pill t-${b.tone}`}>{b.label}</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!shown.length ? <p className="card-sub" style={{ padding: '6px 20px 20px' }}>Nothing matches. <Link href="/admin/licensing/properties">Show everything</Link>.</p> : null}
            {shown.length > 1500 ? <p className="card-sub" style={{ padding: '6px 20px 20px' }}>Showing the first 1,500 of {shown.length}: search to narrow it down.</p> : null}
          </section>
        </>
      )}
    </>
  )
}
