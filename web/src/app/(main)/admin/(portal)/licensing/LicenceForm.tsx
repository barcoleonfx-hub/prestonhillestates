'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { KINDS, LICENCE_STATUS } from '@/lib/licensing-rules'
import type { LicenceRow } from '@/db/schema'
import { saveLicence } from '../../licensing-actions'

const fiveYears = (start: string) => { const d = new Date(`${start}T12:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 5); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }

/** Adding or editing one licence (or an application for one). */
export function LicenceForm({ rentalId, l, kind, council, onDone }: { rentalId: string; l?: LicenceRow | null; kind?: string | null; council?: string | null; onDone?: () => void }) {
  const [state, action, pending] = useActionState(saveLicence, undefined)
  const [status, setStatus] = useState(l?.status ?? 'granted')
  const [start, setStart] = useState(l?.startsOn ?? '')
  const [expiry, setExpiry] = useState(l?.expiresOn ?? '')
  const done = useRef(onDone)
  useEffect(() => { if (state?.ok) done.current?.() }, [state?.ok])
  return (
    <form action={action} className="lic-form lic-licence-form">
      <input type="hidden" name="rentalId" value={rentalId} />
      {l ? <input type="hidden" name="id" value={l.id} /> : null}
      <div className="lic-grid">
        <div className="field"><label>Licence</label><select name="kind" className="select" defaultValue={l?.kind ?? kind ?? 'selective'}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></div>
        <div className="field"><label>Status</label><select name="status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>{LICENCE_STATUS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></div>
        <div className="field"><label>Licence or application number</label><input name="number" className="input" defaultValue={l?.number ?? ''} /></div>
        <div className="field"><label>Council</label><select name="council" className="select" defaultValue={l?.council ?? council ?? ''}><option value="">—</option><option value="brent">Brent</option><option value="harrow">Harrow</option><option value="other">Other</option></select></div>
        {status === 'applied' || status === 'exempt' ? <div className="field"><label>Applied on</label><input name="appliedOn" type="date" className="input" defaultValue={l?.appliedOn ?? ''} /></div> : null}
        <div className="field"><label>Starts</label><input name="startsOn" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="field">
          <label>{status === 'exempt' ? 'Exemption ends' : 'Expires'}</label>
          <input name="expiresOn" type="date" className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          {start && !expiry && status === 'granted' ? <button type="button" className="lic-linkish" onClick={() => setExpiry(fiveYears(start))}>Most last 5 years: set {fiveYears(start)}</button> : null}
        </div>
        <div className="field"><label>Holder</label><input name="holder" className="input" defaultValue={l?.holder ?? ''} placeholder="Landlord, or Preston Hill" /></div>
        <div className="field"><label>Max people</label><input name="maxOccupants" type="number" min={1} className="input" defaultValue={l?.maxOccupants ?? ''} /></div>
        <div className="field"><label>Max households</label><input name="maxHouseholds" type="number" min={1} className="input" defaultValue={l?.maxHouseholds ?? ''} /></div>
      </div>
      <div className="field" style={{ marginTop: 10 }}><label>Conditions worth remembering</label><textarea name="conditions" className="textarea" rows={2} defaultValue={l?.conditions ?? ''} placeholder="e.g. annual gas certificate to the council, inspection by June" /></div>
      {state?.error ? <div className="notice err" style={{ marginTop: 10 }}>{state.error}</div> : null}
      {state?.ok ? <div className="notice ok" style={{ marginTop: 10 }}>Saved.</div> : null}
      <div className="actions" style={{ marginTop: 12 }}><button type="submit" className="btn btn-gold btn-sm" disabled={pending}>{pending ? 'Saving…' : l ? 'Save licence' : 'Add licence'}</button>{onDone ? <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>Cancel</button> : null}</div>
    </form>
  )
}
