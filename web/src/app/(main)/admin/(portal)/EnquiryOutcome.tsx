'use client'
import { startTransition, useActionState, useOptimistic, useState } from 'react'
import { saveOtherRequirements, setEnquiryOutcome, type SimpleState } from '../crm-actions'
import { ENQUIRY_OUTCOMES } from '@/lib/enquiry-labels'

/** One-tap outcome for an enquiry, with a short form for "Other requirements". */
export function EnquiryOutcome({ id, outcome, channel }: { id: string; outcome: string | null; channel?: string | null }) {
  const [shown, setShown] = useOptimistic(outcome)
  const [reqOpen, setReqOpen] = useState(false)
  const [state, dispatch, pending] = useActionState<SimpleState, FormData>(saveOtherRequirements, {})

  const choose = (value: string) => {
    if (value === 'other_requirements') { setReqOpen((o) => !o); return }
    if (value === 'do_not_call' && shown !== 'do_not_call' && !confirm('Mark this person as “do not call back”? They won’t be suggested for any property again.')) return
    const next = shown === value ? '' : value // tap again to clear
    const fd = new FormData()
    fd.set('id', id)
    fd.set('outcome', next)
    startTransition(async () => {
      setShown(next || null)
      await setEnquiryOutcome(fd)
    })
  }

  return (
    <div className="eo">
      <div className="eo-chips" role="group" aria-label="Outcome">
        {ENQUIRY_OUTCOMES.map((o) => (
          <button key={o.value} type="button" className={`eo-chip t-${o.tone}${shown === o.value ? ' on' : ''}`} aria-pressed={shown === o.value} onClick={() => choose(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {reqOpen && !state.ok ? (
        <form className="eo-req" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => dispatch(fd)) }}>
          <input type="hidden" name="id" value={id} />
          <div className="eo-req-grid">
            <div className="field">
              <label htmlFor={`eo-ch-${id}`}>Looking to</label>
              <select className="select" id={`eo-ch-${id}`} name="channel" defaultValue={channel === 'let' ? 'let' : 'sale'}>
                <option value="sale">Buy</option>
                <option value="let">Rent</option>
              </select>
            </div>
            <div className="field"><label htmlFor={`eo-max-${id}`}>Budget up to</label><input className="input" id={`eo-max-${id}`} name="maxPrice" placeholder="450k or 1800" /></div>
            <div className="field"><label htmlFor={`eo-beds-${id}`}>Bedrooms, at least</label><input className="input" id={`eo-beds-${id}`} name="minBeds" type="number" min={0} max={10} /></div>
            <div className="field">
              <label htmlFor={`eo-type-${id}`}>Type</label>
              <select className="select" id={`eo-type-${id}`} name="wantedType" defaultValue="">
                <option value="">Any</option>
                <option value="house">House</option>
                <option value="flat">Flat or maisonette</option>
                <option value="bungalow">Bungalow</option>
              </select>
            </div>
            <div className="field eo-wide"><label htmlFor={`eo-areas-${id}`}>Areas</label><input className="input" id={`eo-areas-${id}`} name="areas" placeholder="e.g. Kenton, Harrow HA3" /></div>
            <div className="field eo-wide"><label htmlFor={`eo-notes-${id}`}>Anything else</label><input className="input" id={`eo-notes-${id}`} name="notes" placeholder="e.g. needs parking, ground floor, near a school" /></div>
          </div>
          {state.error ? <div className="notice err" role="alert">{state.error}</div> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-gold btn-sm" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save requirements'}</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setReqOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : null}
      {state.ok ? <p className="eo-saved" role="status">Requirements saved. They’ll be suggested for matching properties.</p> : null}
    </div>
  )
}
