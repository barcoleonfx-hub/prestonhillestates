'use client'
import { useMemo, useState } from 'react'

// Most UK lenders lend roughly 4 to 4.5 times household income, after allowing for regular debts.
const LOW_MULTIPLE = 4
const HIGH_MULTIPLE = 4.5

const num = (s: string) => {
  const n = Number(s.replace(/[£,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}
const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
const roundDown = (n: number, to: number) => Math.max(0, Math.floor(n / to) * to)
const monthly = (principal: number, ratePct: number, years: number) => {
  const i = ratePct / 100 / 12
  const n = years * 12
  if (principal <= 0 || n <= 0) return 0
  return i === 0 ? principal / n : (principal * i) / (1 - Math.pow(1 + i, -n))
}

function Money({ id, label, hint, value, onChange }: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mc-field">
      <label htmlFor={id}>{label}</label>
      <div className="mc-money">
        <span aria-hidden="true">£</span>
        <input id={id} inputMode="numeric" autoComplete="off" value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d,]/g, ''))}
          onBlur={() => value && onChange(num(value).toLocaleString('en-GB'))} />
      </div>
      {hint ? <span className="mc-hint">{hint}</span> : null}
    </div>
  )
}

export function BorrowCalculator() {
  const [joint, setJoint] = useState(false)
  const [inc1, setInc1] = useState('')
  const [inc2, setInc2] = useState('')
  const [debts, setDebts] = useState('')
  const [deposit, setDeposit] = useState('')
  const [rate, setRate] = useState('4.5')
  const [term, setTerm] = useState('25')

  const r = useMemo(() => {
    const income = num(inc1) + (joint ? num(inc2) : 0)
    const usable = Math.max(0, income - num(debts) * 12)
    const low = roundDown(usable * LOW_MULTIPLE, 1000)
    const high = roundDown(usable * HIGH_MULTIPLE, 1000)
    const dep = num(deposit)
    const rateN = Math.min(15, Math.max(0, Number(rate) || 0))
    const termN = Math.min(40, Math.max(5, Number(term) || 25))
    return {
      income, usable, low, high, dep, rateN, termN,
      priceLow: low + dep, priceHigh: high + dep,
      pay: monthly(high, rateN, termN),
      depPct: high + dep > 0 ? (dep / (high + dep)) * 100 : 0,
    }
  }, [inc1, inc2, joint, debts, deposit, rate, term])

  const has = r.income > 0

  return (
    <div className="mc">
      <div className="mc-inputs">
        <div className="mc-field">
          <span className="mc-label">Are you buying</span>
          <div className="vx-intent" role="radiogroup" aria-label="Buying alone or with someone">
            {[[false, 'On my own'], [true, 'With someone else']].map(([v, l]) => (
              <label key={String(v)} className="vx-big">
                <input type="radio" name="joint" checked={joint === v} onChange={() => setJoint(v as boolean)} />
                <span><b>{l as string}</b></span>
              </label>
            ))}
          </div>
        </div>
        <Money id="mc-inc1" label={joint ? 'Your yearly income before tax' : 'Yearly income before tax'} hint="Salary, plus any regular overtime or bonus." value={inc1} onChange={setInc1} />
        {joint ? <Money id="mc-inc2" label="Their yearly income before tax" value={inc2} onChange={setInc2} /> : null}
        <Money id="mc-debts" label="Monthly repayments on loans, cards and car finance" hint="Leave blank if none." value={debts} onChange={setDebts} />
        <Money id="mc-dep" label="Your deposit" hint="Savings, gifts, or equity from a home you’re selling." value={deposit} onChange={setDeposit} />
        <details className="mc-assume">
          <summary>Adjust the interest rate and term</summary>
          <div className="mc-row">
            <div className="mc-field"><label htmlFor="mc-rate">Interest rate (%)</label><input id="mc-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} /></div>
            <div className="mc-field"><label htmlFor="mc-term">Term (years)</label><input id="mc-term" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value.replace(/\D/g, ''))} /></div>
          </div>
        </details>
      </div>

      <div className="mc-result" aria-live="polite">
        {has ? (
          <>
            <p className="mc-kicker">You could borrow around</p>
            <p className="mc-big serif">{gbp(r.low)} <span>to</span> {gbp(r.high)}</p>
            {r.dep > 0 ? (
              <p className="mc-line">With your {gbp(r.dep)} deposit, that’s a home of about <b>{gbp(r.priceLow)} to {gbp(r.priceHigh)}</b>.</p>
            ) : (
              <p className="mc-line">Add your deposit to see the price range that puts within reach.</p>
            )}
            <dl className="mc-facts">
              <div><dt>Monthly repayment</dt><dd>about <b>{gbp(r.pay)}</b> if you borrow {gbp(r.high)} at {r.rateN}% over {r.termN} years (repayment mortgage)</dd></div>
              {r.dep > 0 ? <div><dt>Deposit</dt><dd><b>{r.depPct.toFixed(0)}%</b> of {gbp(r.priceHigh)}{r.depPct < 5 ? '. Most lenders need at least 5%.' : r.depPct < 10 ? '. A bigger deposit usually means better rates.' : ''}</dd></div> : null}
              {num(debts) > 0 ? <div><dt>Your repayments</dt><dd>reduce what you could borrow by about {gbp(num(debts) * 12 * HIGH_MULTIPLE)}</dd></div> : null}
            </dl>
            <a className="btn gold mc-cta" href={`/properties?channel=sale${r.priceHigh > 0 ? `&max=${roundDown(r.priceHigh, 5000)}` : ''}`}>See homes up to {gbp(roundDown(r.priceHigh, 5000))}</a>
          </>
        ) : (
          <div className="mc-empty">
            <p className="mc-kicker">Your estimate</p>
            <p className="mc-big serif">Enter your income</p>
            <p className="mc-line">You’ll see a rough borrowing range, the price range that puts within reach, and an idea of the monthly repayment.</p>
          </div>
        )}
        <p className="mc-warn">This is a rough guide, not a mortgage offer or financial advice. Lenders look at your full circumstances, including credit history and outgoings, and some lend more or less than this. Speak to a qualified mortgage adviser before you commit. <b>Your home may be repossessed if you do not keep up repayments on your mortgage.</b></p>
      </div>

      {has ? <BuyerSignup budget={r.dep > 0 ? roundDown(r.priceHigh, 5000) : roundDown(r.high, 5000)} summary={`Calculator: income ${gbp(r.income)}${joint ? ' (joint)' : ''}, commitments ${gbp(num(debts))}/month, deposit ${gbp(r.dep)}. Could borrow about ${gbp(r.low)}–${gbp(r.high)}; budget about ${gbp(r.priceLow)}–${gbp(r.priceHigh)}.`} /> : null}
    </div>
  )
}

function BuyerSignup({ budget, summary }: { budget: number; summary: string }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [areas, setAreas] = useState('')
  const [state, setState] = useState<{ error?: string; field?: string; done?: boolean; sending?: boolean }>({})

  const send = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!name.trim()) return setState({ error: 'Please tell us your name.', field: 'name' })
    if (!phone.trim() && !email.trim()) return setState({ error: 'Add a phone number or email so we can send you homes.', field: 'phone' })
    setState({ sending: true })
    const company = e.currentTarget.querySelector<HTMLInputElement>('input[name=company]')?.value ?? ''
    try {
      const res = await fetch('/api/public/buyer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, phone, email, areas, budget, summary, company }) })
      const r = (await res.json()) as { ok: boolean; error?: string; field?: string }
      setState(r.ok ? { done: true } : { error: r.error ?? 'Something went wrong. Please call us on 020 8127 7001.', field: r.field })
    } catch {
      setState({ error: 'We couldn’t send that. Please check your connection or call us on 020 8127 7001.' })
    }
  }

  if (state.done) {
    return (
      <div className="mc-signup mc-signup-done" role="status">
        <h3>You’re on our list, {name.trim().split(/\s+/)[0]}.</h3>
        <p>We’ll be in touch about homes around {gbp(budget)}{areas ? ` in ${areas}` : ''} as they come on the market.</p>
      </div>
    )
  }
  return (
    <form className="mc-signup" onSubmit={send} noValidate>
      <div>
        <h3>Hear about homes in your budget first</h3>
        <p>Register as a buyer and we’ll get in touch about homes around {gbp(budget)} as they come on the market.</p>
      </div>
      <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999 }} />
      <div className="mc-signup-grid">
        <div className="mc-field"><label htmlFor="bs-name">Name</label><input id="bs-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-invalid={state.field === 'name' || undefined} /></div>
        <div className="mc-field"><label htmlFor="bs-phone">Phone</label><input id="bs-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" aria-invalid={state.field === 'phone' || undefined} /></div>
        <div className="mc-field"><label htmlFor="bs-email">Email <span className="mc-hint">(optional)</span></label><input id="bs-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={state.field === 'email' || undefined} /></div>
        <div className="mc-field"><label htmlFor="bs-areas">Areas you like <span className="mc-hint">(optional)</span></label><input id="bs-areas" value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="e.g. Kenton, Preston Road" /></div>
      </div>
      {state.error ? <p className="vx-error" role="alert">{state.error}</p> : null}
      <button className="btn dark" type="submit" disabled={state.sending}>{state.sending ? 'Sending…' : 'Register as a buyer'}</button>
      <p className="mc-hint">We’ll only use your details to tell you about suitable homes.</p>
    </form>
  )
}
