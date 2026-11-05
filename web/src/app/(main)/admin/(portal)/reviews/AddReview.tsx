'use client'

import { useActionState, useEffect, useRef } from 'react'
import { addReview } from '../../review-actions'

export function AddReview() {
  const [state, act, pending] = useActionState(addReview, undefined)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => { if (state?.ok) form.current?.reset() }, [state])
  return (
    <form ref={form} action={act} className="rv-form">
      <div className="rv-grid">
        <label className="field"><span>Reviewer’s name (as on Google)</span><input className="input" name="author" required /></label>
        <label className="field"><span>Stars</span>
          <select className="select" name="rating" defaultValue="5"><option value="5">★★★★★ 5</option><option value="4">★★★★ 4</option><option value="3">★★★ 3</option><option value="2">★★ 2</option><option value="1">★ 1</option></select>
        </label>
        <label className="field"><span>Date (month is enough)</span><input className="input" name="reviewedOn" type="month" /></label>
        <label className="field"><span>Show on</span>
          <select className="select" name="category" defaultValue="general"><option value="general">Both sales and lettings pages</option><option value="sales">Sales pages</option><option value="lettings">Lettings pages</option></select>
        </label>
      </div>
      <label className="field"><span>The review, word for word</span><textarea className="input" name="text" rows={4} required /></label>
      {state?.error ? <div className="notice err">{state.error}</div> : state?.ok ? <div className="notice ok">Added.</div> : null}
      <div className="actions"><button className="btn btn-gold" type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add review'}</button></div>
    </form>
  )
}
