'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const MAX_NOTE = 256

/** "Add a note": a private note about this home, kept in the visitor's own browser (we never see it). */
export function PropertyNote({ propertyRef }: { propertyRef: string }) {
  const key = `phe_note_${propertyRef}`
  const [saved, setSaved] = useState('')
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try { const v = localStorage.getItem(key) ?? ''; setSaved(v); setDraft(v); setEditing(!v) } catch { /* private mode */ }
  }, [key])

  const save = () => {
    const v = draft.trim().slice(0, MAX_NOTE)
    try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key) } catch { setMsg('Your browser won’t let us save notes (private browsing?).'); return }
    setSaved(v); setDraft(v); setEditing(!v); setMsg(v ? 'Saved on this device.' : 'Note removed.')
  }
  const cancel = () => { setDraft(saved); setEditing(!saved); setMsg(null) }

  if (!editing && saved) {
    return (
      <div className="pn">
        <p className="pn-saved">{saved}</p>
        <div className="pn-row">
          <span className="pn-hint">{msg ?? 'Only you can see this note. It’s saved on this device.'}</span>
          <span className="pn-btns">
            <button type="button" className="btn btn-ghost" onClick={() => { setEditing(true); setMsg(null); setTimeout(() => box.current?.focus(), 0) }}>Edit</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setDraft(''); try { localStorage.removeItem(key) } catch {} setSaved(''); setEditing(true); setMsg('Note removed.') }}>Delete</button>
          </span>
        </div>
      </div>
    )
  }
  return (
    <div className="pn">
      <label htmlFor={`pn-${propertyRef}`} className="pn-sr">Your note about this home</label>
      <textarea id={`pn-${propertyRef}`} ref={box} className="input pn-box" rows={2} maxLength={MAX_NOTE} value={draft}
        onChange={(e) => { setDraft(e.target.value); setMsg(null) }} placeholder="Add yourself a note, e.g. “Ask about the loft” or “Viewing Saturday 11am”" />
      <div className="pn-row">
        <span className="pn-hint">{msg ?? `Only you can see this. ${MAX_NOTE - draft.length} characters left.`}</span>
        <span className="pn-btns">
          <button type="button" className="btn btn-ghost" onClick={cancel}>Cancel</button>
          <button type="button" className="btn btn-gold" onClick={save} disabled={draft.trim() === saved}>Save</button>
        </span>
      </div>
    </div>
  )
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
const num = (s: string) => { const n = Number(s.replace(/[£,\s%]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0 }
const repayment = (principal: number, ratePct: number, years: number) => {
  const i = ratePct / 100 / 12, n = years * 12
  if (principal <= 0 || n <= 0) return 0
  return i === 0 ? principal / n : (principal * i) / (1 - Math.pow(1 + i, -n))
}

/** "Mortgage": what this home might cost a month, with the price filled in. */
export function MortgageBox({ price }: { price: number }) {
  const [priceS, setPrice] = useState(price.toLocaleString('en-GB'))
  const [depositPct, setDepositPct] = useState('10')
  const [rate, setRate] = useState('4.5')
  const [term, setTerm] = useState('25')
  const r = useMemo(() => {
    const pr = num(priceS), pct = Math.min(100, num(depositPct)), rt = Math.min(15, Number(rate) || 0), yrs = Math.min(40, Math.max(5, Number(term) || 25))
    const deposit = (pr * pct) / 100, loan = Math.max(0, pr - deposit)
    return { pr, deposit, loan, rt, yrs, pay: repayment(loan, rt, yrs), interestOnly: (loan * rt) / 100 / 12 }
  }, [priceS, depositPct, rate, term])

  return (
    <div className="mg">
      <div className="mg-fields">
        <div className="field"><label htmlFor="mg-price">Price (£)</label><input id="mg-price" className="input" inputMode="numeric" value={priceS} onChange={(e) => setPrice(e.target.value)} /></div>
        <div className="field"><label htmlFor="mg-dep">Deposit (%)</label><input id="mg-dep" className="input" inputMode="decimal" value={depositPct} onChange={(e) => setDepositPct(e.target.value)} /></div>
        <div className="field"><label htmlFor="mg-rate">Interest rate (%)</label><input id="mg-rate" className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        <div className="field"><label htmlFor="mg-term">Term (years)</label><input id="mg-term" className="input" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
      </div>
      <div className="mg-out" aria-live="polite">
        <div><span>Monthly repayment</span><b>{r.pay ? gbp(r.pay) : '–'}</b><small>over {r.yrs} years at {r.rt}%</small></div>
        <div><span>Deposit</span><b>{gbp(r.deposit)}</b><small>{r.pr ? `${Math.round((r.deposit / r.pr) * 100)}% of the price` : ''}</small></div>
        <div><span>Mortgage</span><b>{gbp(r.loan)}</b><small>{r.loan ? `interest-only about ${gbp(r.interestOnly)} a month` : ''}</small></div>
      </div>
      <p className="mg-note">A guide only, with an example rate: change it to the rate you’ve been offered. <a href="/mortgage-calculator">How much could you borrow? →</a></p>
      <p className="mg-warn">Your home may be repossessed if you do not keep up repayments on your mortgage.</p>
    </div>
  )
}
