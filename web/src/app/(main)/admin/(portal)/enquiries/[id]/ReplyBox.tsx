'use client'
import { useActionState, useEffect, useRef } from 'react'
import { replyToEnquiry, type ReplyState } from '../../../enquiry-email-actions'

/** Reply in the conversation: goes in the same email thread in their inbox, and is added here. */
export function ReplyBox({ id, name, disabled }: { id: string; name: string; disabled: string | null }) {
  const [state, send, pending] = useActionState<ReplyState, FormData>(replyToEnquiry, {})
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => { if (state.ok) form.current?.reset() }, [state.ok, state.sentAt])
  if (disabled) return <p className="cv-note">{disabled}</p>
  return (
    <form ref={form} action={send} className="cv-reply">
      <input type="hidden" name="id" value={id} />
      <label htmlFor="cv-body" className="sr-only">Your reply</label>
      <textarea id="cv-body" name="body" className="input" rows={4} placeholder={`Reply to ${name}…`} />
      {state.error ? <div className="notice err">{state.error}</div> : null}
      {state.ok ? <div className="notice ok">Sent, in the same email thread. It’s in the conversation above.</div> : null}
      <div className="actions"><button className="btn btn-gold btn-sm" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send reply'}</button></div>
    </form>
  )
}
