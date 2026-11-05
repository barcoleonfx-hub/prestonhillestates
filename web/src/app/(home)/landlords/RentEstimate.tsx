'use client'

import { useState } from 'react'

type Est = {
  ok: boolean; error?: string; postcode: string; beds: number; basis: 'nearby' | 'ons' | null; range: [number, number] | null
  ons: { name: string; month: string; figure: number; forBeds: boolean; url: string } | null
  nearby: { area: string; beds: number; rent: number; status: string; km: number }[]
}
const BEDS: [string, number][] = [['Studio', 0], ['1', 1], ['2', 2], ['3', 3], ['4', 4], ['5+', 5]]
const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
const bedWord = (b: number) => (b === 0 ? 'studio' : `${b}-bed`)

/** Postcode and bedrooms → a rent range from real evidence, then "get your exact figure" (a landlord lead). */
export function RentEstimate({ feePct }: { feePct: number }) {
  const [postcode, setPostcode] = useState('')
  const [beds, setBeds] = useState(2)
  const [est, setEst] = useState<Est | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [email, setEmail] = useState(''), [hp, setHp] = useState('')
  const [sent, setSent] = useState(false)

  async function look(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setBusy(true)
    const r = await fetch(`/api/public/rent-estimate?postcode=${encodeURIComponent(postcode)}&beds=${beds}`).then((x) => x.json()).catch(() => null) as Est | null
    setBusy(false)
    if (!r?.ok) return setError(r?.error ?? 'That didn’t work. Check the postcode and try again.')
    setEst(r)
  }
  async function send(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setBusy(true)
    const note = est?.range ? `Rent estimate on the website: ${gbp(est.range[0])} to ${gbp(est.range[1])} pcm for a ${bedWord(est.beds)}.` : `Asked for a rent figure for a ${bedWord(est?.beds ?? beds)}.`
    const r = await fetch('/api/public/valuation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim(), postcode: est?.postcode ?? postcode, intent: 'letting', bedrooms: beds === 0 ? 'Studio' : beds >= 5 ? '5+' : String(beds), notes: note, hp_check: hp }) }).then((x) => x.json()).catch(() => null) as { ok?: boolean; error?: string } | null
    setBusy(false)
    if (!r?.ok) return setError(r?.error ?? 'That didn’t send. Please call us on 020 8904 9005.')
    setSent(true)
  }

  const mid = est?.range ? (est.range[0] + est.range[1]) / 2 : null
  return (
    <div className="vx-card lx-est" id="estimate">
      {!est ? (
        <form onSubmit={look} noValidate>
          <h2>What rent could your property get?</h2>
          <p className="vx-hint">An instant range from homes we’ve let nearby and the official figures for your area. Then, if you like, an exact figure from us.</p>
          <div className="vx-field">
            <label htmlFor="lx-pc">Property postcode</label>
            <input id="lx-pc" value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="e.g. HA3 0PS" autoComplete="postal-code" style={{ textTransform: 'uppercase' }} aria-invalid={!!error || undefined} />
          </div>
          <div className="vx-field">
            <span className="vx-label">Bedrooms</span>
            <div className="vx-chips" role="radiogroup" aria-label="Bedrooms">
              {BEDS.map(([l, v]) => <label key={l} className="vx-chip"><input type="radio" name="beds" checked={beds === v} onChange={() => setBeds(v)} /><span>{l}</span></label>)}
            </div>
          </div>
          {error ? <p className="vx-error" role="alert">{error}</p> : null}
          <div className="vx-actions"><span /><button type="submit" className="btn gold" disabled={busy || !postcode.trim()}>{busy ? 'Looking…' : 'See my rent estimate'}</button></div>
        </form>
      ) : sent ? (
        <div className="vx-done">
          <h2>Thank you, {name.split(' ')[0] || 'we’ll be in touch'}.</h2>
          <p>We’ll call you within one working day to arrange a visit and give you an exact rent for your property, with the homes we based it on.</p>
          <p className="vx-fine">Can’t wait? Call the branch on <a href="tel:+442089049005">020 8904 9005</a>.</p>
        </div>
      ) : (
        <div>
          <button type="button" className="vx-linkish" onClick={() => { setEst(null); setError('') }}>← {est.postcode} · {bedWord(est.beds)}</button>
          {est.range ? (
            <>
              <p className="lx-range"><b>{gbp(est.range[0])} – {gbp(est.range[1])}</b> <span>per month</span></p>
              <p className="vx-hint">{est.basis === 'nearby' ? `Based on ${est.nearby.filter((n) => n.beds === est.beds).length} homes of this size we’ve let or are letting within 2 km.` : `Based on the official average for ${bedWord(est.beds)} homes in ${est.ons!.name} (ONS, ${est.ons!.month}).`} The exact figure depends on condition, layout, outside space and the street.</p>
              {mid ? <p className="lx-fee">At {gbp(mid)} a month, our fully managed service would be <b>{gbp((mid * feePct) / 100)} a month</b> including VAT, with the rent guarantee and maintenance included.</p> : null}
            </>
          ) : (
            <>
              <p className="lx-range small"><b>We’d need to see it</b></p>
              <p className="vx-hint">{est.ons ? `The average rent across ${est.ons.name} is ${gbp(est.ons.figure)} a month (ONS, ${est.ons.month}), but homes vary a lot from street to street.` : 'We don’t have enough lettings near this postcode to give a fair range online.'} Leave your details and we’ll give you a proper figure.</p>
            </>
          )}
          {est.nearby.length ? (
            <div className="lx-near">
              <span className="vx-label">Homes we’ve let or are letting nearby</span>
              <ul>{est.nearby.map((n, i) => <li key={i}><span>{n.area} · {bedWord(n.beds)}</span><b>{gbp(n.rent)} pcm</b></li>)}</ul>
            </div>
          ) : null}
          {est.ons ? <p className="vx-fine">Official figure: <a href={est.ons.url} target="_blank" rel="noopener noreferrer">ONS private rents for {est.ons.name}</a>, {est.ons.month}.</p> : null}
          <form onSubmit={send} noValidate className="lx-lead">
            <input type="text" name="hp_check" value={hp} onChange={(e) => setHp(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999 }} />
            <h3>Get your exact figure</h3>
            <div className="vx-row">
              <div className="vx-field"><label htmlFor="lx-name">Your name</label><input id="lx-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
              <div className="vx-field"><label htmlFor="lx-phone">Phone number</label><input id="lx-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></div>
            </div>
            <div className="vx-field"><label htmlFor="lx-email">Email <span className="vx-opt">(optional)</span></label><input id="lx-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
            {error ? <p className="vx-error" role="alert">{error}</p> : null}
            <div className="vx-actions"><span className="vx-fine">Free, no obligation. A call back within one working day.</span><button type="submit" className="btn gold" disabled={busy}>{busy ? 'Sending…' : 'Get my rental valuation'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
