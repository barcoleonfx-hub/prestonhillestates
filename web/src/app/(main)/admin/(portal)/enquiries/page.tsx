import Link from 'next/link'
import { and, asc, desc, eq, isNotNull, isNull, like, or, sql, type SQL } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, properties } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { ENQUIRY_OUTCOMES, ENQUIRY_SOURCES, RECENT_DAYS, enquiryLabel, enquirySide, isValuation, outcomeText, type EnquirySide } from '@/lib/enquiry-labels'
import { detailLines } from '@/lib/enquiry-workspace'
import { displayAddressFor, priceLabel } from '@/lib/properties'
import type { EnquiryRow as Row } from '../EnquiryItem'
import { removeNotEnquiry, setEnquiryHandled, setEnquirySide } from '../../actions'
import { EnquiryOutcome } from '../EnquiryOutcome'
import { LogCallButton } from '../LogCallButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Enquiries' }

const HEAD: Record<EnquirySide | 'unsorted' | 'all', [string, string]> = {
  unsorted: ['Not sorted yet', 'These don’t say whether they’re sales or lettings. Open one to deal with it and say which it is.'],
  sales: ['Sales', 'Valuations and buyer enquiries from the website, Zoopla, OnTheMarket and email. Click a person to call, book or email them.'],
  lettings: ['Lettings', 'Rental valuations and tenant enquiries from the website, Zoopla, OnTheMarket and email. Click a person to call, book or email them.'],
  all: ['All enquiries', 'Sales and lettings together. Click a person to call, book or email them.'],
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
  // Within sales or lettings, one list at a time: valuations first.
  let type: 'valuations' | 'enquiries' | '' = sp.type === 'valuations' || sp.type === 'enquiries' ? sp.type : ''
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

  // Sales or lettings, worked out per enquiry (see sortEnquiry); valuations from any source (see isValuation).
  const sideOf = new Map(found.map((r) => [r.e.id, enquirySide(r.e, r.p?.channel, r.roles) ?? 'unsorted']))
  const valOf = new Map(found.map((r) => [r.e.id, isValuation(r.e)]))
  const count = (x: string, t?: 'valuations' | 'enquiries') => {
    const list = found.filter((r) => sideOf.get(r.e.id) === x && (!t || (t === 'valuations') === valOf.get(r.e.id)))
    return { all: list.length, fresh: list.filter((r) => !r.e.handled).length }
  }
  // Sales and Lettings show one list at a time: valuations, unless only buyer/tenant enquiries are waiting.
  if (!type && (side === 'sales' || side === 'lettings')) type = count(side, 'valuations').fresh || !count(side, 'enquiries').fresh ? 'valuations' : 'enquiries'
  const rows = found.filter((r) => (!side || sideOf.get(r.e.id) === side) && (!type || (type === 'valuations') === valOf.get(r.e.id)))

  const recentFrom = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString()
  const open = rows.filter((r) => !r.e.handled)
  const recent = rows.filter((r) => r.e.handled && r.e.createdAt >= recentFrom)
  const older = rows.filter((r) => r.e.handled && r.e.createdAt < recentFrom)
  const keep = { ...(q ? { q } : {}), ...(source ? { source } : {}), ...(outcome ? { outcome } : {}), ...(imported ? { imported: '1' } : {}), ...(property ? { property } : {}), ...(side ? { side } : {}), ...(type ? { type } : {}), ...(sp.show ? { show: sp.show } : {}) }
  const href = (p: Record<string, string>) => `/admin/enquiries?${new URLSearchParams(Object.entries({ ...keep, ...p }).filter(([, v]) => v))}`
  const here = href({})
  const filtersOn = !!(source || outcome || imported || property)

  // What each row says under the name: the home it's about, and what they want.
  const whatOf = (r: Row) => {
    const lines = detailLines(r.e.message)
    const f = (re: RegExp) => lines.find((l) => l.label && re.test(l.label))?.value ?? null
    if (r.p) return `${displayAddressFor(r.p)} · ${priceLabel(r.p)}`
    const where = f(/^(address|property)$/i) ?? f(/^about$/i) ?? r.e.postcode
    const intent = r.e.kind === 'valuation' ? (r.e.intent === 'selling' ? 'Thinking of selling' : r.e.intent === 'letting' ? 'Thinking of letting' : 'Not sure yet') : f(/^(type of enquiry|wants|looking for)$/i)
    const said = !where && !intent ? f(/^(message|comments)$/i) ?? lines.find((l) => !l.label)?.value ?? f(/^(subject|email subject)$/i) : null
    return [where, intent, said].filter(Boolean).join(' · ') || 'No details given'
  }
  const ago = (iso: string) => {
    const d = (Date.now() - new Date(iso).getTime()) / 86400000
    return d < 1 ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : d < 7 ? `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined, timeZone: 'Europe/London' })
  }

  const PAGE = 60
  const Group = ({ id, title, sub, list }: { id: string; title: string; sub: string; list: Row[] }) => {
    const all = show === id
    const visible = all ? list : list.slice(0, PAGE)
    if (!list.length && id !== 'open') return null
    return (
      <section className="card enq-list" id={id}>
        <div className="enq-list-head"><h2>{title} <span>{list.length}</span></h2><p>{sub}</p></div>
        {list.length ? visible.map((r) => (
          <div key={r.e.id} className={`enq-row${r.e.handled ? '' : ' fresh'}${r.dnc ? ' dnc' : ''}`}>
            <Link href={`/admin/enquiries/${r.e.id}?back=${encodeURIComponent(here)}`} className="enq-link">
              <span className="enq-av" aria-hidden="true">{r.e.name.trim()[0]?.toUpperCase() ?? '?'}</span>
              <span className="enq-main">
                <span className="enq-name">{r.e.name}{!r.e.handled ? <span className="pill gold">New</span> : null}{r.e.outcome ? <span className="pill">{outcomeText(r.e.outcome)}</span> : null}{r.dnc ? <span className="pill warn">Do not contact</span> : null}</span>
                <span className="enq-what">{whatOf(r)}</span>
              </span>
              <span className="enq-src">{enquiryLabel(r.e).replace(/ (enquiry|request|registration|viewing request|valuation request)$/i, '')}<small>{ago(r.e.createdAt)}</small></span>
              <span className="enq-go" aria-hidden="true">›</span>
            </Link>
            <div className="enq-acts">
              {!r.dnc && r.e.phone ? <LogCallButton label="Call" className="btn btn-dark btn-sm" prefill={{ name: r.e.name, phone: r.e.phone ?? undefined, email: r.e.email ?? undefined, enquiryId: r.e.id, direction: 'out', propertyId: r.e.propertyId ?? undefined, callerType: valOf.get(r.e.id) ? (sideOf.get(r.e.id) === 'lettings' ? 'landlord' : 'seller') : sideOf.get(r.e.id) === 'lettings' ? 'tenant' : 'buyer', ...(r.e.contactId ? { contactId: r.e.contactId } : {}) }} /> : null}
              {!r.dnc && r.e.email ? <Link className="btn btn-ghost btn-sm" href={`/admin/enquiries/${r.e.id}?back=${encodeURIComponent(here)}#email`}>Email</Link> : null}
              {!r.dnc ? <Link className="btn btn-ghost btn-sm" href={`/admin/diary/new?enquiry=${r.e.id}${valOf.get(r.e.id) ? '&kind=valuation' : ''}`}>{valOf.get(r.e.id) ? 'Book valuation' : 'Book viewing'}</Link> : null}
              <span className="enq-acts-sep" aria-hidden="true" />
              <EnquiryOutcome id={r.e.id} outcome={r.e.outcome} channel={r.p?.channel ?? (sideOf.get(r.e.id) === 'lettings' ? 'let' : 'sale')} />
              <span className="enq-acts-sep" aria-hidden="true" />
              <form action={setEnquiryHandled}>
                <input type="hidden" name="id" value={r.e.id} />
                <input type="hidden" name="handled" value={r.e.handled ? '0' : '1'} />
                <button className="btn btn-ghost btn-sm" type="submit">{r.e.handled ? 'Mark as new' : 'Dealt with'}</button>
              </form>
              {sideOf.get(r.e.id) === 'unsorted' ? (
                <>
                  <span className="enq-acts-sep" aria-hidden="true" />
                  {(['sales', 'lettings'] as const).map((x) => (
                    <form key={x} action={setEnquirySide}><input type="hidden" name="id" value={r.e.id} /><input type="hidden" name="side" value={x} /><button className="btn btn-ghost btn-sm" type="submit">{x === 'sales' ? 'It’s sales' : 'It’s lettings'}</button></form>
                  ))}
                  <form action={removeNotEnquiry}><input type="hidden" name="id" value={r.e.id} /><button className="btn btn-ghost btn-sm enq-junk" type="submit" title="Remove it: an account email, newsletter or similar">Not an enquiry</button></form>
                </>
              ) : null}
            </div>
          </div>
        )) : <p className="enq-empty">Nothing waiting. Nice work.</p>}
        {list.length > PAGE ? <p className="enq-more"><Link className="btn btn-ghost btn-sm" href={`${href({ show: all ? '' : id })}#${id}`}>{all ? `Show the newest ${PAGE} only` : `Show all ${list.length}`}</Link></p> : null}
      </section>
    )
  }

  const Choice = ({ label, sub, c, to, on }: { label: string; sub: string; c: { all: number; fresh: number }; to: Record<string, string>; on: boolean }) => (
    <Link className={`enq-choice${on ? ' on' : ''}`} href={href({ ...to, show: '' })}>
      <span className="t">{label}</span>
      <span className="s">{sub}</span>
      <span className="n">{c.fresh ? <b>{c.fresh} new</b> : null}<span>{c.all} in all</span></span>
    </Link>
  )
  const isLet = side === 'lettings'
  const unsortedCount = count('unsorted')

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{HEAD[side || 'all'][0]}</h1>
          <p className="sub">{HEAD[side || 'all'][1]}</p>
        </div>
      </div>

      {side === 'unsorted' ? (
        <div className="notice enq-why-box">
          <b>Why these aren’t sorted:</b> each one has been checked against its wording, the listing price, the email subject, the original email (where the portal has it), the address against every listing we’ve had, and the person’s other enquiries. None of those say sales or lettings: usually it’s just an address that isn’t one of our listings, or a message like “please call me”. Press <b>Sales</b> or <b>Lettings</b> on each one (it takes a second), or open it to see everything it says.{' '}
          <a href="/admin/enquiries/export?side=unsorted">Download them as a spreadsheet</a>
        </div>
      ) : null}
      <div className="enq-choices">
        {side ? (
          <>
            <Choice label={isLet ? 'Rental valuations' : side === 'unsorted' ? 'Valuations' : 'Valuations'} sub={isLet ? 'Landlords asking what their property would let for' : side === 'unsorted' ? 'Asking for a valuation' : 'Owners asking what their home is worth'} c={count(side, 'valuations')} to={{ type: 'valuations' }} on={type === 'valuations'} />
            <Choice label={isLet ? 'Tenant enquiries' : side === 'unsorted' ? 'Other enquiries' : 'Buyer enquiries'} sub={isLet ? 'People asking about homes to rent' : side === 'unsorted' ? 'Everything else' : 'People asking about homes for sale'} c={count(side, 'enquiries')} to={{ type: 'enquiries' }} on={type === 'enquiries'} />
          </>
        ) : (
          <>
            <Choice label="Sales" sub="Valuations and buyers" c={count('sales')} to={{ side: 'sales', type: 'valuations' }} on={false} />
            <Choice label="Lettings" sub="Rental valuations and tenants" c={count('lettings')} to={{ side: 'lettings', type: 'valuations' }} on={false} />
          </>
        )}
      </div>
      {side !== 'unsorted' && unsortedCount.all ? (
        <p className="enq-unsorted"><Link href={href({ side: 'unsorted', type: '', show: '' })}>{unsortedCount.all} enquir{unsortedCount.all === 1 ? 'y doesn’t' : 'ies don’t'} say whether {unsortedCount.all === 1 ? 'it’s' : 'they’re'} sales or lettings{unsortedCount.fresh ? ` (${unsortedCount.fresh} new)` : ''} →</Link></p>
      ) : null}

      <form className="enq-search" action="/admin/enquiries">
        {Object.entries(keep).filter(([k]) => k !== 'q' && k !== 'show').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input className="input" name="q" defaultValue={q} placeholder="Search by name, phone, email or address" aria-label="Search" />
        <button className="btn btn-dark" type="submit">Search</button>
        {q ? <Link className="btn btn-ghost" href={href({ q: '' })}>Clear</Link> : null}
      </form>
      <details className="enq-filters" open={filtersOn}>
        <summary>More filters{filtersOn ? ' (on)' : ''}</summary>
        <div className="filters">
          <div className="seg" role="group" aria-label="Source">
            <Link className={!source ? 'on' : undefined} href={href({ source: '' })}>Any source</Link>
            {Object.entries(ENQUIRY_SOURCES).map(([v, l]) => <Link key={v} className={source === v ? 'on' : undefined} href={href({ source: v })}>{l}</Link>)}
          </div>
          <div className="seg" role="group" aria-label="Outcome">
            <Link className={!outcome ? 'on' : undefined} href={href({ outcome: '' })}>Any outcome</Link>
            <Link className={outcome === 'none' ? 'on' : undefined} href={href({ outcome: 'none' })}>Not recorded</Link>
            {ENQUIRY_OUTCOMES.map((o) => <Link key={o.value} className={outcome === o.value ? 'on' : undefined} href={href({ outcome: o.value })}>{o.label}</Link>)}
          </div>
          <Link className={`btn btn-sm ${imported ? 'btn-dark' : 'btn-ghost'}`} href={href({ imported: imported ? '' : '1' })}>Imported from email</Link>
          <form action="/admin/enquiries" className="enq-prop-filter">
            {Object.entries(keep).filter(([k]) => k !== 'property').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <select className="select" name="property" defaultValue={property} aria-label="Property">
              <option value="">Any property</option>
              <option value="none">Not about one of our listings</option>
              {linkTo.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" type="submit">Show</button>
          </form>
        </div>
      </details>

      <div className="enq-groups">
        <Group id="open" title="Needs a reply" sub="Nobody has dealt with these yet." list={open} />
        <Group id="recent" title={`Recent · last ${Math.round(RECENT_DAYS / 30)} months`} sub="Most likely to say yes: good people to call about new properties." list={recent} />
        <Group id="older" title="Older" sub={`More than ${Math.round(RECENT_DAYS / 30)} months ago. Still worth a call if a property fits.`} list={older} />
      </div>
    </>
  )
}
