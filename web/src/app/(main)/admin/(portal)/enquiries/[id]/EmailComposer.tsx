'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { ENQUIRY_TEMPLATES, renderEnquiryEmail, type EnquiryEmailContext, type EnquiryEmailKind } from '@/lib/enquiry-email'
import { sendEnquiryEmail, type SendState } from '../../../enquiry-email-actions'

const KIND_LABEL: Record<EnquiryEmailKind, string> = {
  'sales-valuation': 'Sales valuation', 'lettings-valuation': 'Rental valuation', buyer: 'Buyer', tenant: 'Tenant',
}

/**
 * Pick a ready-made email, adjust the wording, see exactly what they'll get, and send it from the office mailbox.
 * `chooseKind` lets staff say what the enquiry is when it couldn't be sorted.
 */
export function EmailComposer({ id, ctx, to, canSend, blocked, chooseKind, start }: {
  id: string; ctx: EnquiryEmailContext; to: string | null; canSend: boolean; blocked: string | null; chooseKind: boolean; start?: string
}) {
  const [kind, setKind] = useState<EnquiryEmailKind>(ctx.kind)
  const templates = ENQUIRY_TEMPLATES[kind]
  const [key, setKey] = useState(templates.some((x) => x.key === start) ? start! : templates[0].key)
  const t = templates.find((x) => x.key === key) ?? templates[0]
  const [when, setWhen] = useState('')
  const [times, setTimes] = useState('')
  const [figure, setFigure] = useState(ctx.figure ?? '')
  const c = useMemo(() => ({ ...ctx, kind }), [ctx, kind])
  const [subject, setSubject] = useState(() => t.subject(c, { figure }))
  const [message, setMessage] = useState(() => t.message(c, { figure }))
  const [edited, setEdited] = useState(false)
  const [state, send, pending] = useActionState<SendState, FormData>(sendEnquiryEmail, {})

  // A new template, or a new time typed in: fresh wording, unless staff have rewritten it themselves.
  useEffect(() => {
    if (edited) return
    setSubject(t.subject(c, { when, times, figure }))
    setMessage(t.message(c, { when, times, figure }))
  }, [t, c, when, times, figure, edited])

  const pick = (k: string) => { setKey(k); setEdited(false) }
  const html = useMemo(() => renderEnquiryEmail(c, t, subject, message, { when, times, figure }).html, [c, t, subject, message, when, times, figure])

  return (
    <div className="ew-compose">
      {chooseKind ? (
        <div className="ew-kinds" role="group" aria-label="What is this enquiry?">
          <span>This enquiry is a:</span>
          {(Object.keys(KIND_LABEL) as EnquiryEmailKind[]).map((k) => (
            <button key={k} type="button" className={`ew-chip${kind === k ? ' on' : ''}`} onClick={() => { setKind(k); setKey(ENQUIRY_TEMPLATES[k][0].key); setEdited(false) }}>{KIND_LABEL[k]}</button>
          ))}
        </div>
      ) : null}

      <div className="ew-templates">
        {templates.map((x, i) => (
          <button key={x.key} type="button" className={`ew-template${x.key === t.key ? ' on' : ''}`} onClick={() => pick(x.key)}>
            <span className="n">{i + 1}</span>
            <span><b>{x.label}</b><small>{x.hint}</small></span>
          </button>
        ))}
      </div>

      <form action={send} className="ew-form">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="template" value={t.key} />
        <input type="hidden" name="when" value={when} />
        <input type="hidden" name="times" value={times} />
        <input type="hidden" name="figure" value={figure} />
        {t.needs === 'when' ? (
          <div className="field"><label htmlFor="ew-when">Day and time</label><input id="ew-when" className="input" value={when} onChange={(e) => setWhen(e.target.value)} placeholder="e.g. Saturday 15 November at 11am" /></div>
        ) : null}
        {t.needs === 'figure' ? (
          <div className="field"><label htmlFor="ew-figure">Your valuation</label><input id="ew-figure" className="input" value={figure} onChange={(e) => setFigure(e.target.value)} placeholder={kind === 'lettings-valuation' ? 'e.g. £1,850 to £1,950 a month' : 'e.g. £550,000 to £575,000'} /></div>
        ) : null}
        {t.needs === 'times' ? (
          <div className="field"><label htmlFor="ew-times">Times you can offer (one per line)</label><textarea id="ew-times" className="input" rows={3} value={times} onChange={(e) => setTimes(e.target.value)} placeholder={'Saturday 15 November, 11am\nMonday 17 November, 5.30pm'} /></div>
        ) : null}
        <div className="field"><label htmlFor="ew-to">To</label><input id="ew-to" className="input" value={to ?? 'No email address'} readOnly /></div>
        <div className="field"><label htmlFor="ew-subject">Subject</label><input id="ew-subject" name="subject" className="input" value={subject} onChange={(e) => { setSubject(e.target.value); setEdited(true) }} /></div>
        <div className="field"><label htmlFor="ew-message">Message</label><textarea id="ew-message" name="message" className="input" rows={10} value={message} onChange={(e) => { setMessage(e.target.value); setEdited(true) }} /></div>
        {edited ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdited(false)}>Go back to the standard wording</button> : null}

        {state.error ? <div className="notice err">{state.error}</div> : null}
        {state.ok ? <div className="notice ok">Sent: “{state.subject}”. It’s noted on the enquiry.</div> : null}
        {blocked ? <div className="notice">{blocked}</div> : null}
        <div className="actions">
          <button className="btn btn-gold" type="submit" disabled={pending || !canSend || !to}>{pending ? 'Sending…' : `Send to ${to ? to : 'them'}`}</button>
        </div>
      </form>

      <div className="ew-preview">
        <div className="ew-preview-bar"><span>Preview</span><b>{subject}</b></div>
        <iframe title="Email preview" srcDoc={html} sandbox="" />
      </div>
    </div>
  )
}
