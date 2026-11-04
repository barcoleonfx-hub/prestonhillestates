import Script from 'next/script'
import { listPublished, priceLabel, slugFor, displayAddressFor, statusLabel } from '@/lib/properties'
import { labelFor, PROPERTY_TYPES } from '@/lib/options'
import { MARKUP, SCRIPT } from './home-content'
import { LR_CREDIT, patchSummary } from '@/lib/sold-prices'

export const dynamic = 'force-dynamic'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const ART: Record<string, string> = { flat: 'fc-block', maisonette: 'fc-block', studio: 'fc-block', terraced_house: 'fc-terrace', end_terrace_house: 'fc-terrace', town_house: 'fc-terrace' }

/** "Featured this week": the newest live listings, featured ones first, as cards in the approved design. */
async function listingCards(): Promise<string> {
  const rows = (await listPublished({}).catch(() => [])).slice(0, 3)
  if (rows.length === 0) {
    return `<div class="empty-card">New homes are added every week. <a href="/properties">See everything available</a>, or <a href="#valuation">ask us to value yours</a>.</div>`
  }
  return rows.map((p, i) => {
    const price = priceLabel(p)
    const priceHtml = p.channel === 'let' ? esc(price).replace(/ (pcm|pw|pa)$/, ' <small>$1</small>') : esc(price)
    const meta = [
      p.bedrooms ? `${p.bedrooms} bed` : '',
      p.channel === 'let' ? (p.bathrooms ? `${p.bathrooms} bath` : '') : p.receptions ? `${p.receptions} rec` : '',
      labelFor(PROPERTY_TYPES, p.propertyType),
    ].filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('')
    const visual = p.cover
      ? `<img class="photo" src="${esc(p.cover.url)}" alt="" loading="lazy"/>`
      : `<svg viewBox="0 0 400 240"><use href="#${ART[p.propertyType ?? ''] ?? 'fc-semi'}"/></svg>`
    const status = p.status !== 'available' ? `<span class="status">${esc(statusLabel(p.status))}</span>` : ''
    return `<a class="prop rv${i ? ` d${i}` : ''}" href="/properties/${esc(slugFor(p))}">
      <div class="visual"><span class="pill${p.channel === 'let' ? ' let' : ''}">${p.channel === 'let' ? 'To let' : 'For sale'}</span>${status}${visual}</div>
      <div class="body"><div class="price">${priceHtml}</div><div class="addr">${esc(displayAddressFor(p))}</div><div class="meta">${meta}</div></div>
    </a>`
  }).join('\n')
}

const AREA_NAMES: Record<string, string> = { HA0: 'Wembley & Alperton', HA1: 'Harrow', HA2: 'South & North Harrow', HA3: 'Kenton & Harrow Weald', HA7: 'Stanmore', HA8: 'Edgware', HA9: 'Wembley', NW9: 'Kingsbury & Colindale' }
const gbp = (n: number | null) => (n == null ? '' : n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(2).replace(/0$/, '')}m` : `£${Math.round(n / 1000)}k`)

/** "Local market": real sold prices across our patch from HM Land Registry, with a postcode search. */
async function marketBand(): Promise<string> {
  const s = await patchSummary().catch(() => null)
  if (!s?.count) return ''
  const areas = s.byArea.map((a) => `<a href="/sold-prices?postcode=${a.outward}"><b>${a.outward}</b><span>${gbp(a.median)}</span><small>${esc(AREA_NAMES[a.outward] ?? '')} · ${a.count} sold</small></a>`).join('')
  return `<section class="market" aria-label="Local property market">
    <div class="wide mk-grid">
      <div>
        <div class="label rv"><b>Local market</b> · HM Land Registry</div>
        <h2 class="sect rv d1" style="margin-top:16px;"><span class="mk-num">${s.count.toLocaleString('en-GB')}</span> homes sold nearby <em>in the last 12 months.</em></h2>
        <p class="mk-sub rv d2">Real sale prices across Harrow, Kenton, Wembley, Stanmore, Edgware and Kingsbury. Typical price ${gbp(s.median)}. See what sold on your street.</p>
        <form class="mk-search rv d2" action="/sold-prices">
          <input name="postcode" placeholder="Your postcode" aria-label="Your postcode" autocomplete="postal-code"/>
          <button type="submit" class="btn gold">See sold prices</button>
        </form>
      </div>
      <div class="mk-areas rv d1">${areas}</div>
    </div>
    <div class="wide"><p class="mk-credit">Typical (median) prices for the last 12 months. ${esc(LR_CREDIT)}</p></div>
  </section>`
}

export default async function HomePage() {
  const html = MARKUP.replace('<!--LISTINGS-->', await listingCards()).replace('<!--MARKET-->', await marketBand())
  return (
    <>
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />
      <Script id="home-js" strategy="afterInteractive">{SCRIPT}</Script>
    </>
  )
}
