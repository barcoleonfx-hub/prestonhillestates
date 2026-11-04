'use client'
import { useEffect, useRef, useState } from 'react'
import { SoldPanel } from './SoldPanel'

type Intent = 'selling' | 'letting'
type Field = 'postcode' | 'address' | 'name' | 'phone' | 'email'

const TYPES = ['House', 'Flat', 'Maisonette', 'Bungalow', 'Other']
const BEDS = ['Studio', '1', '2', '3', '4', '5+']
const WHEN: Record<Intent, string[]> = {
  selling: ['As soon as possible', 'Within 3 months', 'Within 6 months', 'Just finding out'],
  letting: ['Available now', 'Within a month', 'Within 3 months', 'Just finding out'],
}
const TIMES = ['Morning', 'Afternoon', 'Evening', 'Any time']
const STEP_OF: Record<Field, number> = { postcode: 0, address: 0, name: 2, phone: 2, email: 2 }
const POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/
const STORE_KEY = 'phe_valuation_popup'

function Chips({ name, options, value, onChange }: { name: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="vx-chips" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <label key={o} className="vx-chip">
          <input type="radio" name={name} checked={value === o} onChange={() => onChange(o)} />
          <span>{o}</span>
        </label>
      ))}
    </div>
  )
}

export function ValuationWizard({ initialIntent, initialPostcode }: { initialIntent: Intent; initialPostcode: string }) {
  const [step, setStep] = useState(0)
  const [intent, setIntent] = useState<Intent>(initialIntent)
  const [postcode, setPostcode] = useState(initialPostcode)
  const [address, setAddress] = useState('')
  // Address finder: the list for the postcode they typed, or typing it themselves.
  const [addrList, setAddrList] = useState<string[] | null>(null)
  const [addrFor, setAddrFor] = useState('')
  const [finding, setFinding] = useState(false)
  const [manual, setManual] = useState(false)
  const [type, setType] = useState('')
  const [beds, setBeds] = useState('')
  const [when, setWhen] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [time, setTime] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<{ field?: Field; text: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => { if (done) card.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [done])

  // Clear a field's error as soon as they start correcting it.
  useEffect(() => { setError((e) => (e?.field ? null : e)) }, [postcode, address, name, phone, email])

  const fail = (field: Field, text: string) => {
    setStep(STEP_OF[field])
    setError({ field, text })
    requestAnimationFrame(() => document.getElementById(`vx-${field}`)?.focus())
    return false
  }
  const pc = postcode.trim().toUpperCase().replace(/\s+/g, ' ')

  const findAddresses = async (code = pc) => {
    if (!POSTCODE.test(code)) return fail('postcode', 'Enter the full postcode, e.g. HA3 0PS.')
    setError(null)
    setFinding(true)
    try {
      const r = (await (await fetch(`/api/public/addresses?postcode=${encodeURIComponent(code)}`)).json()) as { addresses?: string[] }
      const list = r.addresses ?? []
      setAddrList(list)
      setAddrFor(code)
      setManual(list.length === 0)
      setAddress('')
      requestAnimationFrame(() => document.getElementById(list.length ? 'vx-address-pick' : 'vx-address')?.focus())
    } catch {
      setAddrList([]); setAddrFor(code); setManual(true)
    }
    setFinding(false)
    return true
  }
  // A postcode passed in from the homepage: look it up straight away.
  useEffect(() => { if (POSTCODE.test(initialPostcode.trim().toUpperCase())) findAddresses(initialPostcode.trim().toUpperCase().replace(/\s+/g, ' ')) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // A different postcode means a different list.
  useEffect(() => { if (addrFor && pc !== addrFor) { setAddrList(null); setAddress(''); setManual(false) } }, [pc, addrFor])

  const checkStep = (s: number) => {
    setError(null)
    if (s === 0) {
      if (!POSTCODE.test(pc)) return fail('postcode', 'Enter the full postcode, e.g. HA3 0PS.')
      if (address.trim().length < 3) return addrList?.length && !manual
        ? fail('address', 'Choose your address from the list, or pick “My address isn’t listed”.')
        : fail('address', 'Add the house number and street so we know which home to value.')
    }
    if (s === 2) {
      if (!name.trim()) return fail('name', 'Please tell us your name.')
      if (!/^[0-9+()\s-]{7,20}$/.test(phone.trim())) return fail('phone', phone.trim() ? 'That phone number doesn’t look right.' : 'Add a phone number so we can arrange a time.')
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return fail('email', 'That email address doesn’t look right.')
    }
    return true
  }

  const go = (to: number) => {
    if (to > step && !checkStep(step)) return
    setStep(to)
    card.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    // On the first step, pressing Continue with just a postcode finds the addresses first.
    if (step === 0 && !address.trim() && POSTCODE.test(pc) && addrList === null && !manual) { await findAddresses(); return }
    if (step < 2) return go(step + 1)
    if (!checkStep(0) || !checkStep(2)) return
    setSending(true)
    const company = (e.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>('input[name=company]')?.value ?? ''
    try {
      const res = await fetch('/api/public/valuation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim(), postcode: pc, intent, address: address.trim(), propertyType: type, bedrooms: beds, timescale: when, contactTime: time, notes: notes.trim(), company }),
      })
      const r = (await res.json()) as { ok: boolean; error?: string; field?: Field }
      if (!r.ok) {
        setSending(false)
        return r.field && r.field in STEP_OF ? fail(r.field, r.error ?? 'Please check this.') : setError({ text: r.error ?? 'Something went wrong. Please call us on 020 8127 7001.' })
      }
      try { localStorage.setItem(STORE_KEY, String(Date.now() + 365 * 864e5)) } catch { /* private mode */ }
      setDone(true)
    } catch {
      setError({ text: 'We couldn’t send that. Please check your connection or call us on 020 8127 7001.' })
    }
    setSending(false)
  }

  if (done) {
    return (
      <div className="vx-card vx-done" ref={card} role="status">
        <div className="vx-tick" aria-hidden="true">✓</div>
        <h2>Thank you, {name.trim().split(/\s+/)[0]}.</h2>
        <p>Your request for {address.trim()}, {pc} is with the branch.</p>
        <ol className="vx-next">
          <li><b>We’ll call you</b> within one working day{time && time !== 'Any time' ? `, in the ${time.toLowerCase()} if we can` : ''}, to arrange a time.</li>
          <li><b>We visit</b> and walk round the property with you.</li>
          <li><b>You get our figure</b> and an honest view of how we’d {intent === 'letting' ? 'let' : 'sell'} it. No obligation.</li>
        </ol>
        <p className="vx-fine">Can’t wait? Call the branch on <a href="tel:+442081277001">020 8127 7001</a>.</p>
      </div>
    )
  }

  const labels = ['The property', 'About it', 'Your details']
  return (
    <div className="vx-card" ref={card} id="val-start">
      <ol className="vx-steps" aria-label="Progress">
        {labels.map((l, i) => (
          <li key={l} className={i === step ? 'on' : i < step ? 'done' : undefined} aria-current={i === step ? 'step' : undefined}>
            <button type="button" onClick={() => i < step && go(i)} disabled={i >= step}><span className="n">{i < step ? '✓' : i + 1}</span>{l}</button>
          </li>
        ))}
      </ol>

      <form onSubmit={submit} noValidate>
        <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999 }} />
        {step === 0 ? (
          <div className="vx-pane">
            <h2>Where’s the property?</h2>
            <div className="vx-intent" role="radiogroup" aria-label="Selling or letting">
              {(['selling', 'letting'] as Intent[]).map((v) => (
                <label key={v} className="vx-big">
                  <input type="radio" name="intent" checked={intent === v} onChange={() => { setIntent(v); setWhen('') }} />
                  <span><b>{v === 'selling' ? 'I want to sell' : 'I want to let'}</b><small>{v === 'selling' ? 'Sales valuation' : 'Rental valuation'}</small></span>
                </label>
              ))}
            </div>
            <div className="vx-field">
              <label htmlFor="vx-postcode">Postcode</label>
              <div className="vx-find">
                <input id="vx-postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && addrList === null) { e.preventDefault(); findAddresses() } }} autoComplete="postal-code" placeholder="e.g. HA3 0PS" aria-invalid={error?.field === 'postcode' || undefined} style={{ textTransform: 'uppercase' }} />
                <button type="button" className="vx-find-btn" onClick={() => findAddresses()} disabled={finding}>{finding ? 'Finding…' : addrList !== null && addrFor === pc ? 'Search again' : 'Find address'}</button>
              </div>
            </div>
            {addrList !== null && addrList.length > 0 && !manual ? (
              <div className="vx-field">
                <label htmlFor="vx-address-pick">Select your address</label>
                <select id="vx-address-pick" className="vx-select" value={address} aria-invalid={error?.field === 'address' || undefined}
                  onChange={(e) => { if (e.target.value === '__manual') { setManual(true); setAddress(''); requestAnimationFrame(() => document.getElementById('vx-address')?.focus()) } else setAddress(e.target.value) }}>
                  <option value="" disabled>Choose your address ({addrList.length} found)</option>
                  {addrList.map((a) => <option key={a} value={a}>{a}</option>)}
                  <option value="__manual">My address isn’t listed</option>
                </select>
              </div>
            ) : null}
            {manual || addrList === null ? (
              <div className="vx-field">
                <label htmlFor="vx-address">House number and street</label>
                <input id="vx-address" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="address-line1" placeholder="e.g. 14 Woodcock Hill" aria-invalid={error?.field === 'address' || undefined} />
                {manual && addrList?.length ? <button type="button" className="vx-linkish" onClick={() => { setManual(false); setAddress('') }}>Choose from the list instead</button> : null}
                {manual && addrList && !addrList.length ? <span className="vx-hint">We couldn’t list the addresses on {addrFor}; just type yours.</span> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="vx-pane">
            <h2>Tell us a little about it</h2>
            <p className="vx-hint">Optional, but it helps whoever comes out to prepare.</p>
            <div className="vx-field"><span className="vx-label">Type of property</span><Chips name="type" options={TYPES} value={type} onChange={setType} /></div>
            <div className="vx-field"><span className="vx-label">Bedrooms</span><Chips name="beds" options={BEDS} value={beds} onChange={setBeds} /></div>
            <div className="vx-field"><span className="vx-label">{intent === 'letting' ? 'When would it be available?' : 'When are you thinking of selling?'}</span><Chips name="when" options={WHEN[intent]} value={when} onChange={setWhen} /></div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="vx-pane">
            <h2>Where should we call you?</h2>
            <div className="vx-row">
              <div className="vx-field"><label htmlFor="vx-name">Your name</label><input id="vx-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-invalid={error?.field === 'name' || undefined} /></div>
              <div className="vx-field"><label htmlFor="vx-phone">Phone number</label><input id="vx-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" aria-invalid={error?.field === 'phone' || undefined} /></div>
            </div>
            <div className="vx-field"><label htmlFor="vx-email">Email <span className="vx-opt">(optional)</span></label><input id="vx-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={error?.field === 'email' || undefined} /></div>
            <div className="vx-field"><span className="vx-label">Best time to call</span><Chips name="time" options={TIMES} value={time} onChange={setTime} /></div>
            <div className="vx-field"><label htmlFor="vx-notes">Anything we should know? <span className="vx-opt">(optional)</span></label><textarea id="vx-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. extended at the back, tenant in place until March" /></div>
            <p className="vx-fine">We’ll only use your details to arrange your valuation.</p>
          </div>
        ) : null}

        {error ? <p className="vx-error" role="alert">{error.text}</p> : null}
        <div className="vx-actions">
          {step > 0 ? <button type="button" className="vx-back" onClick={() => go(step - 1)}>Back</button> : <span />}
          <button type="submit" className="btn gold" disabled={sending}>{sending ? 'Sending…' : step < 2 ? 'Continue' : 'Book my free valuation'}</button>
        </div>
      </form>
      {step >= 1 && intent === 'selling' ? <SoldPanel postcode={postcode} type={type} /> : null}
    </div>
  )
}
