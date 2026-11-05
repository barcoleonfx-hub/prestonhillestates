'use client'
import { useActionState } from 'react'
import { sendEnquiry, type EnquiryState } from '../../actions'

export function EnquiryForm({ propertyId, isLet }: { propertyId: string; isLet: boolean }) {
  const [state, action, pending] = useActionState<EnquiryState, FormData>(sendEnquiry, {})
  return (
    <div className="enquiry" id="enquiry">
      <h2>Arrange a <em>viewing</em></h2>
      <p className="s">Tell us how to reach you and the branch will call to book a time.</p>
      {state.ok ? (
        <div className="done" role="status">Thank you. We’ve received your request and will be in touch within working hours.</div>
      ) : (
        <form action={action}>
          <input type="hidden" name="propertyId" value={propertyId} />
          <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
            <label htmlFor="enq-hp">Leave this box empty</label>
            <input id="enq-hp" name="hp_check" tabIndex={-1} autoComplete="off" />
          </div>
          <div><label htmlFor="enq-name">Your name</label><input id="enq-name" name="name" autoComplete="name" required /></div>
          <div><label htmlFor="enq-phone">Phone</label><input id="enq-phone" name="phone" type="tel" autoComplete="tel" /></div>
          <div><label htmlFor="enq-email">Email</label><input id="enq-email" name="email" type="email" autoComplete="email" /></div>
          <div>
            <label htmlFor="enq-message">Message</label>
            <textarea id="enq-message" name="message" placeholder={isLet ? 'When would you like to move in?' : 'When would suit you to view?'} />
          </div>
          {state.error ? <p className="err" role="alert">{state.error}</p> : null}
          <button className="btn btn-gold" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Request a viewing'}</button>
        </form>
      )}
      <p className="alt">Or call the branch: <a href="tel:+442089049005">020 8904 9005</a></p>
    </div>
  )
}
