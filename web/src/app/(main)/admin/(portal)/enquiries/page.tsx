import Link from 'next/link'
import { and, asc, desc, eq, isNotNull, isNull, like, or, sql, type SQL } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, properties } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { ENQUIRY_OUTCOMES, ENQUIRY_SOURCES, RECENT_DAYS, enquirySide, isValuation, type EnquirySide } from '@/lib/enquiry-labels'
import { displayAddressFor } from '@/lib/properties'
import { trailFor } from '@/lib/enquiry-trail'
import { EnquiryItem, type EnquiryRow as Row } from '../EnquiryItem'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Enquiries' }

const HEAD: Record<EnquirySide | 'unsorted' | 'all', [string, string]> = {
  unsorted: ['Not sorted yet', 'Enquiries that don’t say whether they’re sales or lettings. Open one, then press “It’s sales” or “It’s lettings”.'],
  sales: ['Sales enquiries', 'Buyers, viewing requests and sales valuations, from the website, Zoopla, OnTheMarket and email.'],
  lettings: ['Lettings enquiries', 'Tenants, viewing requests for homes to rent and rental valuations, from the website, Zoopla, OnTheMarket and email.'],
  all: ['All enquiries', 'Sales and lettings together, from the website, Zoopla, OnTheMarket and email.'],
}

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ q?: string; source?: string; outcome?: string; imported?: string; show?: string; property?: string; side?: string; type?: string }> }) {
  await requireAdmin()
  await ready()
  const sp = await searchParams
  const q = (sp.q ?? '').trim().slice(0, 80)
  const source = sp.source && sp.source in ENQUIRY_SOURCES ? sp.source : ''
  const outcome = ENQUIRY_OUTCOMES.some((o) => o.value === sp.outcome) || sp.outcome === 'none' ? sp.outcome! : ''
  const imported = sp.imported === '1'
  const side: EnquirySide | 'unsorted' | '' = sp.side === 'sales' || sp.side === 'lettings' || sp.side === 'unsorted' ? sp.side : ''
  const type = sp.type === 'valuations' || sp.type === 'enquiries' ? sp.type : ''
  const props = await db.select().from(properties).orderBy(asc(properties.ref))
  const linkTo = props.map((p) => ({ id: p.id, label: `${p.ref} · ${displayAddressFor(p)}` }))
  const property = sp.property === 'none' || props.some((p) => p.id === sp.property) ? sp.property! : ''
  const show = sp.show ?? ''
  const where: SQL[] = []
  if (imported) where.push(isNotNull(enquiries.externalId))
  if (property === 'none') where.push(isNull(enquiries.propertyId))
  else if (property) where.push(eq(enquiries.propertyId, property))
  if (q) {
    const t = `%${q.toLowerCase()}%`
    where.push(or(like(sql`lower(${enquiries.name})`, t), like(sql`lower(coalesce(${enquiries.email}, ''))`, t), like(sql`replace(coalesce(${enquiries.phone}, ''), ' ', '')`, `%${q.replace(/\s/g, '')}%`), like(sql`lower(coalesce(${enquiries.message}, ''))`, t))!)
  }
  if (source) where.push(eq(enquiries.source, source))
  if (outcome === 'none') where.push(sql`${enquiries.outcome} IS NULL`)
  else if (outcome) where.push(eq(enquiries.outcome, outcome))
  const found: Row[] = await db
    .select({ e: enquiries, p: properties, dnc: contacts.doNotContact, roles: contacts.roles })
    .from(enquiries)
    .leftJoin(properties, eq(enquiries.propertyId, properties.id))
    .leftJoin(contacts, eq(enquiries.contactId, contacts.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(enquiries.createdAt))
    .limit(5000)

  // Sales or lettings: worked out per enquiry (see sortEnquiry). Ones it can't tell have their own tab.
  const sideOf = new Map(found.map((r) => [r.e.id, enquirySide(r.e, r.p?.channel, r.roles) ?? 'unsorted']))
  // Valuations: requests from the website form, Zoopla, OnTheMarket or an email asking for one.
  const ofType = found.filter((r) => !type || (type === 'valuations') === isValuation(r.e))
  const tally = (x: string) => ofType.filter((r) => sideOf.get(r.e.id) === x)
  const newIn = (x: string) => tally(x).filter((r) => !r.e.handled).length
  const unsortedAll = tally('unsorted').length
  const rows = side ? tally(side) : ofType

  const recentFrom = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()
  const open = rows.filter((r) => !r.e.handled)
  const recent = rows.filter((r) => r.e.handled && r.e.createdAt >= recentFrom)
  const older = rows.filter((r) => r.e.handled && r.e.createdAt < recentFrom)
  const href = (p: Record<string, string>) => `/admin/enquiries?${new URLSearchParams(Object.entries({ ...(q ? { q } : {}), ...(source ? { source } : {}), ...(outcome ? { outcome } : {}), ...(imported ? { imported: '1' } : {}), ...(property ? { property } : {}), ...(side ? { side } : {}), ...(type ? { type } : {}), ...p }).filter(([, v]) => v))}`

  // Long groups show the newest 60, with a link to show the lot.
  const PAGE = 60
  const visibleOf = (id: string, list: Row[]) => (show === id ? list : list.slice(0, PAGE))
  const trail = await trailFor([...visibleOf('open', open), ...visibleOf('recent', recent), ...visibleOf('older', older)].map((r) => r.e))
  const Group = ({ id, title, sub, list }: { id: string; title: string; sub: string; list: Row[] }) => {
    const all = show === id
    const visible = visibleOf(id, list)
    return (
      <section className="card card-pad enq-group" id={id}>
        <h2>{title} · {list.length}</h2>
        <p className="card-sub">{sub}</p>
        {list.length ? <div className="enq">{visible.map((r) => <EnquiryItem key={r.e.id} {...r} trail={trail[r.e.id] ?? []} linkTo={linkTo} />)}</div> : <p className="card-sub" style={{ marginTop: 8 }}>None.</p>}
        {list.length > PAGE ? (
          <p style={{ marginTop: 12 }}>
            <Link className="btn btn-ghost btn-sm" href={`${href({ show: all ? '' : id })}#${id}`}>{all ? `Show the newest ${PAGE} only` : `Show all ${list.length}`}</Link>
          </p>
        ) : null}
      </section>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{HEAD[side || 'all'][0]}</h1>
          <p className="sub">{HEAD[side || 'all'][1]} Record what happened with the quick buttons, so the right people are suggested when new properties come on.</p>
        </div>
      </div>

      <nav className="enq-tabs" aria-label="Sales or lettings">
        <Link className={side === 'sales' ? 'on' : undefined} href={href({ side: 'sales', show: '' })}>Sales{newIn('sales') ? <span className="count">{newIn('sales')} new</span> : null}</Link>
        <Link className={side === 'lettings' ? 'on' : undefined} href={href({ side: 'lettings', show: '' })}>Lettings{newIn('lettings') ? <span className="count">{newIn('lettings')} new</span> : null}</Link>
        {unsortedAll ? <Link className={side === 'unsorted' ? 'on' : undefined} href={href({ side: 'unsorted', show: '' })}>Not sorted yet<span className="count">{unsortedAll}</span></Link> : null}
        <Link className={!side ? 'on' : undefined} href={href({ side: '', show: '' })}>All</Link>
      </nav>
      {(side === 'sales' || side === 'lettings') && newIn('unsorted') ? (
        <div className="notice" style={{ marginBottom: 14 }}>{newIn('unsorted')} new enquir{newIn('unsorted') === 1 ? 'y doesn’t' : 'ies don’t'} say whether {newIn('unsorted') === 1 ? 'it’s' : 'they’re'} sales or lettings. <Link href={href({ side: 'unsorted', show: '' })}>Sort {newIn('unsorted') === 1 ? 'it' : 'them'} now</Link></div>
      ) : null}

      <form className="filters" action="/admin/enquiries">
        <div className="field"><label htmlFor="eq-q">Search</label><input className="input" id="eq-q" name="q" defaultValue={q} placeholder="Name, phone, email or property" /></div>
        {source ? <input type="hidden" name="source" value={source} /> : null}
        {outcome ? <input type="hidden" name="outcome" value={outcome} /> : null}
        {imported ? <input type="hidden" name="imported" value="1" /> : null}
        {side ? <input type="hidden" name="side" value={side} /> : null}
        {type ? <input type="hidden" name="type" value={type} /> : null}
        <div className="field">
          <label htmlFor="eq-prop">Property</label>
          <select className="select" id="eq-prop" name="property" defaultValue={property}>
            <option value="">All properties</option>
            <option value="none">Not linked to a property</option>
            {linkTo.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <button className="btn btn-dark" type="submit">Search</button>
        <div className="seg" role="group" aria-label="Type">
          <Link className={!type ? 'on' : undefined} href={href({ type: '' })}>Everything</Link>
          <Link className={type === 'enquiries' ? 'on' : undefined} href={href({ type: 'enquiries' })}>{side === 'lettings' ? 'Tenant enquiries' : side === 'sales' ? 'Buyer enquiries' : 'Enquiries'}</Link>
          <Link className={type === 'valuations' ? 'on' : undefined} href={href({ type: 'valuations' })}>{side === 'lettings' ? 'Rental valuations' : side === 'sales' ? 'Sales valuations' : 'Valuations'}</Link>
        </div>
        <div className="seg" role="group" aria-label="Source">
          <Link className={!source ? 'on' : undefined} href={href({ source: '' })}>All</Link>
          {Object.entries(ENQUIRY_SOURCES).map(([v, l]) => <Link key={v} className={source === v ? 'on' : undefined} href={href({ source: v })}>{l}</Link>)}
        </div>
        <Link className={`btn btn-sm ${imported ? 'btn-dark' : 'btn-ghost'}`} href={href({ imported: imported ? '' : '1' })}>Imported from email</Link>
        <div className="seg" role="group" aria-label="Outcome">
          <Link className={!outcome ? 'on' : undefined} href={href({ outcome: '' })}>Any outcome</Link>
          <Link className={outcome === 'none' ? 'on' : undefined} href={href({ outcome: 'none' })}>Not recorded</Link>
          {ENQUIRY_OUTCOMES.map((o) => <Link key={o.value} className={outcome === o.value ? 'on' : undefined} href={href({ outcome: o.value })}>{o.label}</Link>)}
        </div>
      </form>

      <div className="enq-groups">
        <Group id="open" title="Needs a reply" sub="Nobody has dealt with these yet." list={open} />
        <Group id="recent" title={`Recent enquiries · last ${Math.round(RECENT_DAYS / 30)} months`} sub="Most likely to say yes. Good people to call about new properties." list={recent} />
        <Group id="older" title="Older enquiries" sub={`More than ${Math.round(RECENT_DAYS / 30)} months ago. Still worth a call if a property fits.`} list={older} />
      </div>
    </>
  )
}
