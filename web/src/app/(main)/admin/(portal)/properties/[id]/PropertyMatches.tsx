import Link from 'next/link'
import type { Property } from '@/db/schema'
import { matchesForProperty, type Match } from '@/lib/matching'
import { RECENT_DAYS, outcomeText } from '@/lib/enquiry-labels'
import { LogCallButton } from '../../LogCallButton'
import { EnquiryOutcome } from '../../EnquiryOutcome'

const when = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d < 1) return 'today'
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`
  if (d < 70) return `${Math.round(d / 7)} weeks ago`
  if (d < 700) return `${Math.round(d / 30)} months ago`
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

function Rows({ list, prop }: { list: Match[]; prop: Property }) {
  return (
    <ul className="pm-list">
      {list.map((m) => (
        <li key={m.contactId} className="pm-row">
          <div className="pm-score" title="How well they match">{m.score}</div>
          <div className="pm-main">
            <div className="pm-top">
              <Link href={`/admin/contacts/${m.contactId}`} className="pm-name">{m.name}</Link>
              {m.position ? <span className="pill">{m.position}</span> : null}
              {m.latest?.outcome ? <span className="pill gold">{outcomeText(m.latest.outcome)}</span> : null}
            </div>
            <div className="pm-meta">
              {m.phone ? <a href={`tel:${m.phone}`}>{m.phone}</a> : null}
              {m.email ? <span>{m.email}</span> : null}
              <span>Last in touch {when(m.lastAt)}</span>
            </div>
            {m.latest ? <div className="pm-what">{m.latest.label} · {new Date(m.latest.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div> : null}
            <div className="pm-reasons">{m.reasons.map((r) => <span key={r}>{r}</span>)}</div>
            {m.latest ? <EnquiryOutcome id={m.latest.id} outcome={m.latest.outcome} channel={prop.channel} /> : null}
          </div>
          <div className="pm-actions">
            <LogCallButton label="Call" className="btn btn-dark btn-sm" prefill={{ contactId: m.contactId, direction: 'out', propertyId: prop.id }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Past applicants who fit this listing, newest first, so the team knows who to ring when it comes on. */
export async function PropertyMatches({ property }: { property: Property }) {
  const { recent, older } = await matchesForProperty(property)
  const total = recent.length + older.length
  return (
    <section className="card card-pad pm" id="matches" aria-labelledby="pm-h">
      <div className="today-head">
        <div>
          <h2 id="pm-h">Applicants to call · {total}</h2>
          <p className="card-sub">People whose past enquiries or requirements fit this {property.channel === 'let' ? 'rental' : 'sale'} on price, area, bedrooms and type. Anyone marked “Do not call back” is left out.</p>
        </div>
      </div>
      {total === 0 ? (
        <p className="card-sub" style={{ marginTop: 10 }}>No matches yet. Add the price, bedrooms and postcode so we can match, and log buyers’ requirements when they call.</p>
      ) : (
        <>
          <h3 className="pm-h">Recent enquiries · last {Math.round(RECENT_DAYS / 30)} months · {recent.length}</h3>
          {recent.length ? <Rows list={recent} prop={property} /> : <p className="card-sub">None in the last {Math.round(RECENT_DAYS / 30)} months.</p>}
          <h3 className="pm-h">Older enquiries · {older.length}</h3>
          {older.length ? <Rows list={older} prop={property} /> : <p className="card-sub">None.</p>}
        </>
      )}
    </section>
  )
}
