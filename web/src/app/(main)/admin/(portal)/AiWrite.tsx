'use client'

import { useState } from 'react'
import type { AiPlace } from '@/lib/email-writer-rules'
import { aiWrite } from '../ai-actions'

type About = { propertyId?: string | null; enquiryId?: string | null; threadId?: string | null; contactId?: string | null; about?: string }

/**
 * "Write with AI" beside a message box. Optionally say what it should say, then Write (or Improve what's there).
 * The words go into the box (and the subject, where there is one) for staff to read and change; Undo puts them back.
 * Works with a box the page controls (value + onChange) or a plain one found by its id.
 */
export function AiWrite({ place, ctx, value, onChange, subject, onSubject, target, disabled }: {
  place: AiPlace; ctx: About
  value?: string; onChange?: (v: string) => void
  subject?: string; onSubject?: (v: string) => void
  /** The id of a plain (uncontrolled) textarea, when the page doesn't control it. */
  target?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [say, setSay] = useState('')
  const [busy, setBusy] = useState<'' | 'write' | 'improve'>('')
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null)
  const [undo, setUndo] = useState<{ body: string; subject: string } | null>(null)
  const box = () => (target ? (document.getElementById(target) as HTMLTextAreaElement | null) : null)
  const read = () => (onChange ? value ?? '' : box()?.value ?? '')
  const write = (body: string, subj?: string) => {
    if (onChange) onChange(body)
    else { const el = box(); if (el) { el.value = body; el.focus() } }
    if (subj != null && onSubject) onSubject(subj)
  }
  async function run(mode: 'write' | 'improve') {
    const current = read()
    if (mode === 'write' && current.trim() && !window.confirm('Replace what’s in the box with a new message? (You can undo it.)')) return
    setBusy(mode); setDone(null)
    const r = await aiWrite({ place, propertyId: ctx.propertyId ?? null, enquiryId: ctx.enquiryId ?? null, threadId: ctx.threadId ?? null, contactId: ctx.contactId ?? null, about: ctx.about ?? '', instruction: say, mode, subject: subject ?? '', draft: current })
      .catch(() => ({ error: 'The AI couldn’t be reached. Try again.' }))
    setBusy('')
    if ('error' in r) { setDone({ ok: false, text: r.error }); return }
    setUndo({ body: current, subject: subject ?? '' })
    write(r.body, r.subject ? r.subject : undefined)
    setDone({ ok: true, text: r.note || 'Done. Read it through and change anything you like.' })
  }
  if (disabled) return null
  return (
    <div className="aiw">
      {!open ? (
        <button type="button" className="aiw-open" onClick={() => setOpen(true)}><span aria-hidden="true">✦</span> Write with AI</button>
      ) : (
        <div className="aiw-box">
          <input className="input" value={say} onChange={(e) => setSay(e.target.value)} maxLength={800}
            placeholder="What should it say? (optional, e.g. offer Saturday viewings, mention it’s chain free)"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!busy) run('write') } }} aria-label="What should the AI say?" />
          <div className="aiw-acts">
            <button type="button" className="btn btn-dark btn-sm" disabled={!!busy} onClick={() => run('write')}>{busy === 'write' ? 'Writing…' : 'Write it'}</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run('improve')}>{busy === 'improve' ? 'Improving…' : 'Improve mine'}</button>
            {undo && !busy ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { write(undo.body, onSubject ? undo.subject : undefined); setUndo(null); setDone(null) }}>Undo</button> : null}
            <button type="button" className="aiw-close" onClick={() => { setOpen(false); setDone(null) }} aria-label="Close">✕</button>
          </div>
          {done ? <p className={`aiw-note${done.ok ? '' : ' err'}`}>{done.text}</p> : null}
        </div>
      )}
    </div>
  )
}
