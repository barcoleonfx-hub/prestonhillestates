'use client'

import { useState } from 'react'
import { gbp } from '@/lib/booklet'

type Fact = { label: string; value: string }
type Comp = { where: string; what: string; price: number }

/**
 * Everything OnTheMarket asks for, in one place, while the guide is still to do: the address to search, the home's
 * facts (energy certificate and Land Registry), its last sale and similar sales nearby, each with a copy button.
 */
export function OtmPrep({ home, facts, lastSale, comps, rent }: { home: string; facts: Fact[]; lastSale: { price: number; date: string } | null; comps: Comp[]; rent: boolean }) {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (k: string, v: string) => { navigator.clipboard?.writeText(v).then(() => { setCopied(k); setTimeout(() => setCopied(null), 1500) }).catch(() => {}) }
  const row = (k: string, v: string) => (
    <div className="otp-row" key={k}><dt>{k}</dt><dd>{v}</dd><button type="button" className="otp-copy" onClick={() => copy(k, v)} aria-label={`Copy ${k.toLowerCase()}`}>{copied === k ? 'Copied' : 'Copy'}</button></div>
  )
  const month = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  return (
    <section className="otp">
      <h3>Ready for OnTheMarket</h3>
      <p className="bk-help small">What the appraisal asks for, gathered by the agent. Check it against what they told us.</p>
      <dl>
        {home ? row('Address', home) : null}
        {facts.map((f) => row(f.label, f.value))}
        {lastSale ? row('Last sold', `${gbp(lastSale.price)} in ${month(lastSale.date)} (Land Registry)`) : null}
      </dl>
      {comps.length ? (
        <>
          <p className="otp-sub">Similar {rent ? 'lets' : 'sales'} nearby, to sense-check its figure</p>
          <ul className="otp-comps">{comps.map((c) => <li key={`${c.where}${c.price}`}><b>{gbp(c.price)}{rent ? ' pcm' : ''}</b> {c.where}<small>{c.what}</small></li>)}</ul>
        </>
      ) : null}
      <a className="btn btn-ghost btn-sm" href="https://www.onthemarket.com/" target="_blank" rel="noreferrer">Open OnTheMarket</a>
    </section>
  )
}
