'use client'

import { useState, useTransition } from 'react'
import { dismissDraft, sendDraft } from './actions'

const BLANK = /\[[^\]\n]{2,80}\]/

/** One reply drafted overnight: their email, the draft (editable), what to check, and Send / Bin. */
export default function DraftCard(p: { id: string; from: string; subject: string; theirs: string; theirAt: string; body: string; check: string | null; warnings: string[]; person: string | null; href: string }) {
  const [body, setBody] = useState(p.body)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const blank = body.match(BLANK)
  if (msg?.ok) return <div className="dr-card done"><b>{p.from}</b><span>{msg.text}</span></div>
  return (
    <div className="dr-card">
      <div className="dr-top">
        <span className="fu-main"><b>{p.from}</b><small>{p.subject} · {p.theirAt}{p.person ? ` · for ${p.person}` : ''}</small></span>
        <a className="btn btn-ghost btn-sm" href={p.href}>Open the conversation</a>
      </div>
      <details className="dr-theirs"><summary>Their email</summary><p>{p.theirs}</p></details>
      {p.check ? <p className="dr-check"><b>Check before sending:</b> {p.check}</p> : null}
      {p.warnings.length ? <ul className="ag-why">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
      <textarea className="dr-body" rows={Math.min(14, Math.max(5, body.split('\n').length + 2))} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Your reply" />
      <p className="ag-note-in">Your name and the office details are added when it’s sent, with their email quoted below.</p>
      {blank ? <p className="ag-err">Fill in {blank[0]} before sending.</p> : null}
      {msg && !msg.ok ? <p className="ag-err">{msg.text}</p> : null}
      <div className="ag-btns">
        <button className="btn btn-gold btn-sm" disabled={pending || !!blank} onClick={() => start(async () => { const r = await sendDraft(p.id, body); setMsg(r.ok ? { ok: true, text: 'Sent.' } : { ok: false, text: r.error ?? 'It couldn’t be sent.' }) })}>{pending ? 'Sending…' : 'Send'}</button>
        <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => start(async () => { const r = await dismissDraft(p.id); setMsg(r.ok ? { ok: true, text: 'Binned: nothing was sent.' } : { ok: false, text: r.error ?? 'That didn’t work.' }) })}>Bin it</button>
      </div>
    </div>
  )
}
