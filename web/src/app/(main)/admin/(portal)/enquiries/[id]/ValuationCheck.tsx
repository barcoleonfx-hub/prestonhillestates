'use client'

import { useActionState, useMemo, useState } from 'react'
import { SOURCES, figureText, suggested, type CheckComp, type SavedValuation } from '@/lib/valuation-check'
import { saveValuationCheck, type CheckState } from '../../../enquiry-email-actions'

type Lr = { low: number; mid: number; high: number; count: number; label: string; rows: { where: string; what: string; price: number }[] } | null
const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
const toMoney = (s: string) => { const t = s.toLowerCase().replace(/[£,\s]/g, ''); const n = parseFloat(t) * (t.endsWith('m') ? 1e6 : t.endsWith('k') ? 1e3 : 1); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0 }

/**
 * The valuation check: our estimate from real sales (or rents), the same search on the portals to open and look at,
 * the comparable homes staff note down, one suggested range from all of it, and the figure staff settle on.
 */
export function ValuationCheck({ id, rent, lr, links, saved, home }: {
  id: string; rent: boolean; lr: Lr; links: { label: string; href: string }[]; saved: SavedValuation | null; home: string | null
}) {
  const [comps, setComps] = useState<CheckComp[]>(saved?.comps ?? [])
  const [draft, setDraft] = useState({ source: 'Rightmove', kind: (rent ? 'rent' : 'sold') as CheckComp['kind'], price: '', address: '', beds: '', link: '' })
  const [low, setLow] = useState(saved?.low ? String(saved.low) : '')
  const [high, setHigh] = useState(saved?.high ? String(saved.high) : '')
  const [note, setNote] = useState(saved?.note ?? '')
  const [state, save, pending] = useActionState<CheckState, FormData>(saveValuationCheck, {})
  const sug = useMemo(() => suggested(lr ? { mid: lr.mid, count: lr.count } : null, comps, rent), [lr, comps, rent])
  const add = () => {
    const price = toMoney(draft.price)
    if (!price) return
    setComps((c) => [...c, { source: draft.source, kind: draft.kind, price, address: draft.address.trim(), beds: Number(draft.beds) || null, link: /^https:\/\//.test(draft.link.trim()) ? draft.link.trim() : null }])
    setDraft((d) => ({ ...d, price: '', address: '', beds: '', link: '' }))
  }
  const kinds: [CheckComp['kind'], string][] = rent ? [['rent', 'Let for'], ['asking', 'Asking rent']] : [['sold', 'Sold for'], ['asking', 'Asking price']]

  return (
    <div className="vc">
      <div className="vc-step">
        <div className="vc-n">1</div>
        <div className="vc-body">
          <h3>{rent ? 'Our rent estimate' : 'From HM Land Registry'}</h3>
          {lr ? (
            <>
              <p className="vc-range">{gbp(lr.low)} – {gbp(lr.high)}{rent ? ' a month' : ''} <small>typical {gbp(lr.mid)} · {lr.label}</small></p>
              {lr.rows.length ? (
                <ul className="vc-list">
                  {lr.rows.slice(0, 6).map((r, i) => <li key={i}><span>{r.where}<small>{r.what}</small></span><b>{gbp(r.price)}</b></li>)}
                </ul>
              ) : null}
              <p className="vc-hint">{rent ? 'From homes we’ve let nearby, or the official figures for the borough.' : `Land Registry doesn’t record bedrooms or size${home ? '' : ', and we don’t know the type of home yet'}, so check this against the portals.`}</p>
            </>
          ) : <p className="vc-hint">Not enough {rent ? 'lets' : 'sales'} near this postcode to work one out{home ? '' : ', or we don’t have the postcode'}. Use the portals below.</p>}
        </div>
      </div>

      <div className="vc-step">
        <div className="vc-n">2</div>
        <div className="vc-body">
          <h3>Check the portals</h3>
          <p className="vc-hint">These open the same search on each site in a new tab. Note down the closest matches below.</p>
          <div className="vc-links">{links.map((l) => <a key={l.href} className="btn btn-ghost btn-sm" href={l.href} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}</div>
        </div>
      </div>

      <div className="vc-step">
        <div className="vc-n">3</div>
        <div className="vc-body">
          <h3>Similar homes you found</h3>
          {comps.length ? (
            <ul className="vc-list vc-comps">
              {comps.map((c, i) => (
                <li key={i}>
                  <span>{c.address || 'A similar home'}{c.beds ? `, ${c.beds} bed` : ''}<small>{c.source} · {kinds.find(([k]) => k === c.kind)?.[1] ?? c.kind}{c.link ? <> · <a href={c.link} target="_blank" rel="noopener noreferrer">open</a></> : null}</small></span>
                  <b>{gbp(c.price)}</b>
                  <button type="button" className="vc-x" aria-label="Remove" onClick={() => setComps((x) => x.filter((_, j) => j !== i))}>×</button>
                </li>
              ))}
            </ul>
          ) : <p className="vc-hint">None yet.</p>}
          <div className="vc-add">
            <select className="select" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} aria-label="Where">{SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
            <select className="select" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as CheckComp['kind'] })} aria-label="Price is">{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input className="input" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder={rent ? '£ a month' : '£ e.g. 565k'} aria-label="Price" />
            <input className="input" value={draft.beds} onChange={(e) => setDraft({ ...draft, beds: e.target.value })} placeholder="Beds" aria-label="Bedrooms" inputMode="numeric" />
            <input className="input vc-wide" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Address or street" aria-label="Address" />
            <input className="input vc-wide" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} placeholder="Link to the listing (optional)" aria-label="Link" />
            <button type="button" className="btn btn-dark btn-sm" onClick={add} disabled={!toMoney(draft.price)}>Add</button>
          </div>
        </div>
      </div>

      <div className="vc-step">
        <div className="vc-n">4</div>
        <div className="vc-body">
          <h3>Your valuation</h3>
          {sug ? (
            <p className="vc-sug">Everything together suggests <b>{figureText(sug.low, sug.high, rent)}</b> <small>from {sug.basis}</small>{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLow(String(sug.low)); setHigh(String(sug.high)) }}>Use this</button></p>
          ) : null}
          <form action={save} className="vc-final">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="rent" value={rent ? '1' : '0'} />
            <input type="hidden" name="comps" value={JSON.stringify(comps)} />
            <div className="vc-fig">
              <input className="input" name="low" value={low} onChange={(e) => setLow(e.target.value)} placeholder={rent ? 'From £ a month' : 'From £'} aria-label="From" />
              <span>to</span>
              <input className="input" name="high" value={high} onChange={(e) => setHigh(e.target.value)} placeholder="To £ (optional)" aria-label="To" />
            </div>
            <textarea className="input" name="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notes for the office (not sent), e.g. needs a new kitchen, extended at the back" />
            {state.error ? <div className="notice err">{state.error}</div> : null}
            {state.ok ? <div className="notice ok">Saved. Now send them the “{rent ? 'Your rental valuation' : 'Your valuation'}” email: <a href="?tpl=result#email">open it</a>.</div> : null}
            <div className="actions"><button className="btn btn-gold" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save the valuation'}</button></div>
            {saved?.savedAt && !state.ok ? <p className="vc-hint">Last saved {new Date(saved.savedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}{saved.savedBy ? ` by ${saved.savedBy}` : ''}.</p> : null}
          </form>
        </div>
      </div>
    </div>
  )
}
