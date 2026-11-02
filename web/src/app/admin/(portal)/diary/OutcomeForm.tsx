'use client'
import { startTransition, useActionState, useEffect, useState } from 'react'
import { recordOutcome, type SimpleState } from '../../appointment-actions'
import { INTEREST, NEXT_STEPS, OUTCOMES } from '@/lib/appointment-options'

export function OutcomeForm({ id, kind, onDone, idPrefix = 'oc' }: { id: string; kind: string; onDone?: () => void; idPrefix?: string }) {
  const [state, dispatch, pending] = useActionState<SimpleState, FormData>(recordOutcome, {})
  const [outcome, setOutcome] = useState('')
  const [next, setNext] = useState('')
  const went = outcome === 'attended'
  const interest = INTEREST[kind] ?? INTEREST.other

  useEffect(() => { if (state.ok) onDone?.() }, [state.ok, onDone])

  return (
    <form
      className="oc-form"
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => dispatch(fd)) }}
    >
      <input type="hidden" name="id" value={id} />
      <fieldset className="field">
        <legend className="flabel">Did it go ahead? <span className="req">Required</span></legend>
        <div className="chips">
          {OUTCOMES.map((o) => (
            <label key={o.value} className="chip">
              <input type="radio" name="outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value)} required />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {went ? (
        <fieldset className="field">
          <legend className="flabel">{kind === 'valuation' ? 'How did the valuation go?' : 'How interested were they?'} <span className="req">Required</span></legend>
          <div className="chips">
            {interest.map((o) => (
              <label key={o.value} className="chip">
                <input type="radio" name="interest" value={o.value} required />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {went && kind === 'valuation' ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-figure`}>Figure you gave <span className="hint">(optional)</span></label>
          <input className="input" id={`${idPrefix}-figure`} name="figure" placeholder="e.g. £575,000 to £600,000" />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor={`${idPrefix}-notes`}>What happened? <span className="req">Required</span></label>
        <textarea className="textarea" id={`${idPrefix}-notes`} name="notes" rows={4} minLength={10} required
          placeholder={kind === 'valuation' ? 'Condition, works needed, their timescale, other agents they’ve seen…' : 'What they liked, concerns, their position (chain, mortgage in principle), feedback for the vendor…'} />
      </div>

      <fieldset className="field">
        <legend className="flabel">Next step <span className="req">Required</span></legend>
        <div className="chips">
          {NEXT_STEPS.map((s) => (
            <label key={s} className="chip">
              <input type="radio" name="next" value={s} checked={next === s} onChange={() => setNext(s)} required />
              <span>{s}</span>
            </label>
          ))}
          <label className="chip">
            <input type="radio" name="next" value="other" checked={next === 'other'} onChange={() => setNext('other')} />
            <span>Something else</span>
          </label>
        </div>
        {next === 'other' ? <input className="input" name="nextOther" placeholder="What happens next?" required aria-label="Next step" /> : null}
      </fieldset>

      {state.error ? <div className="notice err" role="alert">{state.error}</div> : null}
      <button className="btn btn-gold" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save outcome'}</button>
    </form>
  )
}
