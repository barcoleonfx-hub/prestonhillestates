import Link from 'next/link'
import { desc, eq, isNotNull, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, properties } from '@/db/schema'
import { requireRole } from '@/lib/auth'
import { ENQUIRY_SOURCES, outcomeText } from '@/lib/enquiry-labels'
import { RETENTION_MONTHS } from '@/lib/retention'
import { ImportEmails } from './ImportEmails'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Import emails' }

const SHOW = 200

export default async function ImportPage() {
  await requireRole('admin')
  await ready()
  // Everything that came in from an email export (it carries the email's Message-ID).
  const imported = await db
    .select({ id: enquiries.id, name: enquiries.name, phone: enquiries.phone, email: enquiries.email, source: enquiries.source, createdAt: enquiries.createdAt, message: enquiries.message, outcome: enquiries.outcome, contactId: enquiries.contactId, ref: properties.ref })
    .from(enquiries)
    .leftJoin(properties, eq(enquiries.propertyId, properties.id))
    .where(isNotNull(enquiries.externalId))
    .orderBy(desc(enquiries.createdAt))
    .limit(SHOW)
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(enquiries).where(isNotNull(enquiries.externalId))
  const about = (m: string | null) => /^About: (.+)$/m.exec(m ?? '')?.[1] ?? (m ?? '').split('\n').find((l) => l.trim())?.replace(/^(Email subject|Subject): /, '') ?? ''
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Import past email enquiries</h1>
          <p className="sub">Bring in enquiries from your inbox: Zoopla and OnTheMarket leads, old website forms and emails from people. You review everything before it’s saved.</p>
        </div>
      </div>
      <ImportEmails retentionYears={RETENTION_MONTHS / 12} />

      <section className="card imp-group imp-past" id="imported">
        <div className="imp-group-head">
          <div>
            <h2>Imported so far · {total}</h2>
            <p className="card-sub">{total ? 'Newest first, on the date each email was sent. Record what happened with each one in Enquiries.' : 'Nothing imported yet. Upload an export above, review the list and click Import.'}</p>
          </div>
          {total ? <Link className="btn btn-gold btn-sm" href="/admin/enquiries?imported=1">Open in Enquiries</Link> : null}
        </div>
        {imported.length ? (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Date</th><th>Name</th><th>Contact</th><th>About</th><th>From</th><th>Outcome</th></tr></thead>
              <tbody>
                {imported.map((e) => (
                  <tr key={e.id}>
                    <td className="num addr-sub">{day(e.createdAt)}</td>
                    <td>{e.contactId ? <Link className="addr-main" href={`/admin/contacts/${e.contactId}`}>{e.name}</Link> : <span className="addr-main">{e.name}</span>}</td>
                    <td className="addr-sub">{[e.phone, e.email].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="addr-sub imp-about"><div className="imp-about-main">{e.ref ? `${e.ref} · ` : ''}{about(e.message)}</div></td>
                    <td><span className="pill">{ENQUIRY_SOURCES[e.source] ?? e.source}</span></td>
                    <td className="addr-sub">{e.outcome ? outcomeText(e.outcome) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {total > SHOW ? <p className="card-sub" style={{ padding: '10px 20px 16px' }}>Showing the newest {SHOW}. <Link href="/admin/enquiries?imported=1">See all {total} in Enquiries</Link>.</p> : null}
      </section>
    </>
  )
}
