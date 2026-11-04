'use client'
import { startTransition, useActionState, useEffect } from 'react'
import { hideSender, unsubscribeSender, type UnsubState } from '../../mail-actions'

export function Unsubscribe({ sender, canUnsub }: { sender: string; canUnsub: boolean }) {
  const [state, dispatch, pending] = useActionState<UnsubState, FormData>(unsubscribeSender, {})
  useEffect(() => { if (state.open) window.open(state.open, '_blank', 'noopener') }, [state])
  return (
    <div className="un">
      {canUnsub ? (
        <button type="button" className="btn btn-ghost btn-sm" disabled={pending || state.ok} onClick={() => { const fd = new FormData(); fd.set('sender', sender); startTransition(() => dispatch(fd)) }}>
          {state.ok ? (state.open ? 'Confirm on their page' : 'Unsubscribed') : pending ? 'Unsubscribing…' : 'Unsubscribe'}
        </button>
      ) : null}
      <form action={hideSender}><input type="hidden" name="sender" value={sender} /><button className="btn btn-ghost btn-sm" type="submit">Hide</button></form>
      {state.error ? <span className="un-err" role="alert">{state.error}</span> : null}
    </div>
  )
}
