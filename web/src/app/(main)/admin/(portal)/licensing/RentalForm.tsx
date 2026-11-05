'use client'

import { useActionState, useState } from 'react'
import { OCCUPANCY, WARDS } from '@/lib/licensing-rules'
import type { Rental } from '@/db/schema'
import { saveRental } from '../../licensing-actions'

/** Adding or editing a rented property: where it is, who lives there, the landlord and the safety certificates. */
export function RentalForm({ r }: { r?: Rental | null }) {
  const [state, action, pending] = useActionState(saveRental, undefined)
  const named = r?.council && !['brent', 'harrow', 'other'].includes(r.council) ? r.council : null
  const [council, setCouncil] = useState(r ? (r.wardSource === 'manual' || named ? r.council ?? 'auto' : 'auto') : 'auto')
  const [otherName, setOtherName] = useState(named ?? '')
  return (
    <form action={action} className="lic-form">
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <h3>The property</h3>
      <div className="lic-grid">
        <div className="field wide"><label htmlFor="address">Address</label><input id="address" name="address" className="input" defaultValue={r?.address} required placeholder="e.g. 14 Kenton Road, Harrow" /></div>
        <div className="field"><label htmlFor="postcode">Postcode</label><input id="postcode" name="postcode" className="input" defaultValue={r?.postcode ?? ''} placeholder="HA3 0AB" /></div>
        <div className="field"><label htmlFor="council">Council and ward</label>
          <input type="hidden" name="council" value={council === 'other' && otherName.trim() ? otherName.trim().toLowerCase() : council} />
          <select id="council" className="select" value={council} onChange={(e) => setCouncil(e.target.value)}>
            <option value="auto">Look up from the postcode</option><option value="brent">Brent (choose the ward)</option><option value="harrow">Harrow (choose the ward)</option>
            {named ? <option value={named}>{named.replace(/\b\w/g, (m) => m.toUpperCase())}</option> : null}
            <option value="other">Another council</option>
          </select>
        </div>
        {council === 'other' ? (
          <div className="field"><label htmlFor="councilName">Which council</label><input id="councilName" className="input" value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="e.g. Ealing" /></div>
        ) : null}
        {council === 'brent' || council === 'harrow' ? (
          <div className="field"><label htmlFor="ward">Ward</label>
            <select id="ward" name="ward" className="select" defaultValue={r?.ward ?? ''} required><option value="">Choose…</option>{WARDS[council].map((w) => <option key={w}>{w}</option>)}</select>
          </div>
        ) : null}
      </div>
      <fieldset className="lic-occ">
        <legend>Who lives there</legend>
        {OCCUPANCY.map((o) => (
          <label key={o.value}><input type="radio" name="occupancy" value={o.value} defaultChecked={(r?.occupancy ?? 'single') === o.value} /><span><b>{o.label}</b><small>{o.hint}</small></span></label>
        ))}
      </fieldset>
      <label className="lic-noneed"><input type="checkbox" name="noLicenceNeeded" value="1" defaultChecked={!!r?.noLicenceNeeded} /> We’ve checked: this property doesn’t need a licence <small>(e.g. an exemption, or a council with no scheme here). Say why in the notes.</small></label>
      <div className="lic-grid">
        <div className="field"><label htmlFor="management">Our service</label>
          <select id="management" name="management" className="select" defaultValue={r?.management ?? ''}><option value="">Not set</option><option value="managed">Fully managed</option><option value="rent_collect">Rent collection</option><option value="let_only">Let only</option></select>
        </div>
      </div>

      <h3>Landlord</h3>
      <div className="lic-grid">
        <div className="field"><label htmlFor="landlordName">Name</label><input id="landlordName" name="landlordName" className="input" defaultValue={r?.landlordName ?? ''} /></div>
        <div className="field"><label htmlFor="landlordEmail">Email</label><input id="landlordEmail" name="landlordEmail" type="email" className="input" defaultValue={r?.landlordEmail ?? ''} /></div>
        <div className="field"><label htmlFor="landlordPhone">Phone</label><input id="landlordPhone" name="landlordPhone" className="input" defaultValue={r?.landlordPhone ?? ''} /></div>
      </div>

      <h3>Safety certificates</h3>
      <p className="card-sub" style={{ margin: '-4px 0 10px' }}>The date each one runs out. Gas safety is yearly, EICR every 5 years, EPC every 10 years (and must be E or above to let).</p>
      <div className="lic-grid">
        <div className="field"><label htmlFor="gasExpires">Gas safety expires</label><input id="gasExpires" name="gasExpires" type="date" className="input" defaultValue={r?.gasExpires ?? ''} /></div>
        <div className="field"><label htmlFor="eicrExpires">EICR expires</label><input id="eicrExpires" name="eicrExpires" type="date" className="input" defaultValue={r?.eicrExpires ?? ''} /></div>
        <div className="field"><label htmlFor="epcExpires">EPC expires</label><input id="epcExpires" name="epcExpires" type="date" className="input" defaultValue={r?.epcExpires ?? ''} /></div>
        <div className="field"><label htmlFor="epcRating">EPC rating</label><select id="epcRating" name="epcRating" className="select" defaultValue={r?.epcRating ?? ''}><option value="">—</option>{'ABCDEFG'.split('').map((x) => <option key={x}>{x}</option>)}</select></div>
      </div>
      <div className="field" style={{ marginTop: 12 }}><label htmlFor="notes">Notes</label><textarea id="notes" name="notes" className="textarea" rows={3} defaultValue={r?.notes ?? ''} /></div>
      {state?.error ? <div className="notice err" style={{ marginTop: 12 }}>{state.error}</div> : null}
      <div className="actions" style={{ marginTop: 16 }}><button className="btn btn-gold" type="submit" disabled={pending}>{pending ? 'Saving…' : r ? 'Save changes' : 'Add the property'}</button></div>
    </form>
  )
}
