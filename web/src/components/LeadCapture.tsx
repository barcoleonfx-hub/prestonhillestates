'use client'

import { useEffect, useState } from 'react'
import { CONSENT_WORDING } from '@/lib/lead-rules'
import './consent.css'

// Where each visitor came from (the advert or link, the site that sent them, the page they landed on), kept in their
// browser for 90 days and sent with any form they fill in; and the consent boxes every form shows.

const KEY = 'phe_attr'
const DAYS = 90

type Visit = { utm_source?: string; utm_medium?: string; utm_campaign?: string; referrer?: string; landing?: string; at: number }

/** Remembers the first visit, or a newer one that came from an advert or campaign link. */
export function rememberVisit() {
  try {
    const q = new URLSearchParams(window.location.search)
    const utm = { utm_source: q.get('utm_source') ?? undefined, utm_medium: q.get('utm_medium') ?? undefined, utm_campaign: q.get('utm_campaign') ?? undefined }
    const hasUtm = !!(utm.utm_source || utm.utm_medium || utm.utm_campaign)
    const old = JSON.parse(localStorage.getItem(KEY) || 'null') as Visit | null
    const fresh = old && Date.now() - old.at < DAYS * 864e5
    if (fresh && !hasUtm) return
    const ref = document.referrer && !document.referrer.startsWith(window.location.origin) ? document.referrer : undefined
    localStorage.setItem(KEY, JSON.stringify({ ...utm, referrer: ref, landing: window.location.pathname, at: Date.now() } satisfies Visit))
  } catch { /* private browsing */ }
}

/** What to send with a form: the remembered visit, or this page if nothing was remembered. */
export function attributionJson(): string {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null') as Visit | null
    if (v) return JSON.stringify(v)
  } catch { /* private browsing */ }
  return typeof window === 'undefined' ? '' : JSON.stringify({ landing: window.location.pathname })
}

/** Put once in each layout: remembers how the visitor arrived. */
export function VisitTracker() {
  useEffect(() => { rememberVisit() }, [])
  return null
}

/** A hidden field carrying the visit, for forms posted as FormData. */
export function AttributionField() {
  const [v, setV] = useState('')
  useEffect(() => { setV(attributionJson()) }, [])
  return <input type="hidden" name="attribution" value={v} />
}

export type Consent = { email: boolean; whatsapp: boolean }

/**
 * The consent boxes: never ticked to start with, the exact wording we store, and the privacy policy. Without
 * `value`, they're plain checkboxes named consent_email and consent_whatsapp (for FormData forms).
 */
export function ConsentBoxes({ value, onChange, whatsapp = true, compact = false }: { value?: Consent; onChange?: (c: Consent) => void; whatsapp?: boolean; compact?: boolean }) {
  const ctl = !!value && !!onChange
  const box = (ch: 'email' | 'whatsapp') => (
    <label className="cbx-row" key={ch}>
      {ctl
        ? <input type="checkbox" checked={value![ch]} onChange={(e) => onChange!({ ...value!, [ch]: e.target.checked })} />
        : <input type="checkbox" name={`consent_${ch}`} value="true" />}
      <span>{CONSENT_WORDING[ch]}</span>
    </label>
  )
  return (
    <div className={`cbx${compact ? ' compact' : ''}`}>
      {box('email')}
      {whatsapp ? box('whatsapp') : null}
      <p className="cbx-note">Optional. We’ll use your details to deal with your enquiry either way. <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a></p>
    </div>
  )
}
