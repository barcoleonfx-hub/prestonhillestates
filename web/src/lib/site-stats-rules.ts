// Website stats, the parts with no server code: where a visit came from, what device, and what to call a page.

/** Where a visit came from, from the page that sent it and any campaign tag on the link. */
export function sourceOf(referrer: string, utm: { source?: string | null; medium?: string | null }, own: string[] = []): string {
  const tag = `${utm.source ?? ''} ${utm.medium ?? ''}`.toLowerCase()
  if (tag.trim()) {
    // Paid adverts (Google Ads links carry utm_medium=cpc, or a gclid click id) are counted apart from ordinary searches.
    if (/\b(cpc|ppc|paid|ads?)\b/.test(tag)) return /google/.test(tag) || !utm.source ? 'Google Ads' : `${(utm.source ?? '').replace(/[^\w .-]/g, '').slice(0, 24)} ads`
    if (/\bletters?\b|\bpost(al)?\b/.test(tag)) return 'Letters'
    if (/qr|poster|window/.test(tag)) return 'Posters and QR codes'
    if (/whatsapp/.test(tag)) return 'WhatsApp'
    if (/email|newsletter|campaign|property_alert/.test(tag)) return 'Our emails'
    if (/facebook|instagram|social|fb|ig/.test(tag)) return 'Social media'
    if (/google/.test(tag)) return 'Google'
    return (utm.source ?? 'Other').replace(/[^\w .-]/g, '').slice(0, 30) || 'Other'
  }
  let host = ''
  try { host = referrer ? new URL(referrer).hostname.toLowerCase().replace(/^www\./, '') : '' } catch { host = '' }
  if (!host || own.some((o) => host === o || host.endsWith(`.${o}`))) return 'Direct'
  if (/(^|\.)google\./.test(host)) return 'Google'
  if (/bing\.com$|duckduckgo\.com$|yahoo\.|ecosia\.org$|search\.brave\.com$/.test(host)) return 'Other search engines'
  if (/rightmove\./.test(host)) return 'Rightmove'
  if (/zoopla\./.test(host)) return 'Zoopla'
  if (/onthemarket\./.test(host)) return 'OnTheMarket'
  if (/facebook\.com$|fb\.com$|instagram\.com$|t\.co$|twitter\.com$|x\.com$|linkedin\.com$|tiktok\.com$|nextdoor\./.test(host)) return 'Social media'
  if (/whatsapp\./.test(host)) return 'WhatsApp'
  if (/mail\.|outlook\.|live\.com$/.test(host)) return 'Our emails'
  return host.slice(0, 40)
}

export function deviceOf(ua: string): 'Phone' | 'Tablet' | 'Computer' {
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/i.test(ua)) return 'Tablet'
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return 'Phone'
  return 'Computer'
}

/** Crawlers, link previews and monitors aren't visitors. */
export const isBot = (ua: string) => !ua || /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|render/i.test(ua)

const PAGES: Record<string, string> = {
  '/': 'Home page', '/valuation': 'Free valuation', '/properties': 'Property search', '/landlords': 'Landlords', '/renting': 'Renting',
  '/sell': 'Selling', '/sold-prices': 'Sold prices', '/fees': 'Fees', '/mortgage-calculator': 'Mortgage calculator', '/reviews': 'Reviews',
  '/privacy': 'Privacy', '/areas': 'Areas', '/guides': 'Guides', '/unsubscribe': 'Unsubscribe',
}
const title = (s: string) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** "Free valuation", "Area: Kenton", or for a property, its reference (named from our listings on the stats page). */
export function pageLabel(path: string): { label: string; ref: string | null } {
  const p = path.replace(/\/+$/, '') || '/'
  if (PAGES[p]) return { label: PAGES[p], ref: null }
  const prop = /^\/properties\/([a-z]{2,4}\d+)(?:-|$)/i.exec(p)
  if (prop) return { label: prop[1].toUpperCase(), ref: prop[1].toUpperCase() }
  const area = /^\/areas\/([\w-]+)/.exec(p)
  if (area) return { label: `Area: ${title(area[1])}`, ref: null }
  const guide = /^\/guides\/([\w-]+)/.exec(p)
  if (guide) return { label: `Guide: ${title(guide[1])}`, ref: null }
  return { label: p, ref: null }
}
