'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { ENQUIRY_TEMPLATES, renderEnquiryEmail, type EnquiryEmailContext, type EnquiryEmailKind } from '@/lib/enquiry-email'
import type { ListingOption } from '@/lib/property-email-data'
import { sendEnquiryEmail, type SendState } from '../../../enquiry-email-actions'
import { AiWrite } from '../../AiWrite'
import { useEmailCheck } from '../../EmailCheck'

const KIND_LABEL: Record<EnquiryEmailKind, string> = {
  'sales-valuation': 'Sales valuation', 'lettings-valuation': 'Rental valuation', buyer: 'Buyer', tenant: 'Tenant',
}

/**
 * Pick a ready-made email, adjust the wording, see exactly what they'll get, and send it from the office mailbox.
 * `chooseKind` lets staff say what the enquiry is when it couldn't be sorted.
 */
export function EmailComposer({ id, ctx, to, canSend, blocked, chooseKind, start, listings = [], linkedId = null, suggested = null }: {
  id: string; ctx: EnquiryEmailContext; to: string | null; canSend: boolean; blocked: string | null; chooseKind: boolean; start?: string
  /** Our live listings, to put one in a buyer or tenant email; the one the enquiry is linked to; one its text names. */
  listings?: ListingOption[]; linkedId?: string | null; suggested?: string | null
}) {
  const [kind, setKind] = useState<EnquiryEmailKind>(ctx.kind)
  const templates = ENQUIRY_TEMPLATES[kind]
  const [key, setKey] = useState(templates.some((x) => x.key === start) ? start! : templates[0].key)
  const t = templates.find((x) => x.key === key) ?? templates[0]
  const [when, setWhen] = useState('')
  const [times, setTimes] = useState('')
  const [figure, setFigure] = useState(ctx.figure ?? '')
  // The property in the email: the linked listing, one the enquiry names, any other listing, or none (general).
  const [propertyId, setPropertyId] = useState<string>(linkedId ?? suggested ?? '')
  const forListing = kind === 'buyer' || kind === 'tenant'
  const c = useMemo(() => {
    if (!forListing) return { ...ctx, kind }
    const chosen = listings.find((l) => l.id === propertyId)
    return { ...ctx, kind, property: chosen ? chosen.card : propertyId && propertyId === linkedId ? ctx.property : null }
  }, [ctx, kind, forListing, listings, propertyId, linkedId])
  const order: ('sale' | 'let')[] = kind === 'tenant' ? ['let', 'sale'] : ['sale', 'let']
  const [subject, setSubject] = useState(() => t.subject(c, { figure }))
  const [message, setMessage] = useState(() => t.message(c, { figure }))
  const [edited, setEdited] = useState(false)
  const [files, setFiles] = useState<string[]>([])
  const [state, send, pending] = useActionState<SendState, FormData>(sendEnquiryEmail, {})
  const formRef = useRef<HTMLFormElement>(null)
  const pass = useRef(false)
  const check = useEmailCheck({ enquiryId: id, propertyId: forListing ? propertyId || null : null }, `an email replying to their enquiry: ${t.label}`, {
    fields: [
      { key: 'subject', label: 'Subject line', value: subject },
      { key: 'message', label: 'Message', value: message, note: t.sections.length ? `boxes added below it automatically: ${t.sections.map((x) => x.replace(/-/g, ' ')).join(', ')}` : undefined },
    ],
    apply: (v) => { if (v.subject != null) setSubject(v.subject); if (v.message != null) setMessage(v.message); setEdited(true) },
  })

  // A new template, or a new time typed in: fresh wording, unless staff have rewritten it themselves.
  useEffect(() => {
    if (edited) return
    setSubject(t.subject(c, { when, times, figure }))
    setMessage(t.message(c, { when, times, figure }))
  }, [t, c, when, times, figure, edited])

  const pick = (k: string) => { setKey(k); setEdited(false) }
  const html = useMemo(() => renderEnquiryEmail(c, t, subject, message, { when, times, figure, attached: files.length > 0 }).html, [c, t, subject, message, when, times, figure, files])

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

      <form ref={formRef} action={send} className="ew-form" onSubmit={async (e) => {
        // The check runs first; once it's happy (or staff press Send again), the form goes as normal.
        if (pass.current) { pass.current = false; return }
        e.preventDefault()
        if (await check.ensure({ subject, html })) { pass.current = true; formRef.current?.requestSubmit() }
      }}>
        <input type="hidden" name="id" value={id} />
        {forListing ? <input type="hidden" name="propertyId" value={propertyId} /> : null}
        {forListing && (listings.length || linkedId) ? (
          <div className="field ew-prop">
            <label htmlFor="ew-prop">Property in this email</label>
            <select id="ew-prop" className="select" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">None: keep the email general</option>
              {linkedId && !listings.some((l) => l.id === linkedId) && ctx.property ? <option value={linkedId}>{ctx.property.address} · {ctx.property.priceText} (the one they asked about)</option> : null}
              {order.map((ch) => {
                const group = listings.filter((l) => l.channel === ch)
                return group.length ? (
                  <optgroup key={ch} label={ch === 'sale' ? 'For sale' : 'To let'}>
                    {group.map((l) => <option key={l.id} value={l.id}>{l.label}{l.id === linkedId ? ' (the one they asked about)' : l.id === suggested ? ' (named in their enquiry)' : ''}</option>)}
                  </optgroup>
                ) : null
              })}
            </select>
            <span className="hint">{propertyId
              ? propertyId === linkedId ? 'The listing this enquiry came in for. Its photo, price and a button to see it on our website are in the email.'
                : propertyId === suggested ? 'Picked because their enquiry names this address. Check it’s the right one, or choose another.'
                  : 'Its photo, price and a button to see it on our website are in the email. Sending also links this enquiry to it.'
              : 'No property: the email stays general. Choose one of our listings to show it with a link to our website.'}</span>
          </div>
        ) : null}
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
        {t.key === 'report' ? <p className="ew-report-note">This sends their personal report at its own private link. <a href={`/admin/booklet/${id}`} target="_blank" rel="noreferrer">Check the booklet first</a>; any changes you save there are what they’ll see. You’ll be alerted when they open it.</p> : null}
        <div className="field"><label htmlFor="ew-to">To</label><input id="ew-to" className="input" value={to ?? 'No email address'} readOnly /></div>
        <div className="field"><label htmlFor="ew-subject">Subject</label><input id="ew-subject" name="subject" className="input" value={subject} onChange={(e) => { setSubject(e.target.value); setEdited(true) }} /></div>
        <div className="field"><label htmlFor="ew-message">Message</label><AiWrite place="enquiry" ctx={{ enquiryId: id, propertyId: forListing ? propertyId || null : null, about: [`The email is: ${t.label}${t.hint ? ` (${t.hint})` : ''}.`, when && `Day and time: ${when}.`, times && `Times we can offer: ${times.split('\n').filter(Boolean).join('; ')}.`, figure && `Our valuation: ${figure}.`, t.sections.length ? `Below the message, the email already shows these boxes, so don’t repeat them in full: ${t.sections.map((x) => x.replace(/-/g, ' ')).join(', ')}.` : ''].filter(Boolean).join(' ') }} value={message} onChange={(v) => { setMessage(v); setEdited(true) }} subject={subject} onSubject={(v) => { setSubject(v); setEdited(true) }} /><textarea id="ew-message" name="message" className="input" rows={10} value={message} onChange={(e) => { setMessage(e.target.value); setEdited(true) }} /></div>
<div className="field"><label htmlFor="ew-files">Attach files <span className="hint">(optional, e.g. the booklet saved as a PDF; up to 15 MB)</span></label><input id="ew-files" name="attachment" type="file" multiple accept="application/pdf,.pdf,image/jpeg,image/png" className="input" onChange={(e) => setFiles([...(e.target.files ?? [])].map((f) => f.name))} />{files.length ? <small className="ew-files">Attached: {files.join(', ')}</small> : null}</div>
        {edited ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdited(false)}>Go back to the standard wording</button> : null}

        {state.error ? <div className="notice err">{state.error}</div> : null}
        {state.ok ? <div className="notice ok">Sent: “{state.subject}”. It’s noted on the enquiry.</div> : null}
        {blocked ? <div className="notice">{blocked}</div> : null}
        {check.panel({ subject, html })}
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
