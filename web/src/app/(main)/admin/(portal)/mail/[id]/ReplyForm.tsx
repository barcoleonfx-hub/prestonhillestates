'use client'
import { startTransition, useActionState, useEffect, useRef } from 'react'
import { replyToThread, type ReplyState } from '../../../mail-actions'

export function ReplyForm({ threadId, to, cc, mailto }: { threadId: string; to: string; cc: string; mailto: string }) {
  const [state, dispatch, pending] = useActionState<ReplyState, FormData>(replyToThread, {})
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => { if (state.ok) ref.current?.querySelector('textarea')?.form?.reset() }, [state])
  return (
    <form ref={ref} className="rf" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => dispatch(fd)) }}>
      <input type="hidden" name="threadId" value={threadId} />
      <div className="rf-row"><label htmlFor="rf-to">To</label><input className="input" id="rf-to" name="to" defaultValue={to} /></div>
      <div className="rf-row"><label htmlFor="rf-cc">Cc</label><input className="input" id="rf-cc" name="cc" defaultValue={cc} placeholder="Optional" /></div>
      <textarea className="input rf-body" name="body" rows={7} placeholder="Write your reply… Your name and the office details are added at the bottom, with their email quoted underneath." />
      {state.error ? <div className="notice err" role="alert">{state.error}</div> : null}
      {state.ok ? <div className="notice ok" role="status">Sent. A copy is in the mailbox’s Sent folder, so it shows in Apple Mail too.</div> : null}
      <div className="rf-actions">
        <button className="btn btn-gold" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send reply'}</button>
        <a className="btn btn-ghost" href={mailto}>Reply in Apple Mail instead</a>
      </div>
    </form>
  )
}
