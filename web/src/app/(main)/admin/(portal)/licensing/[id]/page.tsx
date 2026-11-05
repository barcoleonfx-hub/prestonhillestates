import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { rentalView } from '@/lib/licensing'
import { COUNCILS, bucketOf, councilLabel, fmtDay, inWords, kindLabel, OCCUPANCY } from '@/lib/licensing-rules'
import { archiveRental, confirmPostcode, lookUpArea, markChecked } from '../../../licensing-actions'
import { hitsFor } from '@/lib/council-registers'
import { epcUrl } from '@/lib/epc'
import { LicenceList } from '../LicenceList'
import { RentalForm } from '../RentalForm'
import { bestOf, documentsFor, suggestionsFor } from '@/lib/licensing-scan'
import { SuggestionReview } from '../found/SuggestionReview'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Licensing' }

export default async function RentalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  await requireAdmin()
  const { id } = await params
  const sp = await searchParams
  const v = await rentalView(id)
  if (!v) notFound()
  const { row: r } = v
  const [found, docs, hits] = await Promise.all([suggestionsFor([r.id]).then(bestOf), documentsFor(r.id), hitsFor([r.id])])
  const KIND: Record<string, string> = { licence: 'Licence', gas: 'Gas safety', eicr: 'EICR', epc: 'EPC' }
  const b = bucketOf(r.a.bucket)
  const council = COUNCILS.find((c) => c.value === r.council)
  const mail = r.landlordEmail && r.a.licence?.expiresOn ? `mailto:${r.landlordEmail}?subject=${encodeURIComponent(`Licence renewal: ${r.address}`)}&body=${encodeURIComponent(`Dear ${r.landlordName ?? 'landlord'},\n\nThe ${kindLabel(r.a.licence.kind).toLowerCase()} for ${r.address}${r.a.licence.number ? ` (${r.a.licence.number})` : ''} runs out on ${fmtDay(r.a.validUntil)}. To keep letting it legally, a renewal needs to be made before then.\n\nCould you let us know how you'd like to proceed? We're happy to handle the application for you.\n\nKind regards,\nPreston Hill Estates\n020 8127 7001`)}` : null
  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/licensing" style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← Licensing register</Link>
          <h1 style={{ marginTop: 6 }}>{r.address}</h1>
          {r.resolvedAddress && r.resolvedAddress.toLowerCase() !== r.address.toLowerCase() ? <p className="sub" style={{ marginTop: 2 }}>Read as <b>{r.resolvedAddress}</b> (used to match council registers and emails)</p> : null}
          <p className="sub">{[r.postcode, r.council ? `${councilLabel(r.council)}${r.ward ? `, ${r.ward} ward` : ''}` : 'Council not known yet', OCCUPANCY.find((o) => o.value === r.occupancy)?.label].filter(Boolean).join(' · ')}{r.wardSource === 'manual' ? ' (chosen by hand)' : ''}</p>
        </div>
        <div className="actions">
          {r.archived ? null : <form action={archiveRental}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="on" value="1" /><button className="btn btn-ghost" type="submit">No longer with us</button></form>}
        </div>
      </div>
      {sp.saved ? <div className="notice ok" style={{ marginBottom: 14 }}>Saved.</div> : null}
      {r.postcode && (r.postcodeSource === 'land_registry' || r.postcodeSource === 'online') ? (
        <div className="notice lic-pcnote">
          <span><b>Postcode {r.postcode} was found automatically</b>{r.postcodeNote ? `: ${r.postcodeNote.replace(/^Found (from|by) /, 'from ')}` : ''}. Check it’s right; if not, correct it under Details.</span>
          <form action={confirmPostcode}><input type="hidden" name="id" value={r.id} /><button className="btn btn-ghost btn-sm" type="submit">It’s right</button></form>
        </div>
      ) : !r.postcode ? <div className="notice err" style={{ marginBottom: 14 }}>No postcode yet{r.postcodeNote ? ` (${r.postcodeNote.toLowerCase()})` : ''}. Add it under Details so the council and ward can be checked.</div> : null}

      <section className={`card card-pad lic-status t-${b.tone}`}>
        <div className="today-head">
          <div>
            <span className={`lic-pill t-${b.tone}`}>{b.label}</span>
            {r.a.days != null && r.a.validUntil ? <span className="lic-days">{inWords(r.a.days)}</span> : null}
            <ul className="lic-reasons">{r.a.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
            <p className="card-sub">{b.about}</p>
          </div>
          <div className="lic-check">
            {council?.register ? <a className="btn btn-dark btn-sm" href={council.register} target="_blank" rel="noreferrer">Check {council.label}’s register</a> : null}
            <form action={markChecked}><input type="hidden" name="id" value={r.id} /><button className="btn btn-ghost btn-sm" type="submit">I’ve checked it on the register today</button></form>
            <span className="addr-sub">{r.lastCheckedAt ? `Last checked ${new Date(r.lastCheckedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${r.lastCheckedBy ? ` by ${r.lastCheckedBy}` : ''}` : 'Not checked on the council register yet'}</span>
            {council?.contact ? <span className="addr-sub">{council.contact}</span> : null}
            {r.wardSource !== 'auto' || !r.ward ? <form action={lookUpArea}><input type="hidden" name="id" value={r.id} /><button className="lic-linkish" type="submit">Look the ward up from the postcode again</button></form> : null}
            {mail ? <a className="btn btn-ghost btn-sm" href={mail}>Email the landlord about renewing</a> : null}
          </div>
        </div>
        {hits.length ? (
          <div className="lic-reghits">
            {hits.map(({ h, r: g }) => (
              <div key={g.id} className={h.found ? 'on' : 'off'}>
                <b>{h.found ? `On the ${g.name}` : `Not on the ${g.name}`}</b>
                <span>{h.found ? [h.reference ? `Ref ${h.reference}` : null, h.kind ? kindLabel(h.kind) : null, h.startsOn ? `from ${fmtDay(h.startsOn)}` : null, h.expiresOn ? `until ${fmtDay(h.expiresOn)}` : null].filter(Boolean).join(' · ') || 'Listed' : 'Applications still being processed aren’t listed. If it should be licensed, check with the council.'}</span>
                <small>Checked {fmtDay(h.checkedAt.slice(0, 10))}{g.asOf ? ` against the register dated ${g.asOf}` : ''}{h.found && h.line ? `: “${h.line.slice(0, 160)}”` : ''}</small>
              </div>
            ))}
          </div>
        ) : null}
        <div className="lic-certrow">
          {r.a.certs.map((c) => (
            <div key={c.key} className={`lic-certbox s-${c.state}`}>
              <b>{c.label}</b>
              <span>{c.date ? `${c.days! < 0 ? 'Expired' : 'Until'} ${fmtDay(c.date)}` : 'Not on file'}{c.days != null && c.days >= 0 ? ` · ${inWords(c.days)}` : ''}</span>
              {c.note ? <small>{c.note}</small> : null}
              {c.key === 'epc' && r.epcRef ? <a className="lic-linkish" href={epcUrl(r.epcRef)!} target="_blank" rel="noreferrer">View the EPC on GOV.UK{r.epcRating ? ` (rated ${r.epcRating})` : ''}</a> : c.key === 'epc' && r.epcCheckedAt ? <small>None found on GOV.UK for this address ({fmtDay(r.epcCheckedAt.slice(0, 10))})</small> : null}
            </div>
          ))}
        </div>
      </section>

      {found.length ? (
        <section className="card card-pad lic-found" style={{ marginTop: 18 }}>
          <h2>Found in our emails</h2>
          <p className="card-sub" style={{ margin: '4px 0 12px' }}>Details read from emails that mention this address. Check them, then use or dismiss each one.</p>
          <SuggestionReview compact groups={[{ rentalId: r.id, address: r.address, items: found, current: { licence: r.a.licence ? `${r.a.licence.number ?? 'licence'}${r.a.licence.expiresOn ? ` until ${fmtDay(r.a.licence.expiresOn)}` : ''}` : null, gas: r.gasExpires ? fmtDay(r.gasExpires) : null, eicr: r.eicrExpires ? fmtDay(r.eicrExpires) : null, epc: r.epcExpires ? fmtDay(r.epcExpires) : null } }]} />
        </section>
      ) : null}

      <section className="card card-pad" style={{ marginTop: 18 }}>
        <h2>Licences</h2>
        <p className="card-sub" style={{ margin: '4px 0 12px' }}>{r.a.needed ? `This property needs a ${kindLabel(r.a.needed).toLowerCase()}.` : r.a.upcoming ? `A ${kindLabel(r.a.upcoming.kind).toLowerCase()} will be needed from ${fmtDay(r.a.upcoming.scheme.startsOn)}.` : 'No licence is needed at the moment, but you can keep one on record here.'} Add applications as soon as they’re made: a pending application protects the landlord while the council decides.</p>
        <LicenceList rentalId={r.id} list={r.licences} countingId={r.a.licence?.id ?? null} kind={r.a.needed ?? r.a.upcoming?.kind ?? null} council={r.council} />
      </section>

      <section className="card card-pad" style={{ marginTop: 18 }} id="documents">
        <h2>Documents from our emails{docs.length ? ` · ${docs.length}` : ''}</h2>
        {docs.length ? (
          <ul className="lic-docs">
            {docs.map((d) => (
              <li key={d.id}>
                <div>
                  <span className="lic-doc-kinds">{d.kinds.split(',').map((k) => KIND[k] ?? k).join(' · ')}</span>
                  <b>{d.subject || '(no subject)'}</b>
                  <span className="addr-sub">{d.fromAddr} · {d.sentAt ? fmtDay(d.sentAt.slice(0, 10)) : ''}</span>
                </div>
                <div className="lic-doc-files">
                  {d.pdfs.length ? d.pdfs.map((f) => (
                    <span key={f.id}>
                      <a className="btn btn-ghost btn-sm" href={`/api/admin/licensing/files/${f.id}`} target="_blank" rel="noreferrer">Open {f.filename}</a>
                      <a className="lic-linkish" href={`/api/admin/licensing/files/${f.id}?download=1`}>Download</a>
                    </span>
                  )) : <span className="addr-sub">No PDF attached (details were in the email itself)</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="card-sub" style={{ marginTop: 6 }}>None yet. Run <b>Search our emails</b> on the Licensing page: licences and certificates that mention this address appear here, with their PDFs.</p>}
      </section>

      <section className="card card-pad" style={{ marginTop: 18 }}>
        <h2>Details</h2>
        <RentalForm r={r} />
      </section>
    </>
  )
}
