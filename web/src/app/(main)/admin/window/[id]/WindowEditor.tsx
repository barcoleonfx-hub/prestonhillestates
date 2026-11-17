'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import type { WindowCardInput } from '@/lib/window-card-data'
import { DESCRIPTION_MAX, HEADLINE_MAX, MAX_HIGHLIGHTS, MAX_PHOTOS, defaultHighlights, longerDescription, orderedPhotos, paperSize, placement, THEMES, type BadgeKind, type CardData } from '@/lib/window-card'
import { resetWindowCard, saveWindowCard } from '../../window-actions'
import { Sheet } from './Sheet'

// Stands in for a photo that can't be loaded, so one missing photo never stops the PDF.
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

const BADGES: [BadgeKind, string][] = [
  ['auto', 'Automatic (Just listed, Under offer, Sold STC…)'], ['none', 'No ribbon'], ['just-listed', 'Just listed'],
  ['new-instruction', 'New instruction'], ['reduced', 'Price reduced'], ['custom', 'My own words'],
]

export function WindowEditor({ input }: { input: WindowCardInput }) {
  const router = useRouter()
  const [d, setD] = useState<CardData>(input.data)
  const [slot, setSlot] = useState(0)
  const [qr, setQr] = useState<string | null>(null)
  const [busy, setBusy] = useState<'' | 'pdf'>('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saved, setSaved] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [fit, setFit] = useState(0.7)
  // Whether the words fit in the text area of the sheet, and how much room is left (in sheet pixels).
  const [overflow, setOverflow] = useState(false)
  const [room, setRoom] = useState(0)
  const sheet = useRef<HTMLDivElement>(null)
  // The whole page as it prints: the sheet inside its white border.
  const page = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  // Only what staff change is saved: until then the sheet keeps following the listing (new photos, new wording).
  const dirty = useRef(false)
  const all = useMemo(() => orderedPhotos(input.card), [input.card])
  const urls = useMemo(() => new Map(all.map((p) => [p.id, p.url])), [all])
  const set = (patch: Partial<CardData>) => { dirty.current = true; setD((x) => ({ ...x, ...patch })) }
  const W = d.layout === 'landscape' ? 1123 : 794, H = d.layout === 'landscape' ? 794 : 1123
  const paper = d.paper ?? 'a4'
  const size = paperSize(paper, d.layout)
  const margin = d.margin ?? 'office'
  const place = placement(paper, d.layout, margin)
  const PAPER = paper.toUpperCase()

  // A QR code that opens the listing on the website.
  useEffect(() => { if (input.url) QRCode.toDataURL(input.url, { margin: 0, width: 400, color: { dark: '#23211A', light: '#FFFFFF' } }).then(setQr).catch(() => setQr(null)) }, [input.url])
  // Saves a moment after each change.
  useEffect(() => {
    if (!dirty.current) return
    setSaved('unsaved')
    const t = setTimeout(async () => { setSaved('saving'); await saveWindowCard(input.id, d).catch(() => {}); setSaved('saved') }, 800)
    return () => clearTimeout(t)
  }, [d, input.id])
  useEffect(() => {
    const body = sheet.current?.querySelector<HTMLElement>('.wc-body')
    if (!body) return
    const t = setTimeout(() => {
      const last = body.lastElementChild as HTMLElement | null
      const used = last ? last.offsetTop + last.offsetHeight - body.offsetTop : 0
      setOverflow(body.scrollHeight > body.clientHeight + 2)
      setRoom(Math.max(0, body.clientHeight - used))
    }, 150)
    return () => clearTimeout(t)
  }, [d])
  // The preview fits the space available.
  useEffect(() => {
    const measure = () => { const el = stage.current; if (!el) return; setFit(Math.min(1, (el.clientWidth - 56) / W, (window.innerHeight - 56) / H)) }
    measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure)
  }, [W, H])

  // Clicking a photo on the sheet chooses which part of it shows.
  const onPhotoClick = (i: number, e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.round(((e.clientX - r.left) / r.width) * 100), y = Math.round(((e.clientY - r.top) / r.height) * 100)
    setSlot(i)
    set({ photos: d.photos.map((p, j) => (j === i ? { ...p, x, y } : p)) })
  }
  const choose = (id: string) => {
    const photos = [...d.photos]
    const existing = photos.findIndex((p) => p.id === id)
    if (existing >= 0 && existing !== slot && photos[slot]) [photos[existing], photos[slot]] = [photos[slot], photos[existing]]
    else if (existing < 0) { if (slot < photos.length) photos[slot] = { id, x: 50, y: 50 }; else photos.push({ id, x: 50, y: 50 }) }
    set({ photos: photos.slice(0, MAX_PHOTOS) })
  }
  const move = (dir: -1 | 1) => {
    const j = slot + dir
    if (j < 0 || j >= d.photos.length) return
    const photos = [...d.photos];[photos[slot], photos[j]] = [photos[j], photos[slot]]
    set({ photos }); setSlot(j)
  }
  const removeSlot = () => { if (d.photos.length > 1) { set({ photos: d.photos.filter((_, i) => i !== slot) }); setSlot(Math.max(0, slot - 1)) } }

  async function pdf() {
    if (!page.current) return
    setBusy('pdf'); setMsg(null)
    try {
      const [{ toJpeg }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')])
      await document.fonts.ready
      // About 290 dots per inch on A4, 270 on A3: sharp in a shop window, and a manageable file.
      const data = await toJpeg(page.current, { pixelRatio: paper === 'a3' ? 4 : 3, quality: 0.93, backgroundColor: '#ffffff', width: W, height: H, style: { transform: 'none' }, imagePlaceholder: BLANK })
      const doc = new jsPDF({ orientation: d.layout, unit: 'mm', format: paper, compress: true })
      const [pw, ph] = [size.w, size.h]
      doc.addImage(data, 'JPEG', 0, 0, pw, ph, undefined, 'FAST')
      doc.save(`Window card ${PAPER} ${input.card.ref} ${input.address.replace(/[^\w ,-]/g, '').slice(0, 40)}.pdf`)
      setMsg({ ok: true, text: `Downloaded. Print it at 100% (“actual size”) on ${PAPER} paper.` })
    } catch (e) {
      console.error(e)
      setMsg({ ok: false, text: 'The PDF couldn’t be made in this browser. Use Print instead and choose “Save as PDF”.' })
    }
    setBusy('')
  }
  async function reset() {
    if (!window.confirm('Go back to what the listing says? Your changes to this sheet will be lost.')) return
    await resetWindowCard(input.id)
    router.refresh()
    window.location.reload()
  }

  // Five boxes to start with, and one more each time the last is filled, up to eight.
  const filled = d.highlights.filter((h) => h.trim()).length
  const hi = [...d.highlights, ...Array(MAX_HIGHLIGHTS).fill('')].slice(0, Math.min(MAX_HIGHLIGHTS, Math.max(5, filled + 1)))
  return (
    <div className="wc-page">
      <style>{`@page { size: ${PAPER} ${d.layout}; margin: 0; } @media print { html, body { margin: 0 !important; padding: 0 !important; height: ${size.h}mm !important; overflow: hidden !important; } .wc-page, .wc-stage { height: ${size.h}mm !important; overflow: hidden !important; } .wc-scale { zoom: ${size.scale}; margin: 0 !important; } }`}</style>
      <aside className="wc-panel">
        <div>
          <p className="wc-hint"><Link href={`/admin/properties/${input.id}`}>← Back to the property</Link> · <Link href="/admin/window">Other properties</Link></p>
          <h1>Window display sheet</h1>
          <p className="sub">{input.address} · {input.price}</p>
        </div>
        {!input.published ? <p className="notice warn">This property isn’t on the website yet, so there’s no QR code to its page.</p> : null}

        <div className="wc-actions">
          <button type="button" className="btn btn-gold" onClick={pdf} disabled={busy === 'pdf'}>{busy === 'pdf' ? 'Making the PDF…' : `Download ${PAPER} PDF`}</button>
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>Print on {PAPER}</button>
          {msg ? <p className={`notice ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p> : null}
          <span className="wc-status">{saved === 'saved' ? 'All changes saved' : saved === 'saving' ? 'Saving…' : 'Changes not saved yet'}</span>
        </div>

        <section>
          <h2>Colour</h2>
          <div className="wc-swatches">
            {THEMES.map((t) => <button key={t.key} type="button" className={`wc-swatch${(d.theme ?? 'blue') === t.key ? ' on' : ''}`} onClick={() => set({ theme: t.key })}><i style={{ background: t.colour }} />{t.label}</button>)}
          </div>
          <p className="wc-hint" style={{ marginTop: 6 }}>Bright colours print cleaner than black, which can come out muddy and uses a lot of ink.</p>
        </section>

        <section>
          <h2>Layout</h2>
          <div className="seg">
            <button type="button" className={d.layout === 'portrait' ? 'on' : undefined} onClick={() => set({ layout: 'portrait' })}>Portrait</button>
            <button type="button" className={d.layout === 'landscape' ? 'on' : undefined} onClick={() => set({ layout: 'landscape' })}>Landscape</button>
          </div>
          <h2 style={{ marginTop: 14 }}>Paper size</h2>
          <div className="seg">
            <button type="button" className={paper === 'a4' ? 'on' : undefined} onClick={() => set({ paper: 'a4' })}>A4</button>
            <button type="button" className={paper === 'a3' ? 'on' : undefined} onClick={() => set({ paper: 'a3' })}>A3</button>
          </div>
          <p className="wc-hint" style={{ marginTop: 6 }}>{paper === 'a3' ? 'A3 is the same sheet, twice the size (297 × 420 mm). Check your printer takes A3, or send the PDF to a print shop.' : 'A4: 210 × 297 mm.'}</p>
          <h2 style={{ marginTop: 14 }}>Printing on</h2>
          <div className="seg">
            <button type="button" className={margin === 'office' ? 'on' : undefined} onClick={() => set({ margin: 'office' })}>Our printer</button>
            <button type="button" className={margin === 'none' ? 'on' : undefined} onClick={() => set({ margin: 'none' })}>Print shop</button>
          </div>
          <p className="wc-hint" style={{ marginTop: 6 }}>{margin === 'office' ? 'Keeps everything 8 mm in from the edge, because office printers can’t print right to the edge and would cut off the logo and phone number.' : 'Edge to edge, with no white border. Only for printers that can print to the edge (most print shops).'}</p>
        </section>

        <section>
          <h2>Photos</h2>
          <div className="wc-slots">
            {Array.from({ length: MAX_PHOTOS }, (_, i) => {
              const p = d.photos[i]
              return p ? (
                <button key={i} type="button" className={`wc-slot${slot === i ? ' on' : ''}`} onClick={() => setSlot(i)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={urls.get(p.id)} alt="" style={{ objectPosition: `${p.x}% ${p.y}%` }} /><b>{i === 0 ? 'Main' : i + 1}</b>
                </button>
              ) : <button key={i} type="button" className={`wc-slot empty${slot === i ? ' on' : ''}`} onClick={() => setSlot(Math.min(i, d.photos.length))}>+ Add</button>
            })}
          </div>
          <div className="wc-slot-tools">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(-1)} disabled={slot === 0}>← Move</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(1)} disabled={slot >= d.photos.length - 1}>Move →</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={removeSlot} disabled={d.photos.length <= 1 || slot >= d.photos.length}>Remove</button>
            {d.photos[slot] ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ photos: d.photos.map((p, j) => (j === slot ? { ...p, x: 50, y: 50 } : p)) })}>Centre it</button> : null}
          </div>
          <p className="wc-hint" style={{ marginTop: 8 }}>Choose a slot, then pick its photo below. <b>Click a photo on the sheet</b> to choose which part of it shows (e.g. click the front door to keep it in view).</p>
          {all.length ? (
            <div className="wc-pick" style={{ marginTop: 8 }}>
              {all.map((p) => (
                <button key={p.id} type="button" className={d.photos.some((x) => x.id === p.id) ? 'used' : undefined} onClick={() => choose(p.id)} title="Use this photo in the chosen slot">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" />
                </button>
              ))}
            </div>
          ) : <p className="notice warn">Add photos to the listing first.</p>}
        </section>

        <section>
          <h2>Words</h2>
          <div className="field"><label>Headline <span className={`count${d.headline.length > HEADLINE_MAX ? ' over' : ''}`}>{d.headline.length}/{HEADLINE_MAX}</span></label><input className="input" value={d.headline} onChange={(e) => set({ headline: e.target.value })} placeholder="e.g. Stunning 3 Bed Semi with Garden" /></div>
          <div className="field"><label>Description <span className={`count${d.description.length > DESCRIPTION_MAX ? ' over' : ''}`}>{d.description.length}/{DESCRIPTION_MAX}</span></label><textarea className="textarea" rows={7} value={d.description} onChange={(e) => set({ description: e.target.value })} /><span className="wc-hint">Leave a blank line to start a new paragraph.</span></div>
          {(input.card.summary || input.card.description) ? <div className="wc-slot-tools" style={{ marginTop: -4, marginBottom: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ description: longerDescription(input.card) })}>Use more of the listing’s description</button>
            {defaultHighlights(input.card, MAX_HIGHLIGHTS).length > d.highlights.filter((h) => h.trim()).length ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const have = d.highlights.filter((h) => h.trim()); const more = defaultHighlights(input.card, MAX_HIGHLIGHTS).filter((h) => !have.some((x) => x.trim().toLowerCase() === h.toLowerCase())); set({ highlights: [...have, ...more].slice(0, MAX_HIGHLIGHTS) }) }}>Add more highlights from the listing</button> : null}
          </div> : null}
          {overflow ? <p className="notice warn">The words don’t all fit on the sheet. Shorten the description or remove a highlight (or a fact) until this message goes.</p> : room > 120 ? <p className="wc-hint">There’s room for more: add to the description or the highlights.</p> : null}
          <div className="field"><label>Highlights (one per line on the sheet)</label>
            {hi.map((h, i) => <input key={i} className="input" value={h} maxLength={42} onChange={(e) => { const next = [...hi]; next[i] = e.target.value; set({ highlights: next }) }} placeholder={i === 0 ? 'e.g. South-facing garden' : ''} style={{ marginBottom: 4 }} />)}
          </div>
          <p className="wc-hint">Keep it short and punchy: people read a window card in a few seconds.</p>
        </section>

        <section>
          <h2>Ribbon on the photo</h2>
          <div className="field"><select className="select" value={d.badge} onChange={(e) => set({ badge: e.target.value as BadgeKind })}>{BADGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          {d.badge === 'custom' ? <div className="field"><input className="input" value={d.badgeText} maxLength={28} onChange={(e) => set({ badgeText: e.target.value })} placeholder="e.g. Chain free" /></div> : null}
          <label className="te-toggle"><input type="checkbox" checked={d.showQr} onChange={(e) => set({ showQr: e.target.checked })} /> QR code to the listing (people can scan it from the street)</label>
        </section>

        <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Start again from the listing</button>
      </aside>

      <main className="wc-stage" ref={stage}>
        <div className="wc-scale wc-shadow" style={{ transform: `scale(${fit})`, width: W, height: H, marginBottom: -(H * (1 - fit)) }}>
          <div ref={page} className="wc-paper" style={{ width: W, height: H }}>
            <div style={{ width: W * place.scale, height: H * place.scale }}>
              <div style={{ width: W, height: H, transform: `scale(${place.scale})`, transformOrigin: 'top left' }}>
                <Sheet ref={sheet} card={input.card} data={d} address={input.address} price={input.price} photos={urls} qr={input.url ? qr : null} onPhotoClick={onPhotoClick} />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
