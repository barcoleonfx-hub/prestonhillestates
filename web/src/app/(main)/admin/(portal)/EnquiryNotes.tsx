'use client'
import { startTransition, useActionState, useEffect, useRef, useState } from 'react'
import { addEnquiryNote, type SimpleState } from '../crm-actions'

export type TrailItem = { id: string; at: string; by: string | null; kind: 'note' | 'call'; text: string }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })

/** Comments and calls on one enquiry, newest first, with a one-line box to add a comment. */
export function EnquiryNotes({ id, trail }: { id: string; trail: TrailItem[] }) {
  const [state, dispatch, pending] = useActionState<SimpleState, FormData>(addEnquiryNote, {})
  const [all, setAll] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => { if (state.ok) form.current?.reset() }, [state])
  const shown = all ? trail : trail.slice(0, 2)
  return (
    <div className="en">
      {shown.length ? (
        <ul className="en-list">
          {shown.map((t) => (
            <li key={t.id} className={`en-item en-${t.kind}`}>
              <span className="en-when">{when(t.at)}{t.by ? ` · ${t.by}` : ''}</span>
              <span className="en-text">{t.kind === 'call' ? '📞 ' : ''}{t.text}</span>
            </li>
          ))}
          {trail.length > 2 ? <li><button type="button" className="en-more" onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${trail.length}`}</button></li> : null}
        </ul>
      ) : null}
      <form ref={form} className="en-add" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => dispatch(fd)) }}>
        <input type="hidden" name="id" value={id} />
        <input className="input" name="body" placeholder="Add a comment, e.g. left a voicemail, viewing Saturday 11am" aria-label="Comment" maxLength={1000} />
        <button className="btn btn-ghost btn-sm" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
      </form>
      {state.error ? <p className="en-err" role="alert">{state.error}</p> : null}
    </div>
  )
}
