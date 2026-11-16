'use client'
import { useActionState } from 'react'
import { AttributionField, ConsentBoxes } from '@/components/LeadCapture'
import { WhatsAppLink } from '@/components/WhatsAppLink'
import { sendEnquiry, type EnquiryState } from '../../actions'

export function EnquiryForm({ propertyId, isLet, waText }: { propertyId: string; isLet: boolean; waText: string }) {
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
          <AttributionField />
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
          <ConsentBoxes />
          {state.error ? <p className="err" role="alert">{state.error}</p> : null}
          <button className="btn btn-gold" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Request a viewing'}</button>
        </form>
      )}
      <p className="alt">Or call the branch: <a href="tel:+442089049005">020 8904 9005</a></p>
      <WhatsAppLink className="wa-alt" text={waText} detail="property">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.8 14.03c-.25.7-1.43 1.33-1.99 1.41-.51.08-1.15.11-1.86-.12-.43-.13-.98-.32-1.69-.62-2.97-1.28-4.91-4.27-5.06-4.47-.15-.2-1.21-1.61-1.21-3.07s.77-2.18 1.04-2.48c.27-.3.59-.37.79-.37h.57c.18 0 .43-.07.67.5.25.6.84 2.05.91 2.2.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.39-.45.52-.15.15-.3.31-.13.6.17.3.77 1.27 1.65 2.06 1.14 1.01 2.09 1.33 2.39 1.48.3.15.47.12.64-.07.17-.2.74-.86.94-1.16.2-.3.39-.25.67-.15.27.1 1.72.81 2.02.96.3.15.49.22.57.35.08.12.08.71-.17 1.41z" /></svg>
        Message us on WhatsApp about this home
      </WhatsAppLink>
    </div>
  )
}
