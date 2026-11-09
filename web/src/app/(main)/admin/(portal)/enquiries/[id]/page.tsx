import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { SIDE_LABEL, enquiryLabel, outcomeText } from '@/lib/enquiry-labels'
import { trailFor } from '@/lib/enquiry-trail'
import { enquiryWorkspace } from '@/lib/enquiry-workspace'
import { displayAddressFor, priceLabel } from '@/lib/properties'
import { removeNotEnquiry, setEnquiryHandled, setEnquirySide } from '../../../actions'
import { EnquiryNotes } from '../../EnquiryNotes'
import { EnquiryOutcome } from '../../EnquiryOutcome'
import { LogCallButton } from '../../LogCallButton'
import { EmailComposer } from './EmailComposer'
import { ReplyBox } from './ReplyBox'
import { conversation } from '@/lib/enquiry-thread'
import { ValuationCheck } from './ValuationCheck'
import { homeFrom, portalLinks } from '@/lib/valuation-check'
import { landRegistryEstimate, rentCheck } from '@/lib/valuation-check-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Enquiry' }

const KIND_TITLE = { 'sales-valuation': 'Sales valuation', 'lettings-valuation': 'Rental valuation', buyer: 'Buyer enquiry', tenant: 'Tenant enquiry' } as const

/** One enquiry, as a place to act on it: what they asked, the next steps, and ready-made emails to send. */
export default async function EnquiryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string; tpl?: string }> }) {
  const me = await requireAdmin()
  const { id } = await params
  const sp = await searchParams
  const w = await enquiryWorkspace(id, me)
  if (!w) notFound()
  const { e, p, contact, sorted, valuation, kind, ctx, lines } = w
  const [trail, thread] = await Promise.all([trailFor([e]).then((t) => t[e.id] ?? []), conversation(e.id)])
  // The valuation check: our estimate, the portal searches, comparables and the figure.
  const rent = kind === 'lettings-valuation'
  const home = homeFrom(e.message)
  const month = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  const lr = !valuation || !ctx.postcode ? null : rent
    ? await rentCheck(ctx.postcode, home.beds).then((r) => r && { low: r.low, mid: r.mid, high: r.high, count: Math.max(r.count, 1), label: `from ${r.basis}${home.beds != null ? `, ${home.beds} bed` : ''}`, rows: r.nearby.map((n) => ({ where: n.area, what: `${n.beds} bed · ${n.km} km away`, price: n.rent })) })
    : await landRegistryEstimate(ctx.postcode, home.type).then((r) => r && { low: r.low, mid: r.mid, high: r.high, count: r.count, label: `${r.count} sales ${r.where}, last 2 years${r.typed ? `, ${home.typeLabel?.toLowerCase() ?? 'same type'}` : ', all types of home'}`, rows: r.comps.map((c) => ({ where: [c.street, c.postcode].filter(Boolean).join(', '), what: `${c.typeLabel} · ${month(c.soldOn)}${c.metres != null ? ` · ${c.metres < 1000 ? `${c.metres} m` : `${(c.metres / 1000).toFixed(1)} km`} away` : ''}`, price: c.price })) })
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
            {e.lastReplyAt && !e.handled ? <span className="pill gold">Replied</span> : null}
            {dnc ? <span className="pill warn">Do not contact</span> : null}
          </div>
        </div>
        <div className="ew-head-actions">
          {!dnc && e.phone ? <LogCallButton label="Call them" className="btn btn-dark" prefill={{ name: e.name, phone: e.phone ?? undefined, email: e.email ?? undefined, enquiryId: e.id, direction: 'out', propertyId: e.propertyId ?? undefined, callerType, ...(e.contactId ? { contactId: e.contactId } : {}) }} /> : null}
          {!dnc ? <Link className="btn btn-gold" href={`/admin/diary/new?enquiry=${e.id}${valuation ? '&kind=valuation' : ''}`}>{valuation ? 'Book valuation' : 'Book viewing'}</Link> : null}
        </div>
      </div>

      {valuation ? (
        <section className="card card-pad ew-check" id="check">
          <h2>Valuation check{home.typeLabel || home.beds != null ? <small> · {[home.typeLabel, home.beds != null ? `${home.beds} bed` : null].filter(Boolean).join(', ')}{ctx.postcode ? `, ${ctx.postcode}` : ''}</small> : ctx.postcode ? <small> · {ctx.postcode}</small> : null}</h2>
          <ValuationCheck id={e.id} rent={rent} lr={lr} links={portalLinks(ctx.postcode, { rent, beds: home.beds })} saved={w.saved} home={home.typeLabel} />
        </section>
      ) : null}

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
            <details className="ew-remove">
              <summary>Not an enquiry?</summary>
              <p>If this is an account email, a newsletter or anything else that isn’t someone asking about a property, remove it.</p>
              <form action={removeNotEnquiry}>
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="back" value={back} />
                <button className="btn btn-ghost btn-sm" type="submit">Remove it from enquiries</button>
              </form>
            </details>
          </section>
        </div>

        <div className="ew-main">
        <section className="card card-pad cv" id="conversation">
          <h2>Conversation{thread.length ? <small> · {thread.length} email{thread.length === 1 ? '' : 's'}</small> : null}</h2>
          <div className="cv-list">
            <div className="cv-msg in">
              <div className="cv-meta"><b>{e.name}</b> · {enquiryLabel(e)} · {new Date(e.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}</div>
              <div className="cv-body">{lines.length ? lines.slice(0, 8).map((l) => (l.label ? `${l.label}: ${l.value}` : l.value)).join('\n') : 'No message.'}</div>
            </div>
            {thread.map((m) => (
              <div key={m.id} className={`cv-msg ${m.direction}`}>
                <div className="cv-meta">
                  <b>{m.direction === 'in' ? e.name : 'Preston Hill Estates'}</b>{m.via === 'mailbox' ? ' · sent from Apple Mail' : ''} · {new Date(m.sentAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}
                  {m.subject ? <span className="cv-subj">{m.subject}</span> : null}
                </div>
                <div className="cv-body">{m.body || '(no text)'}</div>
              </div>
            ))}
          </div>
          {thread.length ? null : <p className="cv-note">When you email {e.name.split(/\s+/)[0]} from here, the email and their reply appear in this conversation.</p>}
          <ReplyBox id={e.id} name={e.name.split(/\s+/)[0]} disabled={dnc ? 'This person asked not to be contacted.' : !e.email ? 'There’s no email address for this person.' : !w.mailboxReady ? 'Connect the office mailbox (Email settings) to reply from here.' : null} />
        </section>

        <section className="card card-pad ew-email" id="email">
          <h2>Email {e.name.split(/\s+/)[0]}</h2>
          <p className="card-sub">Choose an email, check the wording, and send it. It goes from the office mailbox and is noted here.</p>
          <EmailComposer key={`${sp.tpl ?? ''}|${ctx.figure ?? ''}`} start={sp.tpl} id={e.id} ctx={ctx} to={e.email} canSend={!blocked} blocked={blocked} chooseKind={!sorted.side} />
        </section>
        </div>
      </div>
    </>
  )
}
