'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { gbp, type BookletGuide } from '@/lib/booklet'
import { suggestPrice } from '@/lib/otm-guide'
import { removeGuide, saveGuide, uploadGuide } from '../../booklet-actions'

/** What staff can change: the guide price and the facts most worth checking. Kept as typed, for the live preview. */
export type GuideValues = { asking: string; low: string; high: string; type: string; beds: string; baths: string; sqft: string; tenure: string; councilBand: string }

export const guideValues = (g: BookletGuide): GuideValues => ({
  asking: g.asking ? String(g.asking) : '', low: g.low ? String(g.low) : '', high: g.high ? String(g.high) : '',
  type: g.data.type ?? '', beds: g.data.beds != null ? String(g.data.beds) : '', baths: g.data.baths != null ? String(g.data.baths) : '',
  sqft: g.data.sqft ? String(g.data.sqft) : '', tenure: g.data.tenure ?? '', councilBand: g.data.councilBand ?? '',
})

/** "£475,000", "475000", "475k" → 475000. */
export function money(s: string): number | null {
  const t = s.toLowerCase().replace(/[£,\s]/g, '').replace(/pcm$/, '')
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(t)
  if (!m) return null
  const n = Number(m[1]) * (m[2] === 'k' ? 1000 : m[2] === 'm' ? 1_000_000 : 1)
  return n > 0 ? Math.round(n) : null
}
const whole = (s: string) => (s.trim() === '' ? null : Number.isFinite(Number(s)) ? Math.round(Number(s)) : null)

/** The guide with what staff have typed so far, for the preview. */
export function withValues(g: BookletGuide, v: GuideValues): BookletGuide {
  const sqft = whole(v.sqft)
  return {
    ...g, asking: money(v.asking), low: money(v.low), high: money(v.high),
    data: { ...g.data, type: v.type.trim() || null, beds: whole(v.beds), baths: whole(v.baths), sqft, sqm: sqft ? (sqft === g.data.sqft ? g.data.sqm : Math.round(sqft / 10.764)) : null, tenure: v.tenure.trim() || null, councilBand: v.councilBand.trim().toUpperCase() || null },
  }
}

const TYPES = ['Terraced House', 'End of Terrace House', 'Semi-Detached House', 'Detached House', 'Flat-Maisonette House', 'Bungalow']
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })

/**
 * Step one of every report: upload the OnTheMarket Market Appraisal Guide, check what it says, set the guide price
 * and finalise. Until then the report isn't sent by email or WhatsApp.
 */
export function GuideBox({ id, guide, values, setValues, rent, prices }: {
  id: string; guide: BookletGuide | null; values: GuideValues | null; setValues: (v: GuideValues) => void; rent: boolean; prices: number[]
}) {
  const router = useRouter()
  const file = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [pending, go] = useTransition()

  const upload = () => go(async () => {
    setErr(null); setNote(null)
    const f = file.current?.files?.[0]
    if (!f) { setErr('Choose the PDF first.'); return }
    const fd = new FormData()
    fd.set('file', f)
    const r = await uploadGuide(id, fd).catch(() => ({ ok: false, error: 'The upload didn’t go through. Try again.' } as { ok: boolean; error?: string; gaps?: string[] }))
    if (!r.ok) { setErr(r.error ?? 'Couldn’t read that file.'); return }
    setNote(r.gaps?.length ? `Read. It didn’t give the ${r.gaps.join(', ')}: fill ${r.gaps.length === 1 ? 'it' : 'them'} in below.` : 'Read. Check the facts below, then set the guide price.')
    if (file.current) file.current.value = ''
    router.refresh()
  })

  const picker = (label: string) => (
    <div className="bk-file">
      <input ref={file} type="file" accept="application/pdf,.pdf" aria-label="OnTheMarket Market Appraisal Guide (PDF)" disabled={pending} />
      <button type="button" className="btn btn-gold btn-sm" style={{ marginTop: 8 }} onClick={upload} disabled={pending}>{pending ? 'Reading it…' : label}</button>
    </div>
  )

  if (!guide || !values) {
    return (
      <section className="bk-guide">
        <div className="bk-gstate">Required before sending</div>
        <h2>OnTheMarket guide</h2>
        <p className="bk-help">On OnTheMarket, find this home and download its <b>Market Appraisal Guide</b> (the PDF). Upload it here: its official facts add two pages, “{rent ? 'Your property' : 'Your home'}, in detail” and “Our valuation”, and pick like-for-like comparables.</p>
        <p className="bk-help small bk-warn">Until it’s uploaded and the report is finalised, the report link isn’t put in emails or WhatsApp messages.</p>
        {picker('Upload and read it')}
        {err ? <p className="bk-err">{err}</p> : null}
      </section>
    )
  }

  const v = values
  const set = (k: keyof GuideValues, x: string) => { setValues({ ...v, [k]: x }); setErr(null); setNote(null) }
  const s = suggestPrice(prices, rent)
  const final = !!guide.finalisedAt
  const g = guide.data
  const save = (opts: { finalise?: boolean; reopen?: boolean } = {}) => go(async () => {
    setErr(null); setNote(null)
    const r = await saveGuide(id, {
      fixes: { type: v.type, beds: whole(v.beds), baths: whole(v.baths), sqft: whole(v.sqft), tenure: v.tenure, councilBand: v.councilBand },
      asking: money(v.asking), low: money(v.low), high: money(v.high), rent, ...opts,
    }).catch(() => ({ ok: false, error: 'Couldn’t save. Try again.' } as { ok: boolean; error?: string; letter?: string }))
    if (!r.ok) { setErr(r.error ?? 'Couldn’t save.'); return }
    setNote(opts.finalise ? `Finalised. The report link now goes in the property report email and WhatsApp messages. ${'letter' in r && r.letter ? r.letter : ''}` : opts.reopen ? 'Not finalised: it won’t be sent until you finalise it again.' : 'Saved.')
    router.refresh()
  })
  const remove = () => { if (!confirm('Remove the OnTheMarket guide from this report? The two pages from it go, and the report can’t be sent until a guide is uploaded again.')) return; go(async () => { await removeGuide(id); router.refresh() }) }
  const unit = rent ? ' pcm' : ''

  return (
    <section className={`bk-guide${final ? ' done' : ''}`}>
      <div className="bk-gstate">{final ? `✓ Finalised ${when(guide.finalisedAt!)} · ready to send` : 'Not finalised yet'}</div>
      <h2>OnTheMarket guide <small>{guide.fileName.length > 28 ? `${guide.fileName.slice(0, 26)}…` : guide.fileName}</small></h2>
      {guide.mismatch ? <p className="bk-help small bk-warn">{guide.mismatch}</p> : null}
      {guide.stale ? <p className="bk-help small bk-warn"><b>This guide was made on {new Date(`${guide.madeOn}T12:00:00Z`).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' })}, over 3 months ago.</b> Download a new one from OnTheMarket and upload it below (“Wrong guide, or need to change it?”), so the report and the letters use today’s figures.</p> : null}
      <dl>
        {g.address ? <><dt>For</dt><dd>{g.address}</dd></> : null}
        {g.made ? <><dt>Made</dt><dd>{new Date(`${g.made}T12:00:00Z`).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' })}</dd></> : null}
        <dt>EPC</dt><dd>{g.epc?.current ? `${g.epc.current.band} (${g.epc.current.score})${g.epc.potential ? `, could be ${g.epc.potential.band}` : ''}${g.epc.validUntil ? ` · until ${g.epc.validUntil.split('-').reverse().join('/')}` : ''}` : 'Not found'}</dd>
        <dt>Street sales</dt><dd>{g.street.reduce((t, h) => t + h.sales.length, 0)} since 1995</dd>
      </dl>
      {guide.gaps.length ? <p className="bk-help small bk-warn">The guide didn’t give the {guide.gaps.join(', ')}. Fill {guide.gaps.length === 1 ? 'it' : 'them'} in if you know.</p> : null}

      <div className="field"><label htmlFor="g-type">Property type</label>
        <input id="g-type" className="input" list="g-types" value={v.type} onChange={(e) => set('type', e.target.value)} />
        <datalist id="g-types">{TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      </div>
      <div className="bk-grid3">
        <div className="field"><label htmlFor="g-beds">Bedrooms</label><input id="g-beds" className="input" inputMode="numeric" value={v.beds} onChange={(e) => set('beds', e.target.value)} /></div>
        <div className="field"><label htmlFor="g-baths">Bathrooms</label><input id="g-baths" className="input" inputMode="numeric" value={v.baths} onChange={(e) => set('baths', e.target.value)} /></div>
        <div className="field"><label htmlFor="g-sqft">Sq ft</label><input id="g-sqft" className="input" inputMode="numeric" value={v.sqft} onChange={(e) => set('sqft', e.target.value)} /></div>
      </div>
      <div className="bk-grid">
        <div className="field"><label htmlFor="g-ten">Tenure</label><input id="g-ten" className="input" list="g-tens" value={v.tenure} onChange={(e) => set('tenure', e.target.value)} /><datalist id="g-tens"><option value="Freehold" /><option value="Leasehold" /><option value="Share of freehold" /></datalist></div>
        <div className="field"><label htmlFor="g-band">Council tax band</label><input id="g-band" className="input" maxLength={2} value={v.councilBand} onChange={(e) => set('councilBand', e.target.value)} /></div>
      </div>

      <h2 style={{ marginTop: 14 }}>{rent ? 'Guide rent' : 'Guide price'} <small>confirmed at the visit</small></h2>
      <div className="field"><label htmlFor="g-ask">{rent ? 'Our guide rent (pcm)' : 'Our guide asking price'}</label><input id="g-ask" className="input" inputMode="numeric" value={v.asking} onChange={(e) => set('asking', e.target.value)} placeholder={rent ? 'e.g. 1950' : 'e.g. 475,000'} /></div>
      <div className="bk-grid">
        <div className="field"><label htmlFor="g-low">Expected from</label><input id="g-low" className="input" inputMode="numeric" value={v.low} onChange={(e) => set('low', e.target.value)} /></div>
        <div className="field"><label htmlFor="g-high">to</label><input id="g-high" className="input" inputMode="numeric" value={v.high} onChange={(e) => set('high', e.target.value)} /></div>
      </div>
      {s ? (
        <p className="bk-hint">From the {prices.length} {rent ? 'rents' : 'sales'} shown on the report: {gbp(s.asking)}{unit} ({gbp(s.low)} to {gbp(s.high)}{unit}).{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValues({ ...v, asking: String(s.asking), low: String(s.low), high: String(s.high) })}>Use these</button>
        </p>
      ) : <p className="bk-hint">Fewer than three {rent ? 'rents' : 'sales'} to work from: set the figures from your own knowledge.</p>}
      <p className="bk-hint">The report shows this as a guide, and says the final {rent ? 'rent' : 'price'} is confirmed at the visit.</p>

      <div className="bk-actions" style={{ marginTop: 10 }}>
        {final ? <button type="button" className="btn btn-gold" onClick={() => save()} disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button>
          : <button type="button" className="btn btn-gold" onClick={() => save({ finalise: true })} disabled={pending}>{pending ? 'Saving…' : 'Finalise the report'}</button>}
        {!final ? <button type="button" className="btn btn-ghost" onClick={() => save()} disabled={pending}>Save for now</button> : null}
      </div>
      {err ? <p className="bk-err">{err}</p> : null}
      {note ? <p className="bk-msg">{note}</p> : null}
      <details style={{ marginTop: 10 }}>
        <summary className="bk-hint" style={{ cursor: 'pointer' }}>Wrong guide, or need to change it?</summary>
        {picker('Upload a new guide')}
        <p className="bk-hint">A new guide replaces this one, and the report needs finalising again.</p>
        <div className="bk-actions" style={{ marginTop: 6 }}>
          {final ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => save({ reopen: true })} disabled={pending}>Mark as not finalised</button> : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={remove} disabled={pending}>Remove the guide</button>
        </div>
      </details>
    </section>
  )
}
