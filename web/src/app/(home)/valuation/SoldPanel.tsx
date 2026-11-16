'use client'
import { useEffect, useState } from 'react'
import type { Near } from '@/lib/sold-prices'
import { SoldCredit, SoldList, SoldStats } from '@/components/SoldList'
import '@/components/sold-prices.css'

const POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/

/** "Recent sales near you", shown once the visitor has given a valid postcode. */
export function SoldPanel({ postcode, type, address = '', beds = '' }: { postcode: string; type: string; address?: string; beds?: string }) {
  // Their street, from the address they picked ("Flat 2, 33 Trevelyan Crescent" → "Trevelyan Crescent").
  const street = (address.split(',').map((x) => x.trim()).reverse().find((x) => /[a-z]{3,}/i.test(x) && !/^(flat|apartment|unit)\b/i.test(x)) ?? '').replace(/^\d+[a-z]?\s+/i, '')
  const pc = postcode.trim().toUpperCase().replace(/\s+/g, ' ')
  // The same kind of home: Land Registry records detached, semi-detached, terraced or flat (never bedrooms).
  const lr = /flat|maisonette|studio/i.test(type) ? 'F' : /semi/i.test(type) ? 'S' : /terrace|town ?house/i.test(type) ? 'T' : /detached/i.test(type) ? 'D' : /house|bungalow|cottage/i.test(type) ? 'H' : ''
  const b = /studio/i.test(beds) ? 0 : Number.parseInt(beds, 10)
  const bedsN = Number.isFinite(b) ? b : null
  const [data, setData] = useState<Near | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!POSTCODE.test(pc)) return
    let live = true
    setLoading(true)
    fetch(`/api/public/sold?postcode=${encodeURIComponent(pc)}${lr ? `&type=${lr}` : ''}${bedsN != null ? `&beds=${bedsN}` : ''}${street ? `&street=${encodeURIComponent(street)}` : ''}`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setData(d?.covered ? d : null) })
      .catch(() => {}).finally(() => live && setLoading(false))
    return () => { live = false }
  }, [pc, lr, bedsN, street])
  if (!POSTCODE.test(pc)) return null
  if (loading && !data) return <div className="sp sp-panel"><p className="sp-loading">Looking up recent sales near {pc}…</p></div>
  if (!data) return null
  const what = data.typed ? ({ F: 'flats and maisonettes', S: 'semi-detached houses', T: 'terraced houses', D: 'detached houses', H: 'houses' } as Record<string, string>)[lr] ?? 'homes' : 'homes'
  return (
    <section className="sp sp-panel" aria-label="Recent sales near you">
      <h3>Recent sales near {data.postcode}</h3>
      <p className="sp-sub">Real sold prices for {what} {data.where}{street ? `, ${street} first` : ''}, from HM Land Registry.{bedsN != null ? ` Land Registry doesn’t record bedrooms, so sizes vary; where we know a home had ${bedsN === 0 ? 'no separate bedroom' : `${bedsN} bedroom${bedsN === 1 ? '' : 's'}`}, it’s marked.` : ''}</p>
      <SoldStats stats={data.stats} note={data.where} match={lr || null} />
      <SoldList sales={data.recent.slice(0, 5)} />
      <p className="sp-cta"><b>Every home is different.</b> Extensions, condition and the exact street can move the price a long way; that’s what our free visit is for.</p>
      <SoldCredit />
    </section>
  )
}
