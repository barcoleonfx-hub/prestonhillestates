import Link from 'next/link'
import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, properties } from '@/db/schema'
import { coversFor, displayAddressFor, priceLabel, statusLabel } from '@/lib/properties'
import { requireAdmin } from '@/lib/auth'
import { createProperty } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Dashboard' }

async function n(where?: SQL) {
  const [{ c }] = await db.select({ c: count() }).from(properties).where(where)
  return c
}

export default async function Dashboard() {
  await requireAdmin()
  await ready()
  const [liveSale, liveLet, drafts, progressing, newEnq] = await Promise.all([
    n(and(eq(properties.published, true), eq(properties.channel, 'sale'))),
    n(and(eq(properties.published, true), eq(properties.channel, 'let'))),
    n(eq(properties.published, false)),
    n(and(eq(properties.published, true), inArray(properties.status, ['under_offer', 'sold_stc', 'let_agreed']))),
    db.select({ c: count() }).from(enquiries).where(eq(enquiries.handled, false)).then((r) => r[0].c),
  ])
  const recent = await db.select().from(properties).orderBy(desc(properties.updatedAt)).limit(6)
  const covers = await coversFor(recent.map((r) => r.id))
  const latestEnq = await db.select().from(enquiries).orderBy(desc(enquiries.createdAt)).limit(5)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="sub">Everything listed on the website, at a glance.</p>
        </div>
        <div className="actions">
          <form action={createProperty}><input type="hidden" name="channel" value="sale" /><button className="btn btn-gold" type="submit">Add property for sale</button></form>
          <form action={createProperty}><input type="hidden" name="channel" value="let" /><button className="btn btn-dark" type="submit">Add property to let</button></form>
        </div>
      </div>

      <div className="stats">
        <Link href="/admin/properties?channel=sale&published=live" className="card stat" style={{ textDecoration: 'none' }}><div className="n">{liveSale}</div><div className="k">Live for sale</div></Link>
        <Link href="/admin/properties?channel=let&published=live" className="card stat" style={{ textDecoration: 'none' }}><div className="n">{liveLet}</div><div className="k">Live to let</div></Link>
        <Link href="/admin/properties?published=draft" className="card stat" style={{ textDecoration: 'none' }}><div className="n">{drafts}</div><div className="k">Drafts</div></Link>
        <div className="card stat"><div className="n">{progressing}</div><div className="k">Under offer or agreed</div></div>
        <Link href="/admin/enquiries" className="card stat" style={{ textDecoration: 'none' }}><div className="n">{newEnq}</div><div className="k">New enquiries</div></Link>
      </div>

      <div className="two">
        <section className="card">
          <div className="card-pad" style={{ paddingBottom: 6 }}>
            <h2>Recently updated</h2>
          </div>
          {recent.length === 0 ? (
            <div className="empty">No properties yet. Add your first one above.</div>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <tbody>
                  {recent.map((p) => (
                    <tr key={p.id}>
                      <td style={{ width: 88 }}>
                        {covers[p.id] ? <img className="thumb" src={covers[p.id].url} alt="" /> : <div className="thumb-empty">No photo</div>}
                      </td>
                      <td>
                        <Link href={`/admin/properties/${p.id}`} style={{ textDecoration: 'none' }}>
                          <div className="addr-main">{displayAddressFor(p) || 'Untitled property'}</div>
                          <div className="addr-sub">{p.ref} · {priceLabel(p)}</div>
                        </Link>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {p.published ? <span className="pill live"><span className="dot" />Live</span> : <span className="pill draft">Draft</span>}{' '}
                        <span className="pill">{statusLabel(p.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card card-pad">
          <h2>Latest enquiries</h2>
          <div className="enq" style={{ marginTop: 8 }}>
            {latestEnq.length === 0 ? (
              <p style={{ color: 'var(--faint)', fontSize: '0.88rem', padding: '18px 0' }}>Viewing requests from the website will appear here.</p>
            ) : (
              latestEnq.map((e) => (
                <div className="enq-item" key={e.id}>
                  <div>
                    <div className="who">{e.name}</div>
                    <div className="what">{e.phone || e.email} · {new Date(e.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                  </div>
                  {e.handled ? <span className="pill">Handled</span> : <span className="pill gold">New</span>}
                </div>
              ))
            )}
          </div>
          <Link href="/admin/enquiries" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>All enquiries</Link>
        </section>
      </div>
    </>
  )
}
