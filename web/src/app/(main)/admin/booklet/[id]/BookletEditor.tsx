'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { changes, gbp, merge, type BookletFields, type BookletInput } from '@/lib/booklet'
import { saveBooklet } from '../../booklet-actions'
import { BookletPages } from './BookletPages'

/** Change anything on the booklet, see it update, save it, and print it (or save it as a PDF). */
export function BookletEditor({ data, back }: { data: BookletInput; back: { href: string; label: string } }) {
  const router = useRouter()
  const start = useMemo(() => merge(data.defaults, data.saved), [data])
  const [f, setF] = useState<BookletFields>(start)
  const [savedAs, setSavedAs] = useState(JSON.stringify(changes(data.defaults, start)))
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, go] = useTransition()
  const diff = changes(data.defaults, f)
  const dirty = JSON.stringify(diff) !== savedAs
  const rent = f.kind === 'lettings'
  const set = <K extends keyof BookletFields>(k: K, v: BookletFields[K]) => { setF((x) => ({ ...x, [k]: v })); setMsg(null) }

  const save = (next = f, then?: () => void) => go(async () => {
    const d = changes(data.defaults, next)
    const r = await saveBooklet(data.id, d)
    if (!r.ok) { setMsg(r.error ?? 'Couldn’t save.'); return }
    setSavedAs(JSON.stringify(d)); setMsg('Saved.')
    then?.()
  })
  // Sales or lettings changes the evidence and the pages, so it's saved and the booklet is filled in again.
  const switchKind = (kind: BookletFields['kind']) => { const next = { ...f, kind }; setF(next); save(next, () => router.refresh()) }
  const toggle = (key: string) => set('hide', f.hide.includes(key) ? f.hide.filter((k) => k !== key) : [...f.hide, key])
  const printIt = () => (dirty ? save(f, () => setTimeout(() => window.print(), 50)) : window.print())
  const reset = () => { if (!confirm('Go back to the filled-in version? Your changes to this booklet will be lost.')) return; const next = { ...data.defaults }; setF(next); save(next) }

  const evidence = data.comps.filter((c) => c.group === 'evidence')
  const market = data.comps.filter((c) => c.group === 'market')
  const shown = (g: 'evidence' | 'market') => data.comps.filter((c) => c.group === g && !f.hide.includes(c.key)).length

  return (
    <div className="bk-shell">
      <aside className="bk-tools">
        <p className="bk-return"><Link href={back.href}>← {back.label}</Link></p>
        <h1>Valuation booklet</h1>
        <p className="bk-help">Filled in for you. Change anything, then print it or save it as a PDF to take to the visit.</p>
        <div className="bk-actions">
          <button className="btn btn-gold" type="button" onClick={printIt} disabled={pending}>Print or save as PDF</button>
          <button className="btn btn-ghost" type="button" onClick={() => save()} disabled={pending || !dirty}>{pending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>
        </div>
        {msg ? <p className="bk-msg">{msg}</p> : null}
        <p className="bk-help small">When printing, choose A4, and turn on “Background graphics”.</p>

        <div className="bk-kinds" role="group" aria-label="Sales or lettings">
          <button type="button" className={`ew-chip${!rent ? ' on' : ''}`} onClick={() => switchKind('sales')} disabled={pending}>Selling</button>
          <button type="button" className={`ew-chip${rent ? ' on' : ''}`} onClick={() => switchKind('lettings')} disabled={pending}>Letting</button>
        </div>

        <div className="field"><label htmlFor="bk-for">Prepared for</label><input id="bk-for" className="input" value={f.forName} onChange={(e) => set('forName', e.target.value)} placeholder="e.g. Mr and Mrs Patel" /></div>
        <div className="field"><label htmlFor="bk-home">{rent ? 'Their property' : 'Their home'}</label><input id="bk-home" className="input" value={f.home} onChange={(e) => set('home', e.target.value)} placeholder="e.g. 12 Carlton Avenue East, HA9 8PT (3-bed semi)" /></div>
        <div className="field"><label htmlFor="bk-visit">Visit</label><input id="bk-visit" className="input" value={f.visit} onChange={(e) => set('visit', e.target.value)} placeholder="e.g. Saturday 15 November at 11:00 · Jamil Ahmed" />{!data.defaults.visit ? <small className="bk-hint">No valuation booked in the diary yet: book it and this fills itself in.</small> : null}</div>
        <div className="field"><label htmlFor="bk-greet">Letter starts</label><input id="bk-greet" className="input" value={f.greeting} onChange={(e) => set('greeting', e.target.value)} /></div>
        <div className="field"><label htmlFor="bk-letter">Letter from Jamil (page 2)</label><textarea id="bk-letter" className="input" rows={10} value={f.letter} onChange={(e) => set('letter', e.target.value)} /></div>
        <div className="field"><label htmlFor="bk-fig">{rent ? 'Expected rent' : 'Our valuation'}</label><input id="bk-fig" className="input" value={f.figure} onChange={(e) => set('figure', e.target.value)} placeholder="Leave blank to write it in at the visit" /></div>
        <div className="field"><label htmlFor="bk-ask">{rent ? 'Suggested asking rent' : 'Suggested asking price'}</label><input id="bk-ask" className="input" value={f.asking} onChange={(e) => set('asking', e.target.value)} placeholder="Leave blank to write it in at the visit" /></div>
        <div className="field"><label htmlFor="bk-fee">Our fee (page 7)</label><input id="bk-fee" className="input" value={f.fee} onChange={(e) => set('fee', e.target.value)} placeholder="Leave blank to write it in at the visit" /></div>

        <div className="bk-comps">
          <h2>What {rent ? 'tenants' : 'buyers'} will love <small>page 4</small></h2>
          {data.area.places.length ? data.area.places.map((p) => (
            <label key={p.key} className="bk-comp"><input type="checkbox" checked={!f.hide.includes(p.key)} onChange={() => toggle(p.key)} /><span><b>{p.name}</b><small>{p.detail} · about {p.minutes} min walk</small></span></label>
          )) : <p className="bk-hint">{data.area.error ? `Couldn’t find places nearby just now (${data.area.error}).` : 'No places found nearby.'} This page shows the home’s key facts only.</p>}
          {data.area.pending ? <p className="bk-msg">Still looking up schools, shops and parks near this postcode. <button type="button" className="btn btn-ghost btn-sm" onClick={() => router.refresh()}>Check again</button> in a minute (it’s only slow the first time).</p>
            : data.area.source === 'stations only' && data.area.places.length ? <p className="bk-hint">Only stations are shown: OpenStreetMap didn’t answer ({data.area.error}). It’s tried again within the hour.</p> : null}

          <h2>{rent ? 'Your property’s story' : 'Your home’s story'} <small>page 5</small></h2>
          <label className="bk-comp"><input type="checkbox" checked={f.showPaid} onChange={() => set('showPaid', !f.showPaid)} /><span><b>Show what it sold for</b><small>{data.story.sales.length ? `${data.story.sales.length} sale${data.story.sales.length === 1 ? '' : 's'} on record since 1995. Untick if the owner would rather not see the prices.` : 'No past sales found for this address.'}</small></span></label>
          <div className="field"><label htmlFor="bk-story">Add to the timeline <span className="bk-hint" style={{ display: 'inline' }}>(one per line)</span></label><textarea id="bk-story" className="input" rows={4} value={f.story} onChange={(e) => set('story', e.target.value)} placeholder={'2015: Rear extension approved\n2021: New kitchen and boiler'} /></div>
          {data.story.council?.planningUrl ? <p className="bk-hint"><a href={data.story.council.planningUrl} target="_blank" rel="noreferrer">Check planning history ({data.story.council.name} Council)</a>: search for the address, then add anything useful above.</p> : null}
          {!data.story.epcKey ? <p className="bk-hint">Floor area, energy rating and when it was built appear once an EPC key is added (free, from the EPC register).</p> : null}
          {data.story.errors.filter((e) => !/no EPC key/.test(e)).map((e) => <p key={e} className="bk-hint">{e}</p>)}

          <h2>{rent ? 'Rents nearby' : 'Sold nearby'} <small>{shown('evidence')} shown, up to 6</small></h2>
          {evidence.length ? evidence.map((c) => (
            <label key={c.key} className="bk-comp"><input type="checkbox" checked={!f.hide.includes(c.key)} onChange={() => toggle(c.key)} /><span><b>{gbp(c.price)}{c.rent ? ' pcm' : ''}</b> {c.where}<small>{c.what} · {c.source}</small></span></label>
          )) : <p className="bk-hint">{data.defaults.home ? `Nothing found nearby${rent ? '' : ' in HM Land Registry'} for this postcode.` : 'No postcode on this enquiry, so nothing to compare yet.'}</p>}
          <h2>On the market now <small>{shown('market')} shown, up to 4</small></h2>
          {market.length ? market.map((c) => (
            <label key={c.key} className="bk-comp"><input type="checkbox" checked={!f.hide.includes(c.key)} onChange={() => toggle(c.key)} /><span><b>{gbp(c.price)}{c.rent ? ' pcm' : ''}</b> {c.where}<small>{c.what} · {c.source}</small></span></label>
          )) : <p className="bk-hint">{data.otm?.error ? `OnTheMarket couldn’t be read just now (${data.otm.error}). This section is left out.` : 'Nothing from OnTheMarket yet. This section is left out.'}{data.otm ? <> <a href={data.otm.url} target="_blank" rel="noreferrer">Open the search</a></> : null}</p>}
          <p className="bk-hint">Comparables you add in the valuation check on the enquiry appear here too.</p>
        </div>

        <button className="btn btn-ghost btn-sm" type="button" onClick={reset} disabled={pending}>Go back to the filled-in version</button>
      </aside>

      <main className="bk-stage">
        <BookletPages data={data} f={f} />
      </main>
    </div>
  )
}
