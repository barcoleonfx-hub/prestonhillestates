'use client'
import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { sendValuationRequest, type ValuationState } from '@/app/(site)/actions'
import { LogoMark } from './Logo'

const STORE_KEY = 'phe_valuation_popup'
const DAY = 24 * 3600 * 1000

function suppressed(): boolean {
  try {
    const until = Number(localStorage.getItem(STORE_KEY) || 0)
    return until > Date.now()
  } catch {
    return false
  }
}
function suppressFor(days: number) {
  try { localStorage.setItem(STORE_KEY, String(Date.now() + days * DAY)) } catch {}
}

/** First-visit pop-up: the Wembley film, then a free valuation request form. */
const DEFAULT_PATHS = ['/', '/properties']

export function ValuationPopup({ paths = DEFAULT_PATHS }: { paths?: string[] }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const [muted, setMuted] = useState(true)
  const [state, dispatch, pending] = useActionState<ValuationState, FormData>(sendValuationRequest, {})
  const videoRef = useRef<HTMLVideoElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const reduced = useRef(false)
  const triggered = useRef(false)
  const small = useRef(false)

  // Decide when to open: once per visitor, a few seconds in on computers, on first scroll on phones.
  useEffect(() => {
    if (triggered.current || !paths.includes(pathname) || suppressed()) return
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const phone = window.matchMedia('(max-width: 640px)').matches
    small.current = window.matchMedia('(max-width: 700px)').matches
    let done = false
    const show = () => {
      if (done || triggered.current) return
      done = true
      triggered.current = true
      lastFocus.current = document.activeElement as HTMLElement
      setOpen(true)
    }
    const timer = window.setTimeout(show, phone ? 10000 : 4000)
    const onScroll = () => { if (window.scrollY > 240) show() }
    if (phone) window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.clearTimeout(timer); window.removeEventListener('scroll', onScroll) }
  }, [pathname, paths])

  // Fade in on the frame after mounting so the transition runs.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => setVisible(true))
    dialogRef.current?.querySelector<HTMLElement>('.vp-close')?.focus()
    return () => cancelAnimationFrame(id)
  }, [open])

  const close = useCallback((days = 30) => {
    suppressFor(days)
    setVisible(false)
    videoRef.current?.pause()
    window.setTimeout(() => { setOpen(false); lastFocus.current?.focus?.() }, 350)
  }, [])

  useEffect(() => {
    if (state.ok) suppressFor(365)
  }, [state.ok])

  // Escape closes; Tab stays inside the dialog.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
      if (e.key === 'Tab' && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex]:not([tabindex="-1"])')]
          .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
        if (!items.length) return
        const first = items[0], last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(() => dispatch(fd))
  }

  if (!open) return null
  const err = (f: string) => (state.field === f ? state.error : undefined)

  return (
    <div className={`vp-backdrop${visible ? ' in' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div ref={dialogRef} className="vp-dialog" role="dialog" aria-modal="true" aria-labelledby="vp-title">
        <div className="vp-media">
          <video
            ref={videoRef}
            muted={muted}
            playsInline
            autoPlay={!reduced.current}
            preload="auto"
            poster={reduced.current ? '/video/wembley-last.jpg' : '/video/wembley-first.jpg'}
            aria-hidden="true"
          >
            <source src={small.current ? '/video/wembley-720.mp4' : '/video/wembley-1080.mp4'} type="video/mp4" />
          </video>
          <div className="vp-shade" />
          <div className="vp-brand">
            <LogoMark />
            <span>Preston Hill Estates</span>
          </div>
          <button type="button" className="vp-close" onClick={() => close()} aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
          <div className="vp-tools">
            {!reduced.current ? (
              <button type="button" onClick={() => { setMuted(!muted); videoRef.current?.play().catch(() => {}) }} aria-pressed={!muted}>
                {muted ? 'Sound on' : 'Sound off'}
              </button>
            ) : null}
          </div>
        </div>

        <div className="vp-formwrap">
          <div className="vp-forminner">
            {state.ok ? (
              <div className="vp-done" role="status">
                <h2 id="vp-title">Thank you.</h2>
                <p>A member of the branch will call you within one working day to arrange your free valuation.</p>
                <button type="button" className="btn btn-dark" onClick={() => close(365)}>Close</button>
              </div>
            ) : (
              <form onSubmit={submit} noValidate>
                <div className="vp-head">
                  <span className="label" style={{ color: 'var(--gold-deep)' }}>Free valuation · no obligation</span>
                  <h2 id="vp-title">What’s your home <em>worth?</em></h2>
                </div>
                <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
                  <label htmlFor="vp-company">Company</label>
                  <input id="vp-company" name="company" tabIndex={-1} autoComplete="off" />
                </div>
                <div className="vp-grid">
                  <div className="field">
                    <label htmlFor="vp-name">Your name</label>
                    <input className="input" id="vp-name" name="name" autoComplete="name" aria-invalid={!!err('name')} />
                  </div>
                  <div className="field">
                    <label htmlFor="vp-phone">Phone number</label>
                    <input className="input" id="vp-phone" name="phone" type="tel" autoComplete="tel" aria-invalid={!!err('phone')} />
                  </div>
                  <div className="field">
                    <label htmlFor="vp-email">Email <span className="hint">(optional)</span></label>
                    <input className="input" id="vp-email" name="email" type="email" autoComplete="email" aria-invalid={!!err('email')} />
                  </div>
                  <div className="field">
                    <label htmlFor="vp-postcode">Property postcode</label>
                    <input className="input" id="vp-postcode" name="postcode" autoComplete="postal-code" style={{ textTransform: 'uppercase' }} aria-invalid={!!err('postcode')} />
                  </div>
                </div>
                <div className="vp-intent">
                  <span className="flabel">I’m thinking of</span>
                  <div className="seg" role="radiogroup" aria-label="I’m thinking of">
                    <label><input type="radio" name="intent" value="selling" defaultChecked /><span>Selling</span></label>
                    <label><input type="radio" name="intent" value="letting" /><span>Letting</span></label>
                    <label><input type="radio" name="intent" value="unsure" /><span>Not sure yet</span></label>
                  </div>
                </div>
                {state.error ? <p className="vp-error" role="alert">{state.error}</p> : null}
                <div className="vp-actions">
                  <button className="btn btn-gold" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Request my free valuation'}</button>
                  <button type="button" className="vp-later" onClick={() => close()}>Maybe later</button>
                </div>
                <p className="vp-small">We’ll only use your details to arrange your valuation.</p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
