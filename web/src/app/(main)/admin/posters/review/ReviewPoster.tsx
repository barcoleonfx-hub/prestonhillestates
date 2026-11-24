'use client'

import { useEffect, useRef, useState } from 'react'
import { LogoMark } from '@/components/Logo'
import type { ScanStats } from '@/lib/qr-links'
import { saveReviewLink } from './actions'

const W = 794, H = 1123 // A4 portrait at 96 per inch; A3 is the same, scaled up by √2
const SIZE = { a4: { w: 210, h: 297, label: 'A4' }, a3: { w: 297, h: 420, label: 'A3' } } as const
const BORDER = 30.24 // 8 mm at 96 per inch

type Quote = { text: string; name: string; date: string | null }

/** The review poster, with A4 / A3 and the office-printer border, as a PDF or straight to the printer. */
export function ReviewPoster({ qr, link, stats, rating, target, quotes }: {
  qr: string; link: string; stats: ScanStats; rating: { rating: number; count: number } | null
  target: { url: string; set: boolean; from: 'poster' | 'settings' | 'search' }; quotes: Quote[]
}) {
  const [paper, setPaper] = useState<'a4' | 'a3'>('a4')
  const [margin, setMargin] = useState<'office' | 'none'>('office')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLElement>(null)
  const [fit, setFit] = useState(1)
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setFit(Math.min(1, (el.clientWidth - 56) / W, (window.innerHeight - 48) / H))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const size = SIZE[paper]
  const inner = margin === 'office' ? Math.min((W - 2 * BORDER) / W, (H - 2 * BORDER) / H) : 1

  async function pdf() {
    if (!page.current) return
    setBusy(true); setMsg(null)
    try {
      const [{ toJpeg }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')])
      await document.fonts.ready
      const data = await toJpeg(page.current, { pixelRatio: paper === 'a3' ? 4 : 3, quality: 0.93, backgroundColor: '#ffffff', width: W, height: H, style: { transform: 'none' } })
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: paper, compress: true })
      doc.addImage(data, 'JPEG', 0, 0, size.w, size.h, undefined, 'FAST')
      doc.save(`Review poster ${size.label}.pdf`)
      setMsg({ ok: true, text: `Downloaded. Print it at 100% (“actual size”) on ${size.label} paper.` })
    } catch (e) {
      console.error(e)
      setMsg({ ok: false, text: 'The PDF couldn’t be made in this browser. Use Print instead and choose “Save as PDF”.' })
    }
    setBusy(false)
  }

  return (
    <div className="wc-page">
      <style>{`@page { size: ${size.label} portrait; margin: 0; } @media print { html, body { margin: 0 !important; padding: 0 !important; height: ${size.h}mm !important; overflow: hidden !important; } .wc-page, .wc-stage { height: ${size.h}mm !important; overflow: hidden !important; } .pf-zoom { zoom: ${(size.w / 210).toFixed(4)}; } }`}</style>
      <aside className="wc-panel">
        <div>
          <a href="/admin/window-cards" className="wc-hint">← Window display sheets</a>
          <h1 style={{ marginTop: 6 }}>Review poster</h1>
          <p className="sub">For the office: clients scan the code and go straight to our Google review form. Put it by the desk and point to it when someone thanks you.</p>
        </div>
        <div className="wc-actions">
          <button type="button" className="btn btn-gold" onClick={pdf} disabled={busy}>{busy ? 'Making the PDF…' : `Download ${size.label} PDF`}</button>
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>Print on {size.label}</button>
          {msg ? <p className="wc-hint" style={{ color: msg.ok ? '#2F6B4E' : '#A8442E' }}>{msg.text}</p> : null}
        </div>
        <div>
          <h2>Where the code goes</h2>
          {target.set ? <p className="wc-hint">Our Google review form: <b>{target.url.replace(/^https:\/\//, '')}</b></p>
            : <p className="wc-hint rp-warn">{target.from === 'settings' ? 'Our Google reviews page (people then tap “Write a review”).' : 'A Google search for our reviews.'} Better: paste our own “write a review” link below, so the code opens the review form directly.</p>}
          <form action={saveReviewLink} className="rp-link">
            <input className="input" name="url" type="url" defaultValue={target.set ? target.url : ''} placeholder="https://g.page/r/…/review" aria-label="Google review link" />
            <button className="btn btn-ghost btn-sm" type="submit">Save</button>
          </form>
          <p className="wc-hint" style={{ marginTop: 6 }}>Find it in Google Business Profile: open it, choose “Ask for reviews”, and copy the link. Printed posters keep working when you change it: the code always goes through {link.replace(/^https?:\/\//, '')}.</p>
        </div>
        <div>
          <h2>Paper</h2>
          <div className="pf-toggle">
            <button type="button" className={paper === 'a4' ? 'on' : undefined} onClick={() => setPaper('a4')}>A4</button>
            <button type="button" className={paper === 'a3' ? 'on' : undefined} onClick={() => setPaper('a3')}>A3</button>
          </div>
        </div>
        <div>
          <h2>Printing on</h2>
          <div className="pf-toggle">
            <button type="button" className={margin === 'office' ? 'on' : undefined} onClick={() => setMargin('office')}>Our printer</button>
            <button type="button" className={margin === 'none' ? 'on' : undefined} onClick={() => setMargin('none')}>Print shop</button>
          </div>
          <p className="wc-hint" style={{ marginTop: 6 }}>{margin === 'office' ? 'Keeps everything 8 mm in from the edge, because office printers can’t print right to the edge.' : 'Edge to edge, for printers that can print to the edge.'}</p>
        </div>
        <div>
          <h2>Scans</h2>
          <p className="pf-stat"><b>{stats.scans}</b> {stats.scans === 1 ? 'scan' : 'scans'}{stats.scans ? <> by about <b>{stats.people}</b> {stats.people === 1 ? 'person' : 'people'}</> : null} in the last 30 days{stats.today ? <>, <b>{stats.today}</b> today</> : null}.</p>
        </div>
      </aside>
      <main className="wc-stage" ref={stage}>
        <div className="pf-fit" style={{ width: W * fit, height: H * fit }}>
          <div className="pf-zoom" style={{ transform: `scale(${fit})`, transformOrigin: 'top left' }}>
            <div ref={page} className="wc-paper wc-shadow" style={{ width: W, height: H }}>
              <div style={{ transform: `scale(${inner})`, transformOrigin: 'center' }}>
                <Poster qr={qr} rating={rating} quotes={quotes} />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

const Star = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6L2.4 9.5l6.7-.8z" /></svg>

function Poster({ qr, rating, quotes }: { qr: string; rating: { rating: number; count: number } | null; quotes: Quote[] }) {
  return (
    <div className="rp">
      <div className="rp-glow" />
      <header className="rp-top">
        <LogoMark className="rp-mark" />
        <span><b>PRESTON HILL</b><i>ESTATES</i></span>
      </header>
      <p className="rp-kicker">Thank you for choosing us</p>
      <h1>Happy with <em>our service?</em></h1>
      <p className="rp-lead">We’d be so grateful for a Google review. It takes a minute, and it helps local families find an agent they can trust.</p>
      <div className="rp-card">
        <div className="rp-stars">{[0, 1, 2, 3, 4].map((i) => <Star key={i} />)}</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="" />
        <b>Scan to leave a review</b>
        <span>Point your phone camera at the code</span>
      </div>
      <div className="rp-steps">
        <div><i>1</i><b>Scan the code</b><span>with your phone camera</span></div>
        <div><i>2</i><b>Tap the stars</b><span>on our Google page</span></div>
        <div><i>3</i><b>Say a few words</b><span>about how we helped</span></div>
      </div>
      {quotes.length ? (
        <div className="rp-quotes">
          {quotes.map((q) => <figure key={q.name}><blockquote>“{q.text}”</blockquote><figcaption>{q.name}{q.date ? `, ${q.date}` : ''}</figcaption></figure>)}
        </div>
      ) : null}
      <footer className="rp-foot">
        {rating ? <p className="rp-rated"><span className="rp-mini">{[0, 1, 2, 3, 4].map((i) => <Star key={i} />)}</span> Rated <b>{rating.rating.toFixed(1)}</b> from <b>{rating.count}</b> reviews on Google</p> : null}
        <p>271 Preston Road, Harrow · Selling and letting homes since 2004</p>
      </footer>
    </div>
  )
}
