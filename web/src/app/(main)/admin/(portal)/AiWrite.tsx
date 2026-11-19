'use client'

import { useState } from 'react'
import type { AiPlace } from '@/lib/email-writer-rules'
import { aiWrite } from '../ai-actions'

type About = { propertyId?: string | null; enquiryId?: string | null; threadId?: string | null; contactId?: string | null; about?: string }

/**
 * "Write with AI" beside a message box: one click writes the best version from everything the portal knows (the
 * listing, the enquiry, the conversation) and whatever's already in the box (a preset email is used as the brief).
 * Afterwards: Undo, Write again, or say what to change ("shorter", "mention the parking").
 * Works with a box the page controls (value + onChange) or a plain one found by its id.
 */
export function AiWrite({ place, ctx, value, onChange, subject, onSubject, target, disabled, needsText, label, brief: extra }: {
  place: AiPlace; ctx: About
  value?: string; onChange?: (v: string) => void
  subject?: string; onSubject?: (v: string) => void
  /** The id of a plain (uncontrolled) textarea, when the page doesn't control it. */
  target?: string
  disabled?: boolean
  /** Only improves what's written: with an empty box, this is shown instead of asking the AI. */
  needsText?: string
  /** The button's words, e.g. "Improve with AI". */
  label?: string
  /** More to go on, read when the button is pressed (e.g. the rest of an unsaved form). */
  brief?: () => string
}) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null)
  const [undo, setUndo] = useState<{ body: string; subject: string } | null>(null)
  const [change, setChange] = useState('')
  const box = () => (target ? (document.getElementById(target) as HTMLTextAreaElement | null) : null)
  const read = () => (onChange ? value ?? '' : box()?.value ?? '')
  const write = (body: string, subj?: string) => {
    if (onChange) onChange(body)
    else {
      const el = box()
      if (el) {
        // Set it the way typing does, so the page notices the change (e.g. "unsaved changes").
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, body)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.focus()
      }
    }
    if (subj != null && onSubject) onSubject(subj)
  }
  /** "write": the best version (using what's in the box, or what was there before the AI's last go). "improve": change it as asked. */
  async function run(mode: 'write' | 'improve') {
    const current = read()
    if (needsText && !current.trim() && !(mode === 'write' && undo)) { setDone({ ok: false, text: needsText }); return }
    // "Write again" starts from the same brief as the first go, not from the AI's own draft.
    const brief = mode === 'write' && undo ? undo : { body: current, subject: subject ?? '' }
    setBusy(true); setDone(null)
    const r = await aiWrite({
      place, propertyId: ctx.propertyId ?? null, enquiryId: ctx.enquiryId ?? null, threadId: ctx.threadId ?? null, contactId: ctx.contactId ?? null,
      about: [ctx.about, extra?.()].filter(Boolean).join('\n'), instruction: mode === 'improve' ? change : '', mode, subject: mode === 'improve' ? subject ?? '' : brief.subject, draft: mode === 'improve' ? current : brief.body,
    }).catch(() => ({ error: 'The AI couldn’t be reached. Try again.' }))
    setBusy(false)
    if ('error' in r) { setDone({ ok: false, text: r.error }); return }
    if (!undo) setUndo({ body: current, subject: subject ?? '' })
    write(r.body, r.subject ? r.subject : undefined)
    if (mode === 'improve') setChange('')
    setDone({ ok: true, text: r.note || 'Done. Read it through and change anything you like.' })
  }
  if (disabled) return null
  return (
    <div className="aiw">
      <div className="aiw-acts">
        <button type="button" className="aiw-open" disabled={busy} onClick={() => run('write')}>
          <span aria-hidden="true">✦</span> {busy ? 'Writing… (about 20 seconds)' : undo ? 'Write again' : label ?? 'Write with AI'}
        </button>
        {undo && !busy ? <button type="button" className="aiw-link" onClick={() => { write(undo.body, onSubject ? undo.subject : undefined); setUndo(null); setDone(null) }}>Undo</button> : null}
      </div>
      {done ? <p className={`aiw-note${done.ok ? '' : ' err'}`}>{done.text}</p> : null}
      {undo && !busy ? (
        <div className="aiw-change">
          <input className="input" value={change} onChange={(e) => setChange(e.target.value)} maxLength={800} placeholder="Want something changed? e.g. shorter, warmer, mention the parking"
            onKeyDown={(e) => { if (e.key === 'Enter' && change.trim()) { e.preventDefault(); run('improve') } }} aria-label="What should the AI change?" />
          <button type="button" className="btn btn-ghost btn-sm" disabled={!change.trim()} onClick={() => run('improve')}>Change it</button>
        </div>
      ) : null}
    </div>
  )
}
