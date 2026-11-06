import Link from 'next/link'
import type { enquiries, properties } from '@/db/schema'
import { SIDE_LABEL, enquiryLabel, isValuation, outcomeText, sortEnquiry } from '@/lib/enquiry-labels'
import { displayAddressFor } from '@/lib/properties'
import type { TrailItem } from '@/lib/enquiry-trail'
import { setEnquiryHandled, setEnquirySide } from '../actions'
import { linkEnquiry } from '../crm-actions'
import { EnquiryNotes } from './EnquiryNotes'
import { EnquiryOutcome } from './EnquiryOutcome'
import { LogCallButton } from './LogCallButton'

export type EnquiryRow = { e: typeof enquiries.$inferSelect; p: typeof properties.$inferSelect | null; dnc: boolean | null; roles?: string | null }

/**
 * One enquiry: who, when, what about, the quick outcome buttons, comments and calls, and the actions.
 * `linkTo` lists our properties so an enquiry the import couldn't place can be linked by hand.
 */
export function EnquiryItem({ e, p, dnc, roles, trail, linkTo, onProperty = false, times = 1 }: EnquiryRow & { trail: TrailItem[]; linkTo?: { id: string; label: string }[]; onProperty?: boolean; times?: number }) {
  const sorted = sortEnquiry(e, p?.channel, roles)
  const side = sorted.side
  const valuation = isValuation(e)
  const callerType = valuation ? (side === 'lettings' ? 'landlord' : 'seller') : side === 'lettings' ? 'tenant' : 'buyer'
  const moveTo = (to: 'sales' | 'lettings', label: string, cls = 'btn btn-ghost btn-sm') => (
    <form action={setEnquirySide}>
      <input type="hidden" name="id" value={e.id} />
      <input type="hidden" name="side" value={to} />
      <button className={cls} type="submit">{label}</button>
    </form>
  )
  return (
    <div className={`enq-item${dnc ? ' dnc' : ''}`} id={`enq-${e.id}`}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="who">
          {e.contactId ? <Link href={`/admin/contacts/${e.contactId}`} className="enq-name">{e.name}</Link> : e.name}{' '}
          {!e.handled ? <span className="pill gold">New</span> : null}{' '}
          <span className="pill">{enquiryLabel(e)}</span>{' '}
          {side ? <span className={`pill side-${side}`} title={`Why: ${sorted.why}`}>{SIDE_LABEL[side]}</span> : <span className="pill warn">Sales or lettings?</span>}{' '}
          {times > 1 ? <span className="pill gold">Enquired {times} times</span> : null}{' '}
          {e.outcome ? <span className={`pill${e.outcome === 'do_not_call' ? ' warn' : ''}`}>{outcomeText(e.outcome)}</span> : null}{' '}
          {dnc && e.outcome !== 'do_not_call' ? <span className="pill warn">Do not call</span> : null}
        </div>
        <div className="what">
          {e.phone ? <a href={`tel:${e.phone.replace(/\s/g, '')}`}>{e.phone}</a> : null}{e.phone && e.email ? ' · ' : ''}{e.email}
          {' · '}{new Date(e.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}
          {p && !onProperty ? <> · <Link href={`/admin/properties/${p.id}#enquiries`}>{p.ref} {displayAddressFor(p)}</Link></> : null}
        </div>
        {side ? <div className="enq-why">{SIDE_LABEL[side]} because: {sorted.why}</div> : null}
        {e.kind === 'valuation' && e.postcode ? (
          <p className="msg">Property postcode <b>{e.postcode}</b> · {e.intent === 'selling' ? 'Thinking of selling' : e.intent === 'letting' ? 'Thinking of letting' : 'Not sure yet'}</p>
        ) : null}
        {e.message ? (
          <details className="enq-msg">
            <summary>{e.message.split('\n').find((l) => l.trim())?.slice(0, 140)}</summary>
            <p className="msg pre">{e.message}</p>
          </details>
        ) : null}
        {!p && e.kind !== 'valuation' && linkTo?.length ? (
          <form action={linkEnquiry} className="enq-link">
            <input type="hidden" name="id" value={e.id} />
            <label htmlFor={`lk-${e.id}`}>Not linked to a property</label>
            <select className="select" id={`lk-${e.id}`} name="propertyId" defaultValue="">
              <option value="" disabled>Choose the property…</option>
              {linkTo.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" type="submit">Link</button>
          </form>
        ) : null}
        {!side ? (
          <div className="enq-side">
            <span>Couldn’t tell if this is sales or lettings:</span>
            {moveTo('sales', 'It’s sales', 'btn btn-dark btn-sm')}
            {moveTo('lettings', 'It’s lettings', 'btn btn-dark btn-sm')}
          </div>
        ) : null}
        <EnquiryOutcome id={e.id} outcome={e.outcome} channel={p?.channel ?? (callerType === 'tenant' ? 'let' : 'sale')} />
        <EnquiryNotes id={e.id} trail={trail} />
      </div>
      <div className="enq-actions">
        {!dnc ? (
          <LogCallButton
            label="Call them" className="btn btn-dark btn-sm"
            prefill={{
              name: e.name, phone: e.phone ?? undefined, email: e.email ?? undefined, enquiryId: e.id, direction: 'out', propertyId: e.propertyId ?? undefined,
              callerType, ...(e.contactId ? { contactId: e.contactId } : {}),
            }}
          />
        ) : null}
        {!dnc ? <Link className="btn btn-gold btn-sm" href={`/admin/diary/new?enquiry=${e.id}`}>{valuation ? 'Book valuation' : 'Book viewing'}</Link> : null}
        {e.contactId ? <Link className="btn btn-ghost btn-sm" href={`/admin/contacts/${e.contactId}`}>Record</Link> : null}
        <form action={setEnquiryHandled}>
          <input type="hidden" name="id" value={e.id} />
          <input type="hidden" name="handled" value={e.handled ? '0' : '1'} />
          <button className="btn btn-ghost btn-sm" type="submit">{e.handled ? 'Mark as new' : 'Mark handled'}</button>
        </form>
        {side ? moveTo(side === 'sales' ? 'lettings' : 'sales', side === 'sales' ? 'Move to lettings' : 'Move to sales') : null}
      </div>
    </div>
  )
}
