import Link from 'next/link'
import { and, desc, eq, like, or, sql, type SQL } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, properties } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { ENQUIRY_OUTCOMES, ENQUIRY_SOURCES, RECENT_DAYS, enquiryLabel, outcomeText } from '@/lib/enquiry-labels'
import { displayAddressFor } from '@/lib/properties'
import { setEnquiryHandled } from '../../actions'
import { EnquiryOutcome } from '../EnquiryOutcome'
import { LogCallButton } from '../LogCallButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Enquiries' }

type Row = { e: typeof enquiries.$inferSelect; p: typeof properties.$inferSelect | null; dnc: boolean | null }

function Item({ e, p, dnc }: Row) {
  const callerType = e.kind === 'valuation' ? (e.intent === 'letting' ? 'landlord' : 'seller') : p?.channel === 'let' || /renter|to rent|pcm/i.test(e.message ?? '') ? 'tenant' : 'buyer'
  return (
    <div className={`enq-item${dnc ? ' dnc' : ''}`}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="who">
          {e.name}{' '}
          {!e.handled ? <span className="pill gold">New</span> : null}{' '}
          <span className="pill">{enquiryLabel(e)}</span>{' '}
          {e.outcome ? <span className={`pill${e.outcome === 'do_not_call' ? ' warn' : ''}`}>{outcomeText(e.outcome)}</span> : null}{' '}
          {dnc && e.outcome !== 'do_not_call' ? <span className="pill warn">Do not call</span> : null}
        </div>
        <div className="what">
          {[e.phone, e.email].filter(Boolean).join(' · ')} ·{' '}
          {new Date(e.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}
          {p ? <> · <Link href={`/admin/properties/${p.id}`}>{p.ref} {displayAddressFor(p)}</Link></> : null}
        </div>
        {e.kind === 'valuation' && e.postcode ? (
          <p className="msg">Property postcode <b>{e.postcode}</b> · {e.intent === 'selling' ? 'Thinking of selling' : e.intent === 'letting' ? 'Thinking of letting' : 'Not sure yet'}</p>
        ) : null}
        {e.message ? (
          <details className="enq-msg">
            <summary>{e.message.split('\n').find((l) => l.trim())?.slice(0, 140)}</summary>
            <p className="msg pre">{e.message}</p>
          </details>
        ) : null}
        <EnquiryOutcome id={e.id} outcome={e.outcome} channel={p?.channel ?? (callerType === 'tenant' ? 'let' : 'sale')} />
      </div>
      <div className="enq-actions">
        {e.contactId ? <Link className="btn btn-ghost btn-sm" href={`/admin/contacts/${e.contactId}`}>Record</Link> : null}
        {!dnc ? (
          <LogCallButton
            label="Call them" className="btn btn-dark btn-sm"
            prefill={{
              name: e.name, phone: e.phone ?? undefined, email: e.email ?? undefined, enquiryId: e.id, direction: 'out', propertyId: e.propertyId ?? undefined,
              callerType, ...(e.contactId ? { contactId: e.contactId } : {}),
            }}
          />
        ) : null}
        {!dnc ? <Link className="btn btn-gold btn-sm" href={`/admin/diary/new?enquiry=${e.id}`}>{e.kind === 'valuation' ? 'Book valuation' : 'Book viewing'}</Link> : null}
        <form action={setEnquiryHandled}>
          <input type="hidden" name="id" value={e.id} />
          <input type="hidden" name="handled" value={e.handled ? '0' : '1'} />
          <button className="btn btn-ghost btn-sm" type="submit">{e.handled ? 'Mark as new' : 'Mark handled'}</button>
        </form>
      </div>
    </div>
  )
}

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ q?: string; source?: string; outcome?: string }> }) {
  await requireAdmin()
  await ready()
  const sp = await searchParams
  const q = (sp.q ?? '').trim().slice(0, 80)
  const source = sp.source && sp.source in ENQUIRY_SOURCES ? sp.source : ''
  const outcome = ENQUIRY_OUTCOMES.some((o) => o.value === sp.outcome) || sp.outcome === 'none' ? sp.outcome! : ''
  const where: SQL[] = []
  if (q) {
    const t = `%${q.toLowerCase()}%`
    where.push(or(like(sql`lower(${enquiries.name})`, t), like(sql`lower(coalesce(${enquiries.email}, ''))`, t), like(sql`replace(coalesce(${enquiries.phone}, ''), ' ', '')`, `%${q.replace(/\s/g, '')}%`), like(sql`lower(coalesce(${enquiries.message}, ''))`, t))!)
  }
  if (source) where.push(eq(enquiries.source, source))
  if (outcome === 'none') where.push(sql`${enquiries.outcome} IS NULL`)
  else if (outcome) where.push(eq(enquiries.outcome, outcome))
  const rows: Row[] = await db
    .select({ e: enquiries, p: properties, dnc: contacts.doNotContact })
    .from(enquiries)
    .leftJoin(properties, eq(enquiries.propertyId, properties.id))
    .leftJoin(contacts, eq(enquiries.contactId, contacts.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(enquiries.createdAt))
    .limit(500)

  const recentFrom = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()
  const open = rows.filter((r) => !r.e.handled)
  const recent = rows.filter((r) => r.e.handled && r.e.createdAt >= recentFrom)
  const older = rows.filter((r) => r.e.handled && r.e.createdAt < recentFrom)
  const href = (p: Record<string, string>) => `/admin/enquiries?${new URLSearchParams(Object.entries({ ...(q ? { q } : {}), ...(source ? { source } : {}), ...(outcome ? { outcome } : {}), ...p }).filter(([, v]) => v))}`

  const Group = ({ title, sub, list }: { title: string; sub: string; list: Row[] }) => (
    <section className="card card-pad enq-group">
      <h2>{title} · {list.length}</h2>
      <p className="card-sub">{sub}</p>
      {list.length ? <div className="enq">{list.map((r) => <Item key={r.e.id} {...r} />)}</div> : <p className="card-sub" style={{ marginTop: 8 }}>None.</p>}
    </section>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Enquiries</h1>
          <p className="sub">From the website, Zoopla, OnTheMarket and email. Record what happened with the quick buttons, so the right people are suggested when new properties come on.</p>
        </div>
      </div>

      <form className="filters" action="/admin/enquiries">
        <div className="field"><label htmlFor="eq-q">Search</label><input className="input" id="eq-q" name="q" defaultValue={q} placeholder="Name, phone, email or property" /></div>
        {source ? <input type="hidden" name="source" value={source} /> : null}
        {outcome ? <input type="hidden" name="outcome" value={outcome} /> : null}
        <button className="btn btn-dark" type="submit">Search</button>
        <div className="seg" role="group" aria-label="Source">
          <Link className={!source ? 'on' : undefined} href={href({ source: '' })}>All</Link>
          {Object.entries(ENQUIRY_SOURCES).map(([v, l]) => <Link key={v} className={source === v ? 'on' : undefined} href={href({ source: v })}>{l}</Link>)}
        </div>
        <div className="seg" role="group" aria-label="Outcome">
          <Link className={!outcome ? 'on' : undefined} href={href({ outcome: '' })}>Any outcome</Link>
          <Link className={outcome === 'none' ? 'on' : undefined} href={href({ outcome: 'none' })}>Not recorded</Link>
          {ENQUIRY_OUTCOMES.map((o) => <Link key={o.value} className={outcome === o.value ? 'on' : undefined} href={href({ outcome: o.value })}>{o.label}</Link>)}
        </div>
      </form>

      <div className="enq-groups">
        <Group title="Needs a reply" sub="Nobody has dealt with these yet." list={open} />
        <Group title={`Recent enquiries · last ${Math.round(RECENT_DAYS / 30)} months`} sub="Most likely to say yes. Good people to call about new properties." list={recent} />
        <Group title="Older enquiries" sub={`More than ${Math.round(RECENT_DAYS / 30)} months ago. Still worth a call if a property fits.`} list={older} />
      </div>
    </>
  )
}
