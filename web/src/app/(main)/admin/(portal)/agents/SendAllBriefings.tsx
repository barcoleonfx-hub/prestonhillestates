'use client'

import { useState, useTransition } from 'react'
import { sendAllBriefingsNow } from './actions'

/** Sends everyone's briefing now (takes a minute: Claude writes each one). */
export default function SendAllBriefings({ count }: { count: number }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  return (
    <span className="ag-btns">
      <button className="btn btn-gold btn-sm" disabled={pending} onClick={() => { if (confirm(`Write and send all ${count} briefings now?`)) start(async () => { const r = await sendAllBriefingsNow(); setMsg(r.ok ? { ok: true, text: `Sent: ${r.sent?.join(', ')}.` } : { ok: false, text: r.error ?? 'They couldn’t be sent.' }) }) }}>{pending ? 'Writing and sending… (about a minute)' : `Send all ${count} now`}</button>
      {msg ? <span className={msg.ok ? 'ag-note-in' : 'ag-err'}>{msg.text}</span> : null}
    </span>
  )
}
