'use client'

import { useEffect, useRef, useState } from 'react'
import { LogoMark } from '@/components/Logo'
import { themeVars } from '@/lib/window-card'

const W = 1123, H = 794 // A4 landscape at 96 per inch; A3 is the same, scaled up by √2
const SIZE = { a4: { w: 297, h: 210, label: 'A4' }, a3: { w: 420, h: 297, label: 'A3' } } as const
const BORDER = 30.24 // 8 mm at 96 per inch

/** The poster, with A4 / A3 and the office-printer border, as a PDF or straight to the printer. */
export function PosterEditor({ qr }: { qr: string }) {
  const [paper, setPaper] = useState<'a4' | 'a3'>('a3')
  const [margin, setMargin] = useState<'office' | 'none'>('office')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLElement>(null)
  // On screen the poster shrinks to fit beside the panel; printing and the PDF use it full size.
  const [fit, setFit] = useState(1)
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setFit(Math.min(1, (el.clientWidth - 56) / W))
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
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: paper, compress: true })
      doc.addImage(data, 'JPEG', 0, 0, size.w, size.h, undefined, 'FAST')
      doc.save(`Black Friday poster ${size.label} landscape.pdf`)
      setMsg({ ok: true, text: `Downloaded. Print it at 100% (“actual size”) on ${size.label} paper.` })
    } catch (e) {
      console.error(e)
      setMsg({ ok: false, text: 'The PDF couldn’t be made in this browser. Use Print instead and choose “Save as PDF”.' })
    }
    setBusy(false)
  }

  return (
    <div className="wc-page">
      <style>{`@page { size: ${size.label} landscape; margin: 0; } @media print { html, body { margin: 0 !important; padding: 0 !important; height: ${size.h}mm !important; overflow: hidden !important; } .wc-page, .wc-stage { height: ${size.h}mm !important; overflow: hidden !important; } .pf-zoom { zoom: ${(size.w / 297).toFixed(4)}; } }`}</style>
      <aside className="wc-panel">
        <div>
          <a href="/admin/window-cards" className="wc-hint">← Window display sheets</a>
          <h1 style={{ marginTop: 6 }}>Black Friday poster</h1>
          <p className="sub">£500 for introducing a landlord, until 31 December 2026. The code opens WhatsApp to our office number with the details we need already laid out, so people can introduce someone from the pavement, even when we’re closed.</p>
        </div>
        <div className="wc-actions">
          <button type="button" className="btn btn-gold" onClick={pdf} disabled={busy}>{busy ? 'Making the PDF…' : `Download ${size.label} PDF`}</button>
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>Print on {size.label}</button>
          {msg ? <p className="wc-hint" style={{ color: msg.ok ? '#2F6B4E' : '#A8442E' }}>{msg.text}</p> : null}
        </div>
        <div>
          <h2>Paper</h2>
          <div className="pf-toggle">
            <button type="button" className={paper === 'a4' ? 'on' : undefined} onClick={() => setPaper('a4')}>A4</button>
            <button type="button" className={paper === 'a3' ? 'on' : undefined} onClick={() => setPaper('a3')}>A3</button>
          </div>
          <p className="wc-hint" style={{ marginTop: 6 }}>{paper === 'a3' ? 'A3 landscape (420 × 297 mm) reads from across the street. Check your printer takes A3, or send the PDF to a print shop.' : 'A4 landscape: 297 × 210 mm, the same poster smaller.'}</p>
        </div>
        <div>
          <h2>Printing on</h2>
          <div className="pf-toggle">
            <button type="button" className={margin === 'office' ? 'on' : undefined} onClick={() => setMargin('office')}>Our printer</button>
            <button type="button" className={margin === 'none' ? 'on' : undefined} onClick={() => setMargin('none')}>Print shop</button>
          </div>
          <p className="wc-hint" style={{ marginTop: 6 }}>{margin === 'office' ? 'Keeps everything 8 mm in from the edge, because office printers can’t print right to the edge.' : 'Edge to edge. Only for printers that can print to the edge (most print shops).'}</p>
        </div>
        <p className="wc-hint">Scan the code with your phone before printing to check it opens WhatsApp. When someone sends it, note their name on the landlord’s enquiry so you know who to pay.</p>
      </aside>
      <main className="wc-stage" ref={stage}>
        <div className="pf-fit" style={{ width: W * fit, height: H * fit }}>
        <div className="pf-zoom" style={{ transform: `scale(${fit})`, transformOrigin: 'top left' }}>
          <div ref={page} className="wc-paper wc-shadow" style={{ width: W, height: H }}>
            <div style={{ transform: `scale(${inner})`, transformOrigin: 'center' }}>
              <Poster qr={qr} />
            </div>
          </div>
        </div>
        </div>
      </main>
    </div>
  )
}

function Poster({ qr }: { qr: string }) {
  return (
    <div className="pf" style={themeVars('terracotta') as React.CSSProperties}>
      <header className="pf-top">
        <div className="wc-brand"><LogoMark /><span><b>PRESTON HILL</b><i>ESTATES</i></span></div>
        <div className="pf-tag">Black Friday</div>
      </header>

      <div className="pf-body">
        <section className="pf-hero">
          <p className="pf-kicker">Know a landlord?</p>
          <p className="pf-big"><span>£</span>500</p>
          <p className="pf-for">for every landlord you introduce</p>
          <p className="pf-ends">Offer ends 31 December 2026</p>
        </section>

        <div className="pf-side">
          <p className="pf-lead">Introduce a landlord to us. When they let their property with Preston Hill Estates, we’ll send you £500 as a thank you.</p>
          <section className="pf-steps">
            <div><b>1</b><span><h3>Tell them about us</h3><p>A friend, relative, neighbour or colleague with a home to let. Check they’re happy for us to call.</p></span></div>
            <div><b>2</b><span><h3>Send us their details</h3><p>Scan the code to WhatsApp us, call 020 8904 9005, or pop into the branch.</p></span></div>
            <div><b>3</b><span><h3>Get £500</h3><p>When they let with us, by bank transfer once the first month’s rent is in. No limit.</p></span></div>
          </section>
          <section className="pf-scan">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="" />
            <div>
              <h3>Scan to introduce a landlord</h3>
              <p>Opens WhatsApp with a short message to fill in.</p>
              <p className="pf-or">or call <b>020 8904 9005</b></p>
            </div>
          </section>
        </div>
      </div>

      <footer className="pf-foot">
        <p><b>271 Preston Road, Harrow HA3 0PS</b> · prestonhillestates.com · Est. 2004</p>
        <p className="pf-small">The landlord must be new to us (not a client, and not in touch with us about letting in the last 12 months) and introduced by 31 December 2026, with their tenancy through us starting by 31 March 2027. £500 paid by bank transfer once the first month’s rent is received. Any of our letting services counts: fully managed, rent collection or let only. One £500 per property, no limit on introductions. Not open to our staff or their households. Full terms in branch.</p>
      </footer>
    </div>
  )
}
