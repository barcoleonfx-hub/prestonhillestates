import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, properties } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { displayAddressFor } from '@/lib/properties'
import { setEnquiryHandled } from '../../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Enquiries' }

export default async function EnquiriesPage() {
  await requireAdmin()
  await ready()
  const rows = await db
    .select({ e: enquiries, p: properties })
    .from(enquiries)
    .leftJoin(properties, eq(enquiries.propertyId, properties.id))
    .orderBy(desc(enquiries.createdAt))
    .limit(200)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Enquiries</h1>
          <p className="sub">Viewing requests sent from property pages on the website.</p>
        </div>
      </div>
      <section className="card card-pad">
        {rows.length === 0 ? (
          <div className="empty">No enquiries yet.</div>
        ) : (
          <div className="enq">
            {rows.map(({ e, p }) => (
              <div className="enq-item" key={e.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="who">
                    {e.name} {e.handled ? <span className="pill">Handled</span> : <span className="pill gold">New</span>}
                  </div>
                  <div className="what">
                    {[e.phone, e.email].filter(Boolean).join(' · ')} ·{' '}
                    {new Date(e.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    {p ? <> · <Link href={`/admin/properties/${p.id}`}>{p.ref} {displayAddressFor(p)}</Link></> : null}
                  </div>
                  {e.message ? <p className="msg">{e.message}</p> : null}
                </div>
                <form action={setEnquiryHandled}>
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="handled" value={e.handled ? '0' : '1'} />
                  <button className="btn btn-ghost btn-sm" type="submit">{e.handled ? 'Mark as new' : 'Mark handled'}</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
