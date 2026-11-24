'use client'

import { useState, useTransition } from 'react'
import { approveAction, rejectAction } from './actions'

type Check = { name: string; ok: boolean; note?: string; level?: 'block' | 'hold' }

/** One held email: why it was held, exactly what would go, and Approve / Edit / Reject. */
export default function HeldCard(p: { id: string; title: string; to: string; subject: string; text: string; checks: Check[]; when: string; expired: boolean; enquiryHref: string | null }) {
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState(p.subject)
  const [text, setText] = useState(p.text)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const failed = p.checks.filter((c) => !c.ok)
  const run = (f: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    const r = await f()
    setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error ?? 'That didn’t work. Try again.' })
  })
  if (msg?.ok) return <div className="ag-held done"><b>{p.title}</b><span>{msg.text}</span></div>
  return (
    <div className="ag-held">
      <div className="ag-held-top">
        <span className="fu-main"><b>{p.title}</b><small>To {p.to} · held {p.when}</small></span>
        {p.enquiryHref ? <a className="btn btn-ghost btn-sm" href={p.enquiryHref}>Open the enquiry</a> : null}
      </div>
      <ul className="ag-why">
        {failed.map((c) => <li key={c.name}><b>{c.name}</b>{c.note ? `: ${c.note}` : ''}</li>)}
      </ul>
      {editing ? (
        <div className="ag-edit">
          <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label>Message<textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} /></label>
        </div>
      ) : (
        <details className="ag-preview"><summary>See the email</summary><p className="ag-subj">{p.subject}</p><pre>{p.text}</pre></details>
      )}
      {msg && !msg.ok ? <p className="ag-err">{msg.text}</p> : null}
      <div className="ag-btns">
        {p.expired ? <span className="ag-note-in">Held over 5 days ago: out of date, so it can only be rejected.</span> : editing ? (
          <>
            <button className="btn btn-gold btn-sm" disabled={pending} onClick={() => run(() => approveAction(p.id, { subject, text }), 'Sent as you edited it.')}>Send my version</button>
            <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => { setEditing(false); setSubject(p.subject); setText(p.text) }}>Cancel</button>
          </>
        ) : (
          <>
            <button className="btn btn-gold btn-sm" disabled={pending} onClick={() => { if (confirm(`Send “${p.subject}” to ${p.to} as it is?`)) run(() => approveAction(p.id), 'Approved and sent.') }}>Approve and send</button>
            <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setEditing(true)}>Edit</button>
          </>
        )}
        {!editing ? <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => rejectAction(p.id), 'Rejected: nothing was sent.')}>Reject</button> : null}
      </div>
    </div>
  )
}
