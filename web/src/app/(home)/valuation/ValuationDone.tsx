'use client'
import { useEffect, useState, type RefObject } from 'react'

export type Estimate = { kind: 'sale' | 'rent'; low: number; high: number; basis: string; onMarket: { address: string; price: string; beds: number | null; url: string }[] }
export type DoneData = {
  first: string; address: string; postcode: string; time: string; intent: 'selling' | 'letting'; estimate: Estimate | null
  /** What to ask for the instant estimate if it didn't come back with the request. */
  ask: { postcode: string; intent: string; propertyType: string; bedrooms: string; address: string }
}

const KEY = 'phe_valuation_done'
/** Keeps the result for the thank-you page (this tab only). False if the browser won't keep it. */
export function keepDone(d: DoneData): boolean {
  try { sessionStorage.setItem(KEY, JSON.stringify(d)); return sessionStorage.getItem(KEY) !== null } catch { return false }
}
function readDone(): DoneData | null {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') as DoneData | null } catch { return null }
}

/** "Thank you": the request is with the branch, their instant estimate, and what happens next. */
export function ValuationDone({ first, address, postcode, time, intent, estimate, estimating, cardRef }: {
  first: string; address: string; postcode: string; time: string; intent: 'selling' | 'letting'; estimate: Estimate | null; estimating: boolean; cardRef?: RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="vx-card vx-done" ref={cardRef} role="status">
      <div className="vx-tick" aria-hidden="true">✓</div>
      <h2>Thank you{first ? `, ${first}` : ''}.</h2>
      <p>{address ? `Your request for ${address}${postcode ? `, ${postcode}` : ''} is with the branch.` : 'Your request is with the branch.'}</p>
      {estimating && !estimate ? <div className="vx-estimate"><span className="vx-est-k">Working out your instant estimate…</span></div> : null}
      {estimate ? (
        <div className="vx-estimate">
          <span className="vx-est-k">{estimate.kind === 'rent' ? 'Your instant rent estimate' : 'Your instant estimate'}</span>
          <span className="vx-est-v">£{estimate.low.toLocaleString('en-GB')} – £{estimate.high.toLocaleString('en-GB')}{estimate.kind === 'rent' ? <small> a month</small> : null}</span>
          <span className="vx-est-b">Based on {estimate.basis}.</span>
          {estimate.onMarket.length ? (
            <div className="vx-est-mkt">
              <b>{estimate.kind === 'rent' ? 'Similar homes we’re letting nearby' : 'Similar homes we have for sale nearby'}</b>
              {estimate.onMarket.map((m) => <a key={m.url} href={m.url}><span>{m.address}{m.beds != null ? ` · ${m.beds === 0 ? 'studio' : `${m.beds} bed`}` : ''}</span><b>{m.price}</b></a>)}
            </div>
          ) : null}
          <span className="vx-est-fine">This price is an estimate only, based on public records. For a more accurate valuation we need to visit the property in person: size, condition, any extensions and the exact street can all make a difference.</span>
        </div>
      ) : null}
      <ol className="vx-next">
        <li><b>We’ll call you</b> within one working day{time && time !== 'Any time' ? `, in the ${time.toLowerCase()} if we can` : ''}, to arrange a time.</li>
        <li><b>We visit</b> and walk round the property with you.</li>
        <li><b>You get our figure</b> and an honest view of how we’d {intent === 'letting' ? 'let' : 'sell'} it. No obligation.</li>
      </ol>
      <p className="vx-fine">Can’t wait? Call the branch on <a href="tel:+442089049005">020 8904 9005</a>.</p>
    </div>
  )
}

/** The thank-you page's card: the result kept by the form, or a plain thank-you if there isn't one. */
export function ThankYouCard() {
  const [d, setD] = useState<DoneData | null | undefined>(undefined)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  useEffect(() => {
    const x = readDone()
    setD(x)
    setEstimate(x?.estimate ?? null)
    if (x && !x.estimate && x.ask?.postcode) {
      setEstimating(true)
      fetch('/api/public/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(x.ask) })
        .then((r) => (r.ok ? r.json() : null)).then((j: { estimate?: Estimate | null } | null) => setEstimate(j?.estimate ?? null))
        .catch(() => {}).finally(() => setEstimating(false))
    }
  }, [])
  if (d === undefined) return <div className="vx-card vx-done" aria-busy="true" />
  return <ValuationDone first={d?.first ?? ''} address={d?.address ?? ''} postcode={d?.postcode ?? ''} time={d?.time ?? ''} intent={d?.intent ?? 'selling'} estimate={estimate} estimating={estimating} />
}
