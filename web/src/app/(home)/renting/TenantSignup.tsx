'use client'

import { useState } from 'react'

const RENTS = [1000, 1250, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000]
const BEDS: [string, number | ''][] = [['Any', ''], ['Studio', 0], ['1+', 1], ['2+', 2], ['3+', 3], ['4+', 4]]
const MOVES = ['As soon as possible', 'Within a month', 'In 1 to 3 months', 'In 3 months or more']
const FURN: [string, string][] = [['No preference', ''], ['Furnished', 'furnished'], ['Unfurnished', 'unfurnished']]

/** "Tell us what you're looking for": joins the waiting list and turns on email alerts for matching new lets. */
export function TenantSignup({ areas }: { areas: string[] }) {
  const [maxRent, setMaxRent] = useState('')
  const [minBeds, setMinBeds] = useState<number | ''>('')
  const [picked, setPicked] = useState<string[]>([])
  const [moveBy, setMoveBy] = useState('')
  const [furnishing, setFurnishing] = useState('')
  const [pets, setPets] = useState(false)
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [phone, setPhone] = useState(''), [notes, setNotes] = useState(''), [hp, setHp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; field?: string } | null>(null)
  const [done, setDone] = useState(false)
  const toggle = (a: string) => setPicked((x) => (x.includes(a) ? x.filter((y) => y !== a) : [...x, a]))

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setBusy(true)
    const r = await fetch('/api/public/tenant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, phone, maxRent, minBeds, areas: picked, moveBy, furnishing, pets, notes, hp_check: hp }) })
      .then((x) => x.json()).catch(() => null) as { ok?: boolean; error?: string; field?: string } | null
    setBusy(false)
    if (!r?.ok) return setError({ text: r?.error ?? 'That didn’t send. Please call us on 020 8127 7001.', field: r?.field })
    setDone(true)
  }

  if (done) return (
    <div className="vx-card" id="register">
      <div className="vx-done">
        <h2>You’re on the list, {name.split(' ')[0]}.</h2>
        <p>We’ll email you as soon as a home that fits comes on, often before it reaches the portals. Someone from the branch may also call to talk through what you need.</p>
        <p className="vx-fine">Browse what’s available now: <a href="/properties?channel=let">homes to rent</a>.</p>
      </div>
    </div>
  )
  return (
    <form className="vx-card tx-form" id="register" onSubmit={send} noValidate>
      <input type="text" name="hp_check" value={hp} onChange={(e) => setHp(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999 }} />
      <h2>Tell us what you’re looking for</h2>
      <p className="vx-hint">We’ll email you new homes that fit, often before they reach Zoopla. Unsubscribe any time.</p>
      <div className="vx-field">
          <label htmlFor="tx-rent">Rent up to</label>
          <select id="tx-rent" className="vx-select" value={maxRent} onChange={(e) => setMaxRent(e.target.value)}>
            <option value="">Any rent</option>
            {RENTS.map((r) => <option key={r} value={r}>£{r.toLocaleString('en-GB')} a month</option>)}
          </select>
      </div>
        <div className="vx-field">
          <span className="vx-label">Bedrooms</span>
          <div className="vx-chips" role="radiogroup" aria-label="Bedrooms">
            {BEDS.map(([l, v]) => <label key={l} className="vx-chip"><input type="radio" name="beds" checked={minBeds === v} onChange={() => setMinBeds(v)} /><span>{l}</span></label>)}
          </div>
        </div>
      <div className="vx-field">
        <span className="vx-label">Where? <span className="vx-opt">(choose any)</span></span>
        <div className="vx-chips" role="group" aria-label="Areas">
          {areas.map((a) => <label key={a} className="vx-chip"><input type="checkbox" checked={picked.includes(a)} onChange={() => toggle(a)} /><span>{a}</span></label>)}
        </div>
      </div>
      <div className="vx-field">
        <span className="vx-label">When do you want to move?</span>
        <div className="vx-chips" role="radiogroup" aria-label="Move date">
          {MOVES.map((m) => <label key={m} className="vx-chip"><input type="radio" name="move" checked={moveBy === m} onChange={() => setMoveBy(m)} /><span>{m}</span></label>)}
        </div>
      </div>
        <div className="vx-field">
          <span className="vx-label">Furnished?</span>
          <div className="vx-chips" role="radiogroup" aria-label="Furnished">
            {FURN.map(([l, v]) => <label key={l} className="vx-chip"><input type="radio" name="furn" checked={furnishing === v} onChange={() => setFurnishing(v)} /><span>{l}</span></label>)}
          </div>
        </div>
        <div className="vx-field">
          <span className="vx-label">Pets</span>
          <div className="vx-chips"><label className="vx-chip"><input type="checkbox" checked={pets} onChange={(e) => setPets(e.target.checked)} /><span>I have a pet</span></label></div>
        </div>
      <div className="vx-row">
        <div className="vx-field"><label htmlFor="tx-name">Your name</label><input id="tx-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-invalid={error?.field === 'name' || undefined} /></div>
        <div className="vx-field"><label htmlFor="tx-email">Email</label><input id="tx-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={error?.field === 'email' || undefined} /></div>
      </div>
      <div className="vx-row">
        <div className="vx-field"><label htmlFor="tx-phone">Phone <span className="vx-opt">(optional)</span></label><input id="tx-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" aria-invalid={error?.field === 'phone' || undefined} /></div>
        <div className="vx-field"><label htmlFor="tx-notes">Anything else? <span className="vx-opt">(optional)</span></label><input id="tx-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. need parking, near Kenton station" /></div>
      </div>
      {error ? <p className="vx-error" role="alert">{error.text}</p> : null}
      <div className="vx-actions">
        <span className="vx-fine">We’ll only use your details to send you homes and help you find one.</span>
        <button type="submit" className="btn gold" disabled={busy}>{busy ? 'Sending…' : 'Send me matching homes'}</button>
      </div>
    </form>
  )
}
