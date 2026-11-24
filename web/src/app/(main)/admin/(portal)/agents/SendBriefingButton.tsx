'use client'

import { useState, useTransition } from 'react'
import { sendBriefingNow } from './actions'

/** Writes and sends one person's briefing now. */
export default function SendBriefingButton({ name, to }: { name: string; to: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  return (
    <span className="ag-btns">
      <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => { if (confirm(`Write and send ${name}’s briefing to ${to} now?`)) start(async () => { const r = await sendBriefingNow(name); setMsg(r.ok ? { ok: true, text: 'Sent.' } : { ok: false, text: r.error ?? 'It couldn’t be sent.' }) }) }}>{pending ? 'Sending…' : 'Send now'}</button>
      {msg ? <span className={msg.ok ? 'ag-note-in' : 'ag-err'}>{msg.text}</span> : null}
    </span>
  )
}
