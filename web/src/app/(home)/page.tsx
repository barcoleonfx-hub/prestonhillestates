import Script from 'next/script'
import { listPublished, priceLabel, slugFor, displayAddressFor, statusLabel } from '@/lib/properties'
import { labelFor, PROPERTY_TYPES } from '@/lib/options'
import { MARKUP, SCRIPT } from './home-content'

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

export default async function HomePage() {
  const html = MARKUP.replace('<!--LISTINGS-->', await listingCards())
  return (
    <>
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />
      <Script id="home-js" strategy="afterInteractive">{SCRIPT}</Script>
    </>
  )
}
