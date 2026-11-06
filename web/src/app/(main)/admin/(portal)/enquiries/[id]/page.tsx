import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { SIDE_LABEL, enquiryLabel, outcomeText } from '@/lib/enquiry-labels'
import { trailFor } from '@/lib/enquiry-trail'
import { enquiryWorkspace } from '@/lib/enquiry-workspace'
import { displayAddressFor, priceLabel } from '@/lib/properties'
import { setEnquiryHandled, setEnquirySide } from '../../../actions'
import { EnquiryNotes } from '../../EnquiryNotes'
import { EnquiryOutcome } from '../../EnquiryOutcome'
import { LogCallButton } from '../../LogCallButton'
import { EmailComposer } from './EmailComposer'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Enquiry' }

const KIND_TITLE = { 'sales-valuation': 'Sales valuation', 'lettings-valuation': 'Rental valuation', buyer: 'Buyer enquiry', tenant: 'Tenant enquiry' } as const

/** One enquiry, as a place to act on it: what they asked, the next steps, and ready-made emails to send. */
export default async function EnquiryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> }) {
  const me = await requireAdmin()
  const { id } = await params
  const sp = await searchParams
  const w = await enquiryWorkspace(id, me)
  if (!w) notFound()
  const { e, p, contact, sorted, valuation, kind, ctx, lines } = w
  const trail = (await trailFor([e]))[e.id] ?? []
  const back = sp.back && sp.back.startsWith('/admin/enquiries') ? sp.back : `/admin/enquiries?side=${sorted.side ?? 'unsorted'}&type=${valuation ? 'valuations' : 'enquiries'}`
  const dnc = !!contact?.doNotContact
  const callerType = valuation ? (sorted.side === 'lettings' ? 'landlord' : 'seller') : sorted.side === 'lettings' ? 'tenant' : 'buyer'
  const blocked = dnc ? 'This person asked not to be contacted.' : !e.email ? 'There’s no email address for this person: call them instead.' : !w.mailboxReady ? 'Connect the office mailbox (Email settings) to send emails from here.' : null
  const moveTo = (to: 'sales' | 'lettings') => (
    <form action={setEnquirySide}>
      <input type="hidden" name="id" value={e.id} />
      <input type="hidden" name="side" value={to} />
      <button className="btn btn-ghost btn-sm" type="submit">{sorted.side ? `Move to ${to}` : `It’s ${to}`}</button>
    </form>
  )

  return (
    <>
      <p className="ew-back"><Link href={back}>← Back to the list</Link></p>
      <div className="ew-head">
        <div className="ew-avatar" aria-hidden="true">{e.name.trim()[0]?.toUpperCase() ?? '?'}</div>
        <div style={{ minWidth: 0 }}>
          <div className="ew-kicker">{KIND_TITLE[kind]}{sorted.side ? '' : ' (not sorted yet)'} · {enquiryLabel(e)}</div>
          <h1>{e.name}</h1>
          <div className="ew-meta">
            {e.phone ? <a href={`tel:${e.phone.replace(/\s/g, '')}`}>{e.phone}</a> : null}
            {e.email ? <a href={`mailto:${e.email}`}>{e.email}</a> : null}
            <span>{new Date(e.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}</span>
          </div>
          <div className="ew-pills">
            {!e.handled ? <span className="pill gold">New</span> : <span className="pill">Dealt with</span>}
            {sorted.side ? <span className={`pill side-${sorted.side}`}>{SIDE_LABEL[sorted.side]}</span> : <span className="pill warn">Sales or lettings?</span>}
            {e.outcome ? <span className="pill">{outcomeText(e.outcome)}</span> : null}
            {dnc ? <span className="pill warn">Do not contact</span> : null}
          </div>
        </div>
        <div className="ew-head-actions">
          {!dnc && e.phone ? <LogCallButton label="Call them" className="btn btn-dark" prefill={{ name: e.name, phone: e.phone ?? undefined, email: e.email ?? undefined, enquiryId: e.id, direction: 'out', propertyId: e.propertyId ?? undefined, callerType, ...(e.contactId ? { contactId: e.contactId } : {}) }} /> : null}
          {!dnc ? <Link className="btn btn-gold" href={`/admin/diary/new?enquiry=${e.id}${valuation ? '&kind=valuation' : ''}`}>{valuation ? 'Book valuation' : 'Book viewing'}</Link> : null}
        </div>
      </div>

      <div className="ew-grid">
        <div className="ew-side">
          <section className="card card-pad">
            <h2>{valuation ? 'Their property' : 'What they asked about'}</h2>
            {p ? (
              <Link href={`/admin/properties/${p.id}`} className="ew-prop">
                <span className="ew-prop-img">{p.media.find((m) => m.kind === 'photo') ? <img src={p.media.find((m) => m.kind === 'photo')!.url} alt="" /> : null}</span>
                <span><b>{priceLabel(p)}</b><span>{displayAddressFor(p)}</span><small>{p.ref}</small></span>
              </Link>
            ) : null}
            {ctx.address || ctx.postcode ? <p className="ew-addr">{[ctx.address, ctx.postcode].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')}</p> : null}
            {e.kind === 'valuation' ? <p className="ew-intent">{e.intent === 'selling' ? 'Thinking of selling' : e.intent === 'letting' ? 'Thinking of letting' : 'Not sure yet whether to sell or let'}</p> : null}
            {lines.length ? (
              <dl className="ew-lines">
                {lines.map((l, i) => l.label ? <div key={i}><dt>{l.label}</dt><dd>{l.value}</dd></div> : <p key={i}>{l.value}</p>)}
              </dl>
            ) : null}
            <p className="ew-why">{sorted.side ? `On the ${sorted.side} list because: ${sorted.why}` : 'Couldn’t tell if this is sales or lettings.'}</p>
            <div className="ew-move">{sorted.side ? moveTo(sorted.side === 'sales' ? 'lettings' : 'sales') : <>{moveTo('sales')}{moveTo('lettings')}</>}</div>
          </section>

          <section className="card card-pad">
            <h2>What happened</h2>
            <EnquiryOutcome id={e.id} outcome={e.outcome} channel={p?.channel ?? (sorted.side === 'lettings' ? 'let' : 'sale')} />
            <EnquiryNotes id={e.id} trail={trail} />
            <div className="actions" style={{ marginTop: 10 }}>
              <form action={setEnquiryHandled}>
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="handled" value={e.handled ? '0' : '1'} />
                <button className="btn btn-ghost btn-sm" type="submit">{e.handled ? 'Mark as new again' : 'Mark as dealt with'}</button>
              </form>
              {e.contactId ? <Link className="btn btn-ghost btn-sm" href={`/admin/contacts/${e.contactId}`}>Their record</Link> : null}
            </div>
          </section>
        </div>

        <section className="card card-pad ew-email">
          <h2>Email {e.name.split(/\s+/)[0]}</h2>
          <p className="card-sub">Choose an email, check the wording, and send it. It goes from the office mailbox and is noted here.</p>
          <EmailComposer id={e.id} ctx={ctx} to={e.email} canSend={!blocked} blocked={blocked} chooseKind={!sorted.side} />
        </section>
      </div>
    </>
  )
}
