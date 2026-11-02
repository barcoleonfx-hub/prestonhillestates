'use client'
import { startTransition, useActionState, useState } from 'react'
import { cancelAppointment, type SimpleState } from '../../../appointment-actions'

export function CancelForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [state, dispatch, pending] = useActionState<SimpleState, FormData>(cancelAppointment, {})
  if (!open) return <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>Cancel appointment</button>
  return (
    <form className="cancel-form" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => dispatch(fd)) }}>
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="cx-reason">Why is it cancelled? <span className="req">Required</span></label>
        <input className="input" id="cx-reason" name="reason" required minLength={3} placeholder="e.g. Buyer found another property" autoFocus />
      </div>
      {state.error ? <div className="notice err" role="alert">{state.error}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-danger" type="submit" disabled={pending}>{pending ? 'Cancelling…' : 'Cancel and tell everyone'}</button>
        <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>Keep it</button>
      </div>
    </form>
  )
}
