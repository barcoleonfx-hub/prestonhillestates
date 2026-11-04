// Tailored "a home you might like" emails to past applicants. Pure functions with no server imports, so the
// portal can show a live preview while staff edit the wording, and the server renders exactly the same email.

export type Interest =
  | 'garden' | 'parking' | 'transport' | 'schools' | 'space' | 'kitchen' | 'bathroom' | 'condition'
  | 'chain' | 'investment' | 'period' | 'quiet' | 'shops' | 'furnished' | 'pets' | 'energy' | 'family'

const TAGS: [Interest, RegExp][] = [
  ['garden', /\b(garden|patio|lawn|terrace|balcony|outside space|outdoor space|decking)\b/i],
  ['parking', /\b(parking|driveway|garage|off[- ]street|car port|carport|allocated space|permit)\b/i],
  ['transport', /\b(station|tube|underground|metropolitan|jubilee|bakerloo|overground|elizabeth line|bus routes?|transport links?|commut\w*|a40|m1)\b/i],
  ['schools', /\b(schools?|catchment|ofsted|nursery)\b/i],
  ['space', /\b(extended|extension|loft|sq\.? ?ft|square feet|spacious|generous|double reception|two reception|annexe?|outbuilding|study|home office)\b/i],
  ['kitchen', /\b(kitchen|open[- ]plan|utility room|breakfast room|diner)\b/i],
  ['bathroom', /\b(en[- ]?suite|bathrooms|shower room|cloakroom|downstairs wc|guest wc)\b/i],
  ['condition', /\b(refurbish\w*|renovat\w*|newly (fitted|decorated|built)|immaculate|redecorat\w*|well[- ]presented|move[- ]in|turn[- ]key|new boiler|recently (fitted|updated))\b/i],
  ['chain', /\b(no (onward )?chain|chain[- ]free|vacant possession)\b/i],
  ['investment', /\b(investment|investors?|yield|buy[- ]to[- ]let|rental income|tenanted)\b/i],
  ['period', /\b(period|character|original features|bay[- ]fronted|bay window|1930s|edwardian|victorian|fireplace)\b/i],
  ['quiet', /\b(quiet|cul[- ]de[- ]sac|tree[- ]lined|residential (road|street|turning)|sought[- ]after|settled|peaceful)\b/i],
  ['shops', /\b(shops|shopping|amenities|high street|parade|restaurants?|caf[eé]s?|supermarket|wembley stadium|park)\b/i],
  ['furnished', /\b(furnished|unfurnished|part[- ]furnished|white goods)\b/i],
  ['pets', /\b(pets?|dogs?|cats?)\b/i],
  ['energy', /\b(epc|double[- ]glaz\w*|solar|insulat\w*|energy[- ]efficient|gas central heating|heat pump)\b/i],
  ['family', /\b(family home|family-sized|ideal for a family|growing family)\b/i],
]

/** What a home they asked us about, or a question they wrote, says they care about. */
export function interestsIn(text: string | null | undefined): Interest[] {
  const t = text ?? ''
  return TAGS.filter(([, re]) => re.test(t)).map(([k]) => k)
}

// A short line under a highlight when it answers something they raised with us themselves.
const SAID_NOTE: Partial<Record<Interest, string>> = {
  garden: 'You asked us about outside space', parking: 'You asked us about parking', transport: 'You wanted to be close to transport',
  schools: 'You mentioned schools', space: 'You were after more space', kitchen: 'You asked about the kitchen', bathroom: 'You asked about bathrooms',
  condition: 'You wanted somewhere ready to move into', chain: 'You wanted to avoid a chain', investment: 'You were looking at it as an investment',
  period: 'You liked period character', quiet: 'You wanted a quiet road', shops: 'You wanted shops and amenities close by',
  furnished: 'You asked about furnishing', pets: 'You asked about pets', energy: 'You asked about running costs', family: 'You were looking for a family home',
}

export type Feature = { text: string; tags: Interest[]; from: 'key' | 'fact' | 'room' | 'text' }

export type EmailProperty = {
  id: string
  ref: string
  url: string
  channel: 'sale' | 'let'
  address: string
  street: string | null
  place: string | null
  outward: string | null
  price: number | null
  priceText: string
  beds: number | null
  baths: number | null
  receptions: number | null
  type: string | null // "semi-detached house"
  family: 'house' | 'flat' | null
  specs: string[]
  summary: string | null
  availableFrom: string | null
  photos: string[]
  features: Feature[]
  valuationUrl: string
}

export type Asked = { what: string; when: string; price: number | null; beds: number | null; family: 'house' | 'flat' | null; outward: string | null; place: string | null }

export type EmailRecipient = {
  contactId: string
  name: string
  email: string
  asked: Asked[] // what they enquired about, newest first
  budget: number | null
  minBeds: number | null
  areas: string | null
  position: string | null
  said: Interest[] // raised by them, in their own messages
  liked: Interest[] // features of homes they asked about
  reasons: string[]
  unsubscribeUrl: string
}

export type Sender = { name: string; phone: string; email: string }
export type Draft = { subject: string; message: string; highlights: { text: string; note: string | null }[]; why: string[]; preheader: string }

const PHONE = '020 8127 7001'
const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export const firstName = (name: string) => {
  const w = name.trim().split(/\s+/)[0] ?? ''
  return /^(mr|mrs|ms|miss|dr)\.?$/i.test(w) ? name.trim() : cap(w.toLowerCase())
}

function whenText(iso: string, mid = false): string {
  const d = new Date(iso), days = (Date.now() - d.getTime()) / 86400000
  const t = days < 10 ? 'Recently' : days < 35 ? 'A few weeks ago'
    : `In ${d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'Europe/London' })}${d.getFullYear() === new Date().getFullYear() && !mid ? '' : ` ${d.getFullYear()}`}`
  return mid ? t.charAt(0).toLowerCase() + t.slice(1) : t
}

/** Picks the highlights that matter to this person first, then the listing's own key features. */
export function pickHighlights(p: EmailProperty, r: Pick<EmailRecipient, 'said' | 'liked' | 'position'>, max = 5): Draft['highlights'] {
  const wanted: { tag: Interest; said: boolean }[] = []
  const seen = new Set<Interest>()
  const pos = (r.position ?? '').toLowerCase()
  const extra: Interest[] = [
    ...(/cash|nothing to sell|first time/.test(pos) ? ['chain' as const] : []),
    ...(/investor/.test(pos) ? ['investment' as const] : []),
    ...(/pets/.test(pos) ? ['pets' as const] : []),
  ]
  for (const t of r.said) if (!seen.has(t)) { seen.add(t); wanted.push({ tag: t, said: true }) }
  for (const t of [...extra, ...r.liked]) if (!seen.has(t)) { seen.add(t); wanted.push({ tag: t, said: false }) }
  const rank = (f: Feature) => (f.from === 'key' ? 0 : f.from === 'fact' ? 1 : f.from === 'room' ? 2 : 3)
  const used = new Set<string>()
  const out: Draft['highlights'] = []
  for (const w of wanted) {
    if (out.length >= max) break
    const f = p.features.filter((x) => x.tags.includes(w.tag) && !used.has(x.text)).sort((a, b) => rank(a) - rank(b))[0]
    if (!f) continue
    used.add(f.text)
    out.push({ text: f.text, note: w.said ? SAID_NOTE[w.tag] ?? null : null })
  }
  for (const f of p.features.filter((x) => x.from === 'key')) {
    if (out.length >= max) break
    if (!used.has(f.text)) { used.add(f.text); out.push({ text: f.text, note: null }) }
  }
  for (const f of p.features.filter((x) => x.from !== 'key' && x.tags.length)) {
    if (out.length >= Math.min(max, 3)) break
    if (!used.has(f.text)) { used.add(f.text); out.push({ text: f.text, note: null }) }
  }
  return out
}

/** Why this home suits them, in their terms: their budget, the area and the size they asked about. */
export function whyFor(p: EmailProperty, r: EmailRecipient): string[] {
  const out: string[] = []
  const a = r.asked[0]
  if (p.price && r.budget) {
    const ratio = p.price / r.budget
    if (ratio <= 1) out.push(`Within the ${gbp(r.budget)} budget you gave us`)
    else if (ratio <= 1.1) out.push(`Just above the ${gbp(r.budget)} you mentioned, so worth a look`)
  } else if (p.price && a?.price) {
    const d = Math.abs(p.price - a.price) / a.price
    if (d <= 0.15) out.push(`A similar price to the home you asked about (${gbp(a.price)})`)
  }
  const outwardMatch = p.outward && (a?.outward === p.outward || (r.areas ?? '').toUpperCase().includes(p.outward))
  const placeMatch = p.place && (a?.place?.toLowerCase() === p.place.toLowerCase() || (r.areas ?? '').toLowerCase().includes(p.place.toLowerCase()))
  if (outwardMatch || placeMatch) out.push(`${[p.place, p.outward].filter(Boolean).join(' ')}, the area you were looking in`)
  const wantBeds = r.minBeds ?? a?.beds ?? null
  if (p.beds && wantBeds) {
    if (p.beds > wantBeds) out.push(`${p.beds} bedrooms, one more than you were after`)
    else if (p.beds === wantBeds) out.push(`${p.beds} bedroom${p.beds === 1 ? '' : 's'}, as you were after`)
  }
  if (p.family && a?.family === p.family && out.length < 4) out.push(p.family === 'house' ? 'A house, like the one you enquired about' : 'A flat, like the one you enquired about')
  if (p.channel === 'let' && p.availableFrom && out.length < 4) out.push(`Available from ${p.availableFrom}`)
  if (!out.length) out.push(...r.reasons.filter((x) => !/recent enquiry|open to future/i.test(x)).slice(0, 3))
  return out.slice(0, 4)
}

function specLine(p: EmailProperty) {
  const bits = [p.beds ? `${p.beds} bedroom` : '', p.type ?? 'home'].filter(Boolean).join(' ')
  return bits
}

/** The first draft for one person. Staff can change the subject and message before it goes. */
export function draftFor(p: EmailProperty, r: EmailRecipient, s: Sender): Draft {
  const first = firstName(r.name)
  const a = r.asked[0]
  const spec = specLine(p)
  const where = [p.street, p.place].filter(Boolean).join(', ') || p.address
  const let_ = p.channel === 'let'
  const recent = a ? Date.now() - new Date(a.when).getTime() < 120 * 86400000 : false
  const why = whyFor(p, r)
  const shortWhere = p.place ?? p.outward ?? 'your area'
  const short = `${p.beds ? `${p.beds} bed ` : ''}${p.type ?? 'home'}`
  const priceLower = p.priceText.charAt(0).toLowerCase() + p.priceText.slice(1)
  // Someone whose enquiry named this very street was most likely asking about this home before it went live.
  const sameStreet = !!(a && p.street && a.what.toLowerCase().includes(p.street.toLowerCase()))
  const subject = (sameStreet
    ? `The ${short} on ${p.street} you asked about`
    : r.budget && p.price && p.price <= r.budget
      ? `${cap(short)} in ${shortWhere}, within your budget`
      : a && recent ? `Like the home you asked about: ${short} in ${shortWhere}`
        : `${let_ ? 'New to rent' : 'Just listed'} in ${shortWhere}: ${short}, ${priceLower}`).slice(0, 90)

  // "at £810,000", or "guide price £810,000" when there's a qualifier.
  const at = /^£/.test(p.priceText) ? `at ${p.priceText}` : p.priceText.charAt(0).toLowerCase() + p.priceText.slice(1)
  const opening = sameStreet
    ? `${whenText(a!.when)} you asked us about ${p.street}. Here are the full details of the ${spec} ${let_ ? 'to rent' : 'for sale'} there, ${at}, with all the photos.`
    : a
    ? `${whenText(a.when)} you asked us about ${a.what}. ${recent ? 'Something has just come on' : 'If you’re still looking, something has just come on'} that I think you’ll like: a ${spec} ${let_ ? 'to rent' : 'for sale'} on ${where}, ${at}.`
    : `When we last spoke you told us what you were looking for${r.areas ? ` around ${r.areas}` : ''}${r.budget ? `, up to ${gbp(r.budget)}` : ''}. A ${spec} on ${where} has just come on, ${at}, and I thought of you straight away.`
  const closing = let_
    ? `Good rentals in this area tend to go quickly. If you’d like to see it, reply to this email or call me on ${s.phone} and I’ll book you in.`
    : `If you’d like to have a look before it’s widely seen, reply to this email or call me on ${s.phone} and I’ll arrange a viewing.`
  const message = [`Hello ${first},`, opening, closing].filter(Boolean).join('\n\n')
  const preheader = `${spec[0].toUpperCase()}${spec.slice(1)} on ${where}, ${p.priceText}. ${why[0] ?? ''}`.trim()
  return { subject, message, highlights: pickHighlights(p, r), why, preheader }
}

// ---------- the email itself ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const SANS = 'Helvetica, Arial, sans-serif'
const SERIF = "Georgia, 'Times New Roman', serif"
const C = { page: '#F1EFE8', card: '#FFFFFF', cream: '#FBF8EE', ink: '#23211A', body: '#59554A', faint: '#98937F', gold: '#A47B1D', goldBtn: '#C4972F', line: '#E7E3D6', dark: '#23211A' }

const withUtm = (url: string, campaign: string) => `${url}${url.includes('?') ? '&' : '?'}utm_source=email&utm_medium=property_alert&utm_campaign=${encodeURIComponent(campaign)}`

function paragraphs(text: string) {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p, i) => `<p style="margin:0 0 16px; font-family:${SANS}; font-size:15px; line-height:24px; color:${i === 0 ? C.ink : C.body};">${esc(p).replace(/\n/g, '<br/>')}</p>`).join('\n')
}

function button(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${C.goldBtn}" style="border-radius:999px;">
<a href="${esc(href)}" target="_blank" style="display:inline-block; padding:15px 30px; font-family:${SANS}; font-size:13px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:#FFFFFF; text-decoration:none; border-radius:999px;">${esc(label)}</a>
</td></tr></table>`
}

export type Rendered = { html: string; text: string }

export function renderEmail(p: EmailProperty, r: EmailRecipient, d: Pick<Draft, 'subject' | 'message' | 'highlights' | 'why' | 'preheader'>, s: Sender): Rendered {
  const link = withUtm(p.url, p.ref)
  const let_ = p.channel === 'let'
  const first = firstName(r.name)
  const needsToSell = /property to sell|under offer on theirs/i.test(r.position ?? '')
  const [hero, ...more] = p.photos
  const thumbs = more.slice(0, 2)
  const a = r.asked[0]
  const because = a ? `you asked us about ${a.what} ${whenText(a.when, true)}` : 'you told us what you were looking for'

  const heroImg = hero ? `<tr><td style="padding:0 40px;" class="px">
<a href="${esc(link)}" target="_blank"><img src="${esc(hero)}" width="520" alt="${esc(p.address)}" style="display:block; width:100%; max-width:520px; height:auto; border-radius:14px;"/></a>
</td></tr>` : ''
  const thumbRow = thumbs.length ? `<tr><td style="padding:12px 40px 0;" class="px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${thumbs.map((t, i) => `<td width="50%" valign="top" style="${i ? 'padding-left:6px;' : thumbs.length > 1 ? 'padding-right:6px;' : ''}"><a href="${esc(link)}" target="_blank"><img src="${esc(t)}" width="254" alt="" style="display:block; width:100%; height:auto; border-radius:10px;"/></a></td>`).join('')}
</tr></table></td></tr>` : ''

  const why = d.why.length ? `<tr><td style="padding:26px 40px 0;" class="px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cream}" style="border-radius:14px; border-left:4px solid ${C.goldBtn};"><tr><td style="padding:20px 22px;">
<p style="margin:0 0 10px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:2.5px; text-transform:uppercase; color:${C.gold};">Why we thought of you</p>
${d.why.map((w) => `<p style="margin:0 0 6px; font-family:${SANS}; font-size:15px; line-height:22px; color:${C.ink};"><span style="color:${C.gold}; font-weight:bold;">&#10003;</span>&nbsp; ${esc(w)}</p>`).join('\n')}
</td></tr></table></td></tr>` : ''

  const highlights = d.highlights.length ? `<tr><td style="padding:28px 40px 0;" class="px">
<p style="margin:0 0 4px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:2.5px; text-transform:uppercase; color:${C.gold};">The highlights</p>
<p style="margin:0 0 14px; font-family:${SERIF}; font-size:24px; line-height:30px; color:${C.ink};">What we think <em style="color:${C.gold};">you’ll love</em></p>
${d.highlights.map((h) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};"><tr>
<td width="22" valign="top" style="padding:12px 0 12px; font-family:${SERIF}; font-size:18px; line-height:22px; color:${C.goldBtn};">&#9670;</td>
<td valign="top" style="padding:12px 0;"><p style="margin:0; font-family:${SANS}; font-size:15px; line-height:22px; color:${C.ink};">${esc(h.text)}</p>${h.note ? `<p style="margin:3px 0 0; font-family:${SERIF}; font-style:italic; font-size:13px; line-height:18px; color:${C.gold};">${esc(h.note)}</p>` : ''}</td>
</tr></table>`).join('\n')}
</td></tr>` : ''

  const summary = p.summary ? `<tr><td style="padding:26px 40px 0;" class="px"><p style="margin:0; font-family:${SERIF}; font-style:italic; font-size:17px; line-height:26px; color:${C.body};">“${esc(p.summary)}”</p></td></tr>` : ''

  const sellBand = needsToSell ? `<tr><td bgcolor="${C.dark}" align="center" style="padding:40px 40px;" class="px">
<p style="margin:0 0 10px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:3px; text-transform:uppercase; color:${C.goldBtn};">Need to sell first?</p>
<p style="margin:0 0 14px; font-family:${SERIF}; font-size:26px; line-height:32px; color:#FFFDF6;">Find out what your home is <em style="color:${C.goldBtn};">worth today.</em></p>
<p style="margin:0 0 22px; font-family:${SANS}; font-size:14px; line-height:22px; color:#B9B4A0;">Being sold or under offer puts you first in the queue with sellers. Our valuations are free and without obligation.</p>
${button(withUtm(p.valuationUrl, p.ref), 'Book my free valuation')}
</td></tr>` : ''

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(d.subject)}</title>
<style type="text/css">
body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; } table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; } body { margin:0 !important; padding:0 !important; width:100% !important; }
a { color:${C.gold}; }
@media screen and (max-width:640px) { .container { width:100% !important; max-width:100% !important; } .px { padding-left:22px !important; padding-right:22px !important; } .price { font-size:30px !important; } }
</style></head>
<body style="margin:0; padding:0; background-color:${C.page};">
<div style="display:none; font-size:1px; color:${C.page}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${esc(d.preheader)} &#8199;&#847; &#8199;&#847; &#8199;&#847; &#8199;&#847; &#8199;&#847; &#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">

<tr><td style="padding:4px 8px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><a href="${esc(withUtm(p.url.replace(/\/properties\/.*$/, '/'), p.ref))}" target="_blank" style="text-decoration:none;"><span style="font-family:${SANS}; font-size:15px; font-weight:bold; letter-spacing:3px; color:${C.ink};">PRESTON HILL</span><br/><span style="font-family:${SANS}; font-size:11px; letter-spacing:5px; color:${C.gold};">ESTATES</span></a></td>
<td valign="middle" align="right" style="font-family:${SANS}; font-size:11px; letter-spacing:2px; color:${C.gold};">EST. 2004 &middot; HARROW</td>
</tr></table></td></tr>

<tr><td bgcolor="${C.card}" style="border:1px solid ${C.line}; border-bottom:0; border-radius:18px 18px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:40px 40px 6px;" class="px">
<p style="margin:0 0 18px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:3px; text-transform:uppercase; color:${C.gold};">Chosen for ${esc(first)} &middot; ${let_ ? 'New to rent' : 'New to the market'}</p>
${paragraphs(d.message)}
</td></tr>
${heroImg}
<tr><td style="padding:22px 40px 0;" class="px">
<p class="price" style="margin:0; font-family:${SERIF}; font-size:36px; line-height:42px; color:${C.ink};">${esc(p.priceText)}</p>
<p style="margin:6px 0 0; font-family:${SANS}; font-size:15px; line-height:22px; color:${C.body};">${esc(p.address)}</p>
${p.specs.length ? `<p style="margin:10px 0 0; font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.faint};">${p.specs.map(esc).join(' &nbsp;&middot;&nbsp; ')}</p>` : ''}
</td></tr>
${thumbRow}
${why}
${highlights}
${summary}
<tr><td align="left" style="padding:30px 40px 8px;" class="px">${button(link, let_ ? 'See the photos & details' : 'View the property')}</td></tr>
<tr><td style="padding:8px 40px 36px;" class="px">
<p style="margin:0 0 22px; font-family:${SANS}; font-size:14px; line-height:22px; color:${C.body};">To book a viewing, reply to this email or call <a href="tel:+442081277001" style="color:${C.gold}; text-decoration:none; font-weight:bold;">${PHONE}</a>.</p>
<p style="margin:0; font-family:${SANS}; font-size:15px; line-height:22px; color:${C.ink};">Kind regards,</p>
<p style="margin:4px 0 0; font-family:${SERIF}; font-size:20px; line-height:26px; color:${C.ink};">${esc(s.name)}</p>
<p style="margin:2px 0 0; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">Preston Hill Estates &middot; ${esc(s.phone)}</p>
</td></tr>
</table></td></tr>
${sellBand}
<tr><td bgcolor="${C.card}" style="border:1px solid ${C.line}; border-top:0; border-radius:0 0 18px 18px; font-size:0; line-height:0; height:8px;">&nbsp;</td></tr>

<tr><td align="center" style="padding:28px 24px 6px;">
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.body};"><b>Preston Hill Estates</b> &middot; Est. 2004</p>
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">271 Preston Road, Harrow HA3 0PS</p>
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">Monday to Friday 9.00 to 17.30 &middot; Saturday 10.00 to 13.00</p>
<p style="margin:0 0 18px; font-family:${SANS}; font-size:13px; line-height:20px;"><a href="tel:+442081277001" style="color:${C.gold}; text-decoration:none;">${PHONE}</a> &middot; <a href="mailto:${esc(s.email)}" style="color:${C.gold}; text-decoration:none;">${esc(s.email)}</a></p>
<p style="margin:0 0 18px; font-family:${SANS}; font-size:10px; letter-spacing:2px; color:#B8B4A2;">THE PROPERTY OMBUDSMAN &middot; SAFEAGENT &middot; PRS &middot; MYDEPOSITS</p>
<p style="margin:0 0 6px; font-family:${SANS}; font-size:12px; line-height:18px; color:${C.faint};">You’re getting this because ${esc(because)}.</p>
<p style="margin:0 0 8px; font-family:${SANS}; font-size:12px; line-height:18px;"><a href="${esc(r.unsubscribeUrl)}" style="color:${C.faint};">Stop emails about homes like this</a></p>
<p style="margin:0; font-family:${SANS}; font-size:11px; color:#B8B4A2;">Preston Hill Estates Ltd &middot; Company No. 05058532</p>
</td></tr>
</table></td></tr></table>
</body></html>`

  const text = [
    d.message,
    '',
    `${p.priceText} · ${p.address}`,
    p.specs.join(' · '),
    '',
    d.why.length ? `Why we thought of you:\n${d.why.map((w) => `- ${w}`).join('\n')}\n` : '',
    d.highlights.length ? `The highlights:\n${d.highlights.map((h) => `- ${h.text}${h.note ? ` (${h.note})` : ''}`).join('\n')}\n` : '',
    `See the photos and details: ${link}`,
    '',
    `To book a viewing, reply to this email or call ${PHONE}.`,
    '',
    `Kind regards,\n${s.name}\nPreston Hill Estates · 271 Preston Road, Harrow HA3 0PS · ${PHONE}`,
    '',
    `You’re getting this because ${because}. To stop emails about homes like this: ${r.unsubscribeUrl}`,
  ].filter((x) => x !== null).join('\n')
  return { html, text }
}
