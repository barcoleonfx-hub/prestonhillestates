'use client'

import { useState, useTransition } from 'react'
import { sendReportNow } from './actions'

/** Sends the Director's report now. */
export default function SendReportButton({ to }: { to: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  return (
    <span className="ag-btns">
      <button className="btn btn-gold btn-sm" disabled={pending} onClick={() => { if (confirm(`Write and send today’s report to ${to} now?`)) start(async () => { const r = await sendReportNow(); setMsg(r.ok ? { ok: true, text: `Sent to ${to}.` } : { ok: false, text: r.error ?? 'It couldn’t be sent.' }) }) }}>{pending ? 'Writing and sending…' : 'Send it now'}</button>
      {msg ? <span className={msg.ok ? 'ag-note-in' : 'ag-err'}>{msg.text}</span> : null}
    </span>
  )
}
