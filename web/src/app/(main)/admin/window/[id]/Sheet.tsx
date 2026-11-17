'use client'

import { forwardRef } from 'react'
import { LogoMark } from '@/components/Logo'
import { badgeFor, bandFor, factsFor, splitPrice, type CardData, type CardProperty } from '@/lib/window-card'

const ICON: Record<string, string> = {
  bed: 'M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 14h18M3 18v2M21 18v2M6 10V7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3',
  bath: 'M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-3zM6 12V6a2 2 0 0 1 4 0M7 19l-1 2M17 19l1 2',
  rec: 'M4 12V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 12h18v5H3zM5 17v2M19 17v2',
  size: 'M4 20L20 4M4 20h5M4 20v-5M20 4h-5M20 4v5',
  tenure: 'M14 4h-4a2 2 0 0 0-2 2v14l4-3 4 3V6a2 2 0 0 0-2-2z',
  epc: 'M12 3c4 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2-6 6-10z',
}

/** One shop window display sheet, drawn at A4 size (794 × 1123 px, or turned for landscape). */
export const Sheet = forwardRef<HTMLDivElement, {
  card: CardProperty; data: CardData; address: string; price: string; photos: Map<string, string>; qr: string | null
  onPhotoClick?: (index: number, e: React.MouseEvent<HTMLDivElement>) => void
}>(function Sheet({ card, data, address, price, photos, qr, onPhotoClick }, ref) {
  const badge = badgeFor(card, data)
  const band = bandFor(card)
  const pr = splitPrice(price)
  const facts = factsFor(card)
  const shots = data.photos.map((x) => ({ ...x, url: photos.get(x.id) })).filter((x) => x.url)
  const [hero, ...thumbs] = shots
  const img = (i: number, x: { url?: string; x: number; y: number }, cls: string) => (
    <div className={`wc-photo ${cls}${onPhotoClick ? ' clickable' : ''}`} onClick={onPhotoClick ? (e) => onPhotoClick(i, e) : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={x.url} alt="" style={{ objectPosition: `${x.x}% ${x.y}%` }} crossOrigin="anonymous" />
    </div>
  )
  const long = data.headline.length > 38
  return (
    <div ref={ref} className={`wc-sheet ${data.layout}`}>
      <header className="wc-top">
        <div className="wc-brand"><LogoMark /><span><b>PRESTON HILL</b><i>ESTATES</i></span></div>
        <div className="wc-band">{band}</div>
      </header>

      <div className="wc-media">
        <div className="wc-hero-wrap">
          {hero ? img(0, hero, 'wc-hero') : <div className="wc-photo wc-hero wc-nophoto">Add a photo</div>}
          {badge ? <div className="wc-ribbon"><span>{badge}</span></div> : null}
          <div className="wc-price">
            {pr.lead ? <span className="wc-price-lead">{pr.lead}</span> : null}
            <span className="wc-price-amt">{pr.amount}{pr.tail ? <small> {pr.tail}</small> : null}</span>
          </div>
        </div>
        {thumbs.length ? <div className={`wc-thumbs n${thumbs.length}`}>{thumbs.map((t, i) => <div key={t.id}>{img(i + 1, t, 'wc-thumb')}</div>)}</div> : null}
      </div>

      <div className="wc-body">
        <h1 className={`wc-headline${long ? ' long' : ''}`}>{data.headline}</h1>
        <p className="wc-address">{address}</p>
        {facts.length ? (
          <div className="wc-facts">
            {facts.map((f) => (
              <div key={f.key} className="wc-fact">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[f.key]} /></svg>
                <span><b>{f.value}</b>{f.label ? <small>{f.label}</small> : null}</span>
              </div>
            ))}
          </div>
        ) : null}
        {data.description.trim() ? <div className="wc-desc">{data.description.split(/\n\s*\n/).map((para, i) => para.trim() ? <p key={i}>{para.trim()}</p> : null)}</div> : null}
        {data.highlights.some((h) => h.trim()) ? <ul className="wc-highlights">{data.highlights.filter((h) => h.trim()).map((h, i) => <li key={i}>{h.trim()}</li>)}</ul> : null}
      </div>

      <footer className="wc-foot">
        <div className="wc-foot-l">
          <span className="wc-cta">To arrange a viewing, call</span>
          <span className="wc-phone">020 8904 9005</span>
          <span className="wc-web">prestonhillestates.com · 271 Preston Road, Harrow · Ref {card.ref}</span>
        </div>
        {data.showQr && qr ? (
          <div className="wc-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="" />
            <span>Scan for photos<br />&amp; floorplan</span>
          </div>
        ) : null}
      </footer>
    </div>
  )
})
