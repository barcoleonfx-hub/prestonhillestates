'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import type { WaProps } from '@/lib/whatsapp-data'
import { newHomeMessage, quietEnds, quietReason, waLink } from '@/lib/whatsapp'
import { logWhatsApp, logWhatsAppReply } from '../lead-actions'

const WA_PATH = 'M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.8h-.01a9.84 9.84 0 0 1-5.02-1.38l-.36-.21-3.73.98 1-3.64-.24-.37a9.82 9.82 0 0 1-1.51-5.24c0-5.44 4.43-9.86 9.87-9.86a9.8 9.8 0 0 1 6.98 2.9 9.8 9.8 0 0 1 2.89 6.98c0 5.44-4.43 9.86-9.87 9.86zm8.4-18.26A11.8 11.8 0 0 0 12.04.06C5.5.06.17 5.38.17 11.93c0 2.09.55 4.13 1.59 5.94L.07 24l6.3-1.65a11.86 11.86 0 0 0 5.67 1.44h.01c6.54 0 11.87-5.32 11.87-11.87 0-3.17-1.24-6.15-3.48-8.39z'
export const WaIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d={WA_PATH} /></svg>

/**
 * "WhatsApp": choose a ready-written message (or write one), check it, and open WhatsApp with it filled in, on the
 * office phone or WhatsApp on this computer. Staff press send there. It's noted on the lead, and counts as contact.
 * Also "They replied" and "They said STOP", since replies arrive on the phone, not here.
 */
export function WhatsAppButton({ wa, className = 'btn btn-ghost', autoOpen = false, label = 'WhatsApp' }: { wa: WaProps; className?: string; autoOpen?: boolean; label?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'send' | 'reply'>('send')
  const [key, setKey] = useState(wa.templates[0]?.key ?? 'own')
  const [text, setText] = useState(wa.templates[0]?.text ?? '')
  const [homeId, setHomeId] = useState('')
  const [note, setNote] = useState('')
  const [stop, setStop] = useState(false)
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null)
  const [quiet, setQuiet] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // Opened from the list (?wa=1): open once, and take it out of the address so a reload doesn't reopen it.
  useEffect(() => {
    if (!autoOpen) return
    if (!wa.blocked) setOpen(true)
    const u = new URL(window.location.href)
    u.searchParams.delete('wa')
    router.replace(`${u.pathname}${u.search}${u.hash}`, { scroll: false })
  }, [autoOpen, wa.blocked, router])
  useEffect(() => {
    if (!open) return
    const r = quietReason()
    setQuiet(r ? `${r}. Unless they asked you to message now, it’s kinder to send this ${quietEnds()}.` : null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const marketing = key === 'home'
  const home = wa.homes.find((h) => h.id === homeId)
  const choose = (k: string) => {
    setKey(k); setMsg(null)
    if (k === 'home') { setText(home ? newHomeMessage(wa.first, wa.me, home) : ''); return }
    setText(wa.templates.find((t) => t.key === k)?.text ?? '')
  }
  const pickHome = (id: string) => {
    setHomeId(id)
    const h = wa.homes.find((x) => x.id === id)
    setText(h ? newHomeMessage(wa.first, wa.me, h) : '')
  }
  const link = useMemo(() => (wa.e164 ? waLink(wa.e164, text.trim()) : '#'), [wa.e164, text])
  const label2 = marketing ? 'New home' : wa.templates.find((t) => t.key === key)?.label ?? 'Message'
  const cantSend = !text.trim() || (marketing && (!wa.consent || !home))

  // The link opens WhatsApp straight away (so the browser doesn't block it); the note is saved alongside.
  const sent = () => {
    start(async () => {
      const r = await logWhatsApp({ enquiryId: wa.enquiryId, contactId: wa.contactId, label: label2, text, marketing })
      if (r.error) setMsg({ error: r.error })
      else { setMsg({ ok: 'Noted on their timeline. Press send in WhatsApp.' }); router.refresh() }
    })
  }
  const saveReply = () => {
    start(async () => {
      const r = await logWhatsAppReply({ enquiryId: wa.enquiryId, contactId: wa.contactId, note, stop })
      if (r.error) setMsg({ error: r.error })
      else { setMsg({ ok: r.stopped ? 'Done. Nobody can WhatsApp them from the portal now.' : 'Noted. The lead is now Engaged.' }); setNote(''); setStop(false); router.refresh() }
    })
  }

  if (wa.blocked && !open) {
    return <button type="button" className={className} disabled title={wa.blocked}><WaIcon /> {label}</button>
  }
  return (
    <>
      <button type="button" className={className} onClick={() => { setOpen(true); setMsg(null) }}><WaIcon /> {label}</button>
      {open ? createPortal(
        <div className="wa-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="wa-box" role="dialog" aria-modal="true" aria-labelledby="wa-title">
            <div className="wa-head">
              <h2 id="wa-title"><WaIcon /> WhatsApp {wa.first || 'them'}</h2>
              <span className="wa-num">{wa.e164}</span>
              <button type="button" className="wa-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="seg wa-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'send'} className={tab === 'send' ? 'on' : undefined} onClick={() => { setTab('send'); setMsg(null) }}>Send a message</button>
              <button type="button" role="tab" aria-selected={tab === 'reply'} className={tab === 'reply' ? 'on' : undefined} onClick={() => { setTab('reply'); setMsg(null) }}>They replied</button>
            </div>
            {wa.blocked ? <p className="notice err">{wa.blocked}</p> : tab === 'send' ? (
              <div className="wa-body">
                {quiet ? <p className="notice warn">{quiet}</p> : null}
                <div className="wa-chips">
                  {wa.templates.map((t) => <button key={t.key} type="button" className={key === t.key ? 'on' : undefined} onClick={() => choose(t.key)}>{t.label}</button>)}
                  {wa.homes.length ? <button type="button" className={marketing ? 'on' : undefined} onClick={() => choose('home')}>A new home for them</button> : null}
                </div>
                {marketing ? (
                  wa.consent ? (
                    <label className="wa-field">Which home?
                      <select className="input" value={homeId} onChange={(e) => pickHome(e.target.value)}>
                        <option value="">Choose one of our homes</option>
                        {(['sale', 'let'] as const).map((ch) => {
                          const list = wa.homes.filter((h) => h.channel === ch)
                          return list.length ? <optgroup key={ch} label={ch === 'sale' ? 'For sale' : 'To let'}>{list.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}</optgroup> : null
                        })}
                      </select>
                    </label>
                  ) : <p className="notice">They haven’t ticked the box to get WhatsApp messages about other homes, so this one can’t be sent. Messages about their own enquiry are fine.</p>
                ) : null}
                <label className="wa-field">Message
                  <textarea className="textarea" rows={15} style={{ maxHeight: '52vh' }} value={text} onChange={(e) => setText(e.target.value)} />
                </label>
                <p className="wa-hint">This opens WhatsApp with the message filled in. Check it and press send there (words between *stars* show in bold). Use the office phone (07745 203146) or WhatsApp on this computer.</p>
                {msg?.error ? <p className="notice err" role="alert">{msg.error}</p> : null}
                {msg?.ok ? <p className="notice ok" role="status">{msg.ok}</p> : null}
                <div className="wa-actions">
                  {cantSend
                    ? <button type="button" className="btn btn-wa" disabled><WaIcon /> Open WhatsApp</button>
                    : <a className="btn btn-wa" href={link} target="_blank" rel="noopener noreferrer" onClick={sent} aria-disabled={pending}><WaIcon /> Open WhatsApp</a>}
                  <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Close</button>
                </div>
              </div>
            ) : (
              <div className="wa-body">
                <p className="wa-hint">Replies come to the office phone, not here. Note them so everyone can see where things are.</p>
                <label className="wa-field">What did they say? <span className="wa-opt">(optional)</span>
                  <textarea className="textarea" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Can view Saturday morning" />
                </label>
                <label className="wa-check"><input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} /> They said STOP, or asked not to be messaged on WhatsApp</label>
                {msg?.error ? <p className="notice err" role="alert">{msg.error}</p> : null}
                {msg?.ok ? <p className="notice ok" role="status">{msg.ok}</p> : null}
                <div className="wa-actions">
                  <button type="button" className={`btn ${stop ? 'btn-danger' : 'btn-dark'}`} onClick={saveReply} disabled={pending || (!note.trim() && !stop)}>{stop ? 'Stop WhatsApp messages' : 'Save their reply'}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Close</button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
