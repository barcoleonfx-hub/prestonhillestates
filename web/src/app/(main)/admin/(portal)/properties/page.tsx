import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { CHANNELS, STATUSES } from '@/lib/options'
import { displayAddressFor, listForAdmin, priceLabel, statusLabel } from '@/lib/properties'
import { matchCounts } from '@/lib/matching'
import { isNotNull, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { enquiries } from '@/db/schema'
import { RECENT_DAYS } from '@/lib/enquiry-labels'
import { createProperty } from '../../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Properties' }

type SP = Promise<Record<string, string | string[] | undefined>>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || ''

export default async function PropertiesPage({ searchParams }: { searchParams: SP }) {
  await requireAdmin()
  const sp = await searchParams
  const filters = { q: one(sp.q), channel: one(sp.channel), status: one(sp.status), published: one(sp.published) }
  const rows = await listForAdmin(filters)
  const counts = await matchCounts(rows)
  const recentFrom = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()
  // A person is their phone number, else email, else contact record, else name: the same rule as the property page.
  const who = sql`coalesce(nullif(replace(replace(replace(coalesce(${enquiries.phone}, ''), ' ', ''), '+44', '0'), '-', ''), ''), lower(${enquiries.email}), ${enquiries.contactId}, lower(${enquiries.name}))`
  const enq = Object.fromEntries((await db.select({
    // Counted as people, the same as on the property page.
    id: enquiries.propertyId, n: sql<number>`count(distinct ${who})`,
    recent: sql<number>`count(distinct case when ${enquiries.createdAt} >= ${recentFrom} then ${who} end)`,
    open: sql<number>`count(distinct case when ${enquiries.outcome} is null then ${who} end)`,
  }).from(enquiries).where(isNotNull(enquiries.propertyId)).groupBy(enquiries.propertyId)).map((r) => [r.id!, r]))
  const filtered = Object.values(filters).some(Boolean)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Properties</h1>
          <p className="sub">{rows.length} {rows.length === 1 ? 'property' : 'properties'}{filtered ? ' match these filters' : ''}</p>
        </div>
        <div className="actions">
          <form action={createProperty}><input type="hidden" name="channel" value="sale" /><button className="btn btn-gold" type="submit">Add for sale</button></form>
          <form action={createProperty}><input type="hidden" name="channel" value="let" /><button className="btn btn-dark" type="submit">Add to let</button></form>
        </div>
      </div>

      <form className="filters" method="get">
        <div className="field">
          <label htmlFor="q">Search</label>
          <input className="input" id="q" name="q" defaultValue={filters.q} placeholder="Reference, street or postcode" />
        </div>
        <div className="field">
          <label htmlFor="channel">Type</label>
          <select className="select" id="channel" name="channel" defaultValue={filters.channel}>
            <option value="">Sales and lettings</option>
            {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select className="select" id="status" name="status" defaultValue={filters.status}>
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="published">Website</label>
          <select className="select" id="published" name="published" defaultValue={filters.published}>
            <option value="">Live and drafts</option>
            <option value="live">Live only</option>
            <option value="draft">Drafts only</option>
          </select>
        </div>
        <button className="btn btn-ghost" type="submit">Apply</button>
        {filtered ? <Link className="btn btn-ghost" href="/admin/properties">Clear</Link> : null}
      </form>

      <section className="card">
        {rows.length === 0 ? (
          <div className="empty">{filtered ? 'Nothing matches these filters.' : 'No properties yet. Use “Add for sale” or “Add to let” to create your first listing.'}</div>
        ) : (
          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr>
                  <th></th><th>Property</th><th>Price</th><th>Beds</th><th>Status</th><th>Website</th><th>Enquiries</th><th>To call</th><th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td style={{ width: 88 }}>
                      {p.cover ? <img className="thumb" src={p.cover.url} alt="" /> : <div className="thumb-empty">No photo</div>}
                    </td>
                    <td>
                      <Link href={`/admin/properties/${p.id}`} style={{ textDecoration: 'none' }}>
                        <div className="addr-main">{displayAddressFor(p) || 'Untitled property'}</div>
                        <div className="addr-sub">{p.ref} · {p.channel === 'let' ? 'To let' : 'For sale'}{p.featured ? ' · Featured' : ''}</div>
                      </Link>
                    </td>
                    <td className="num">{priceLabel(p)}</td>
                    <td className="num">{p.bedrooms ?? '–'}</td>
                    <td><span className="pill">{statusLabel(p.status)}</span></td>
                    <td>{p.published ? <span className="pill live"><span className="dot" />Live</span> : <span className="pill draft">Draft</span>}</td>
                    <td>
                      {enq[p.id]?.n ? (
                        <a href={`/admin/properties/${p.id}#enquiries`} className="pe-count" title={`${enq[p.id].recent} in the last ${Math.round(RECENT_DAYS / 30)} months`}>
                          <span className="pill">{enq[p.id].n} {enq[p.id].n === 1 ? 'person' : 'people'}</span>
                          {enq[p.id].open ? <span className="addr-sub">{enq[p.id].open} to follow up</span> : null}
                        </a>
                      ) : <span className="addr-sub">–</span>}
                    </td>
                    <td>
                      {counts[p.id]?.total ? (
                        <a href={`/admin/properties/${p.id}#matches`} className="pill gold" title={`${counts[p.id].recent} recent, ${counts[p.id].total - counts[p.id].recent} older`}>
                          {counts[p.id].total} to call{counts[p.id].recent ? ` · ${counts[p.id].recent} recent` : ''}
                        </a>
                      ) : <span className="addr-sub">–</span>}
                    </td>
                    <td className="num" style={{ color: 'var(--faint)', fontSize: '0.8rem' }}>
                      {new Date(p.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
