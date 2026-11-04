// Email campaigns (newsletters, new listings, landlord and market updates). Pure functions and data with no
// server imports, so the editor can show a live preview and the sender renders exactly the same email.
import { C, SANS, SERIF, button, esc, firstName, withUtm } from './property-email'

export type Role = 'buyer' | 'tenant' | 'landlord' | 'seller' | 'other'
export const ROLES: { value: Role; label: string; plural: string }[] = [
  { value: 'buyer', label: 'Buyer', plural: 'Buyers' },
  { value: 'tenant', label: 'Tenant', plural: 'Tenants' },
  { value: 'landlord', label: 'Landlord', plural: 'Landlords' },
  { value: 'seller', label: 'Seller', plural: 'Sellers' },
  { value: 'other', label: 'Other', plural: 'Everyone else' },
]

export type Audience = { roles: Role[]; areas: string; activeMonths: number | null }

export type Block =
  | { id: string; kind: 'letter'; title: string; body: string }
  | { id: string; kind: 'listings'; title: string; channel: 'auto' | 'sale' | 'let' | 'both'; ids: string[] | null; max: number }
  | { id: string; kind: 'market'; title: string; note: string }
  | { id: string; kind: 'article'; tag: string; headline: string; body: string; link: string; linkLabel: string; show: Role[]; checked: string | null }
  | { id: string; kind: 'guides'; title: string; slugs: string[] }
  | { id: string; kind: 'cta'; variant: 'auto' | 'valuation' | 'letting' | 'mortgage' | 'register' }

export type BlockKind = Block['kind']
export type Content = { subject: string; preheader: string; signedBy: string; blocks: Block[] }

/** One person, as far as the email is concerned. */
export type Reader = {
  contactId: string | null
  name: string
  email: string
  roles: Role[]
  outward: string | null
  areas: string | null
  budget: number | null
  minBeds: number | null
  position: string | null
  unsubscribeUrl: string
}

export type Listing = {
  id: string; url: string; photo: string | null; channel: 'sale' | 'let'; priceText: string; price: number | null
  address: string; headline: string; specs: string[]; beds: number | null; outward: string | null; place: string | null; publishedAt: string | null
}
export type Snapshot = { area: string; label: string; median: number | null; prevMedian: number | null; count: number; prevCount: number; byType: { label: string; median: number; count: number }[]; latest: string | null }
export type GuideLink = { slug: string; title: string; summary: string; url: string }
export type Shared = { base: string; listings: Listing[]; market: Record<string, Snapshot>; guides: GuideLink[]; credit: string }

const uid = () => Math.random().toString(36).slice(2, 10)
export const ALL_ROLES: Role[] = ['buyer', 'tenant', 'landlord', 'seller', 'other']

// ---------- starter articles ----------
// Checked against GOV.UK on 4 November 2026. Rules change: the editor asks staff to check before sending.

export type LibraryItem = Omit<Extract<Block, { kind: 'article' }>, 'id' | 'kind'> & { key: string }
export const NEWS_LIBRARY: LibraryItem[] = [
  {
    key: 'rra-landlords', tag: 'Law change', show: ['landlord'], checked: '2026-11-04',
    headline: 'Section 21 has gone: the new rules for landlords',
    body: 'Since 1 May 2026, “no-fault” Section 21 notices can no longer be served in England, and existing tenancies have become rolling periodic tenancies. To get a property back you now need one of the grounds in Section 8, such as selling or moving in yourself.\n\nRent can be put up once a year using the formal Section 13 notice, rental bidding is banned, and you can’t unreasonably refuse a tenant’s request to keep a pet. If you’d like us to check your tenancies and paperwork are up to date, just reply to this email.',
    link: 'https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector', linkLabel: 'The government’s guide',
  },
  {
    key: 'rra-database', tag: 'Coming up', show: ['landlord'], checked: '2026-11-04',
    headline: 'The new landlord database: what you’ll need to do',
    body: 'Every private landlord in England will have to register themselves and their rental properties on a new national database, for an annual fee. The government is rolling it out region by region, starting from late 2026, and a new landlord ombudsman follows after that.\n\nWe’ll let you know when registration opens for London. If we manage your property, we’ll help you get everything we hold on it ready.',
    link: 'https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector', linkLabel: 'Dates from GOV.UK',
  },
  {
    key: 'mtd', tag: 'Tax', show: ['landlord'], checked: '2026-11-04',
    headline: 'Making Tax Digital: are you in the next group?',
    body: 'Landlords and sole traders with more than £50,000 of qualifying income have had to keep digital records and send HMRC quarterly updates since April 2026. From 6 April 2027 it applies above £30,000, and from April 2028 above £20,000.\n\nThe figure is your gross rent plus any self-employed income, before expenses. If you’re close to £30,000, now is a good time to choose software or speak to your accountant.',
    link: 'https://www.gov.uk/government/publications/extension-of-making-tax-digital-for-income-tax-self-assessment-to-sole-traders-and-landlords/making-tax-digital-for-income-tax-self-assessment-for-sole-traders-and-landlords', linkLabel: 'HMRC guidance',
  },
  {
    key: 'rra-tenants', tag: 'Your rights', show: ['tenant'], checked: '2026-11-04',
    headline: 'Renting under the new rules',
    body: 'Since 1 May 2026, tenancies in England roll on month to month with no fixed end date, and landlords can no longer use “no-fault” evictions. You can leave by giving two months’ notice.\n\nRent can only go up once a year, with formal notice, and you can ask to keep a pet, which a landlord can’t unreasonably refuse. If you have questions about your tenancy with us, reply and we’ll help.',
    link: 'https://www.gov.uk/government/publications/renters-rights-act-2025-implementation-roadmap/implementing-the-renters-rights-act-2025-our-roadmap-for-reforming-the-private-rented-sector', linkLabel: 'More on GOV.UK',
  },
  {
    key: 'sdlt', tag: 'Buying', show: ['buyer'], checked: '2026-11-04',
    headline: 'What you’ll pay in stamp duty',
    body: 'In England, stamp duty starts above £125,000 for most buyers. First-time buyers pay nothing on the first £300,000, as long as the price is £500,000 or less. Buying an additional home, such as a buy-to-let, adds a 5% surcharge.\n\nOn a typical £550,000 home in Harrow, a home mover pays £17,500. Our borrowing calculator on the website shows what you could afford.',
    link: 'https://www.gov.uk/stamp-duty-land-tax/residential-property-rates', linkLabel: 'Rates on GOV.UK',
  },
  {
    key: 'selling-winter', tag: 'Selling', show: ['seller', 'landlord', 'other'], checked: null,
    headline: 'Is winter a good time to sell?',
    body: 'Fewer homes come on in the colder months, so the buyers who are looking are usually serious, and a well-presented home has less to compete with. Many are hoping to move by spring.\n\nIf you’re thinking about the new year, a valuation now gives you time to plan. It’s free and there’s no obligation.',
    link: '', linkLabel: '',
  },
  {
    key: 'local', tag: 'Local news', show: ALL_ROLES, checked: null,
    headline: 'News from Preston Road',
    body: 'Write a few lines about something happening locally: a new café on the parade, a school result, transport works, a planning decision or a community event.',
    link: '', linkLabel: '',
  },
]

export function fromLibrary(key: string): Block {
  const { key: _k, ...rest } = NEWS_LIBRARY.find((x) => x.key === key)!
  return { id: uid(), kind: 'article' as const, ...rest }
}

export function newBlock(kind: BlockKind): Block {
  const id = uid()
  switch (kind) {
    case 'letter': return { id, kind, title: 'News from *the Hill*', body: 'Hello {first_name},\n\nHere’s what’s been happening at the branch this month.' }
    case 'listings': return { id, kind, title: 'New to the market', channel: 'auto', ids: null, max: 4 }
    case 'market': return { id, kind, title: 'What homes are selling for', note: '' }
    case 'article': return { id, kind, tag: 'News', headline: '', body: '', link: '', linkLabel: 'Read more', show: ALL_ROLES, checked: null }
    case 'guides': return { id, kind, title: 'From our guides', slugs: [] }
    case 'cta': return { id, kind, variant: 'auto' }
  }
}

export const TEMPLATES: { key: string; name: string; about: string; audience: Audience; content: (signedBy: string) => Content }[] = [
  {
    key: 'newsletter', name: 'The Hill Report', about: 'Monthly newsletter: a note from the branch, homes picked for each reader, local prices, news and law changes for their situation.',
    audience: { roles: ALL_ROLES, areas: '', activeMonths: null },
    content: (signedBy) => ({
      subject: '{first_name}, this month on the Hill', preheader: 'New homes, local prices and what’s changing for buyers, renters and landlords.', signedBy,
      blocks: [
        { id: uid(), kind: 'letter', title: 'The Hill *Report*', body: 'Hello {first_name},\n\nHere’s our round-up from the branch at 271 Preston Road: homes we think you’ll like, what properties have been selling for nearby, and the changes worth knowing about.' },
        { id: uid(), kind: 'listings', title: 'Picked for you', channel: 'auto', ids: null, max: 4 },
        { id: uid(), kind: 'market', title: 'What homes are selling for', note: '' },
        fromLibrary('rra-landlords'), fromLibrary('rra-tenants'), fromLibrary('sdlt'), fromLibrary('selling-winter'),
        { id: uid(), kind: 'guides', title: 'From our guides', slugs: [] },
        { id: uid(), kind: 'cta', variant: 'auto' },
      ],
    }),
  },
  {
    key: 'listings', name: 'New homes this week', about: 'Your current homes for sale and to rent, ranked for each reader’s budget, area and bedrooms.',
    audience: { roles: ['buyer', 'tenant'], areas: '', activeMonths: 24 },
    content: (signedBy) => ({
      subject: 'New this week: homes we think you’ll like', preheader: 'Just listed with Preston Hill Estates, picked for what you told us you were looking for.', signedBy,
      blocks: [
        { id: uid(), kind: 'letter', title: 'New this *week*', body: 'Hello {first_name},\n\nA few homes have just come on with us that match what you’ve been looking for. The best ones go quickly, so if anything catches your eye, reply or call and we’ll book you in.' },
        { id: uid(), kind: 'listings', title: 'Just listed', channel: 'auto', ids: null, max: 6 },
        { id: uid(), kind: 'cta', variant: 'auto' },
      ],
    }),
  },
  {
    key: 'landlords', name: 'Landlord update', about: 'Rule changes and deadlines for landlords, local prices, and an offer to review their letting.',
    audience: { roles: ['landlord'], areas: '', activeMonths: null },
    content: (signedBy) => ({
      subject: 'Landlord update: what’s changed and what’s next', preheader: 'Section 21, the new landlord database and Making Tax Digital, in plain English.', signedBy,
      blocks: [
        { id: uid(), kind: 'letter', title: 'Landlord *update*', body: 'Hello {first_name},\n\nA lot has changed for landlords this year. Here’s a short, plain-English summary of where things stand and what’s coming next. If you’d like us to look over your tenancies, just reply.' },
        fromLibrary('rra-landlords'), fromLibrary('rra-database'), fromLibrary('mtd'),
        { id: uid(), kind: 'market', title: 'Local prices', note: '' },
        { id: uid(), kind: 'cta', variant: 'letting' },
      ],
    }),
  },
  {
    key: 'market', name: 'Market update', about: 'Local sold prices for each reader’s area and how they’ve moved, with a valuation offer for owners.',
    audience: { roles: ['seller', 'landlord', 'buyer', 'other'], areas: '', activeMonths: null },
    content: (signedBy) => ({
      subject: 'What homes near you have sold for', preheader: 'The latest Land Registry figures for your area, and how they compare with last year.', signedBy,
      blocks: [
        { id: uid(), kind: 'letter', title: 'Your local *market*', body: 'Hello {first_name},\n\nHere are the latest official sold prices for your area, and how they compare with a year ago. If you’d like to know what your own home is worth today, we’re always happy to come round.' },
        { id: uid(), kind: 'market', title: 'What homes are selling for', note: '' },
        { id: uid(), kind: 'listings', title: 'On the market with us', channel: 'auto', ids: null, max: 3 },
        { id: uid(), kind: 'cta', variant: 'valuation' },
      ],
    }),
  },
  {
    key: 'blank', name: 'Start from scratch', about: 'A letter and a call to action. Add listings, prices, news and guides as you like.',
    audience: { roles: ALL_ROLES, areas: '', activeMonths: null },
    content: (signedBy) => ({ subject: '', preheader: '', signedBy, blocks: [newBlock('letter'), newBlock('cta')] }),
  },
]

// ---------- choosing what each reader sees ----------

export const primaryRole = (r: Pick<Reader, 'roles'>): Role =>
  (['landlord', 'seller', 'buyer', 'tenant'] as Role[]).find((x) => r.roles.includes(x)) ?? 'other'
export const readerRoles = (r: Pick<Reader, 'roles'>): Role[] => (r.roles.length ? r.roles : ['other'])
export const showsTo = (show: Role[], r: Pick<Reader, 'roles'>) => readerRoles(r).some((x) => show.includes(x))

type Picked = Listing & { forYou: string | null }

/** The listings for one reader: the right kind (sale or rent), best fit for their budget, area and bedrooms first. */
export function listingsFor(b: Extract<Block, { kind: 'listings' }>, r: Reader, all: Listing[]): Picked[] {
  const roles = readerRoles(r)
  const pool = all.filter((l) => !b.ids || b.ids.includes(l.id))
  const want: ('sale' | 'let')[] = b.channel === 'sale' ? ['sale'] : b.channel === 'let' ? ['let'] : b.channel === 'both' ? ['sale', 'let']
    : roles.includes('buyer') || roles.includes('seller') ? (roles.includes('tenant') ? ['sale', 'let'] : ['sale'])
      : roles.includes('tenant') || roles.includes('landlord') ? ['let'] : ['sale', 'let']
  let list = pool.filter((l) => want.includes(l.channel))
  if (!list.length) list = pool
  const areas = (r.areas ?? '').toLowerCase()
  const scored = list.map((l) => {
    let s = 0
    const why: string[] = []
    // Sale budgets are in the hundreds of thousands, rent budgets per month: only compare like with like.
    if (r.budget && l.price && (l.channel === 'sale') === (r.budget > 20000)) {
      if (l.price <= r.budget) { s += 3; why.push('Within your budget') } else if (l.price > r.budget * 1.2) s -= 4
    }
    if (l.outward && (r.outward === l.outward || areas.toUpperCase().includes(l.outward))) { s += 3; why.push(l.place ? `${l.place}, ${l.outward}` : l.outward) }
    else if (l.place && areas.includes(l.place.toLowerCase())) { s += 2; why.push(l.place) }
    if (r.minBeds && l.beds != null) { if (l.beds >= r.minBeds) { s += 1; why.push(`${l.beds} bed${l.beds === 1 ? '' : 's'}`) } else s -= 2 }
    return { ...l, s, forYou: s >= 3 ? why.slice(0, 2).join(' · ') : null }
  })
  scored.sort((a, b2) => b2.s - a.s || (b2.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
  return scored.slice(0, Math.max(1, Math.min(b.max, 8)))
}

export function snapshotFor(r: Reader, market: Record<string, Snapshot>): Snapshot | null {
  return (r.outward && market[r.outward]?.median ? market[r.outward] : null) ?? market.ALL ?? null
}

export function ctaFor(variant: Extract<Block, { kind: 'cta' }>['variant'], r: Reader): Exclude<typeof variant, 'auto'> {
  if (variant !== 'auto') return variant
  const roles = readerRoles(r)
  if (roles.includes('landlord')) return 'letting'
  if (roles.includes('seller') || /property to sell|under offer on theirs/i.test(r.position ?? '')) return 'valuation'
  if (roles.includes('buyer')) return 'mortgage'
  if (roles.includes('tenant')) return 'register'
  return 'valuation'
}

/** Replaces {first_name} and friends. */
export function personalise(text: string, r: Reader) {
  const first = r.name ? firstName(r.name) : ''
  return text.replace(/\{first_name\}/g, first || 'there').replace(/\{name\}/g, r.name || 'there')
}

// ---------- rendering ----------

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
const pct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10
/** "The Hill *Report*": words in asterisks become gold italics. */
const fancy = (t: string) => esc(t).replace(/\*([^*]+)\*/g, `<em style="color:${C.gold};">$1</em>`)
const eyebrow = (t: string, color: string = C.gold) => `<p style="margin:0 0 10px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:2.5px; text-transform:uppercase; color:${color};">${esc(t)}</p>`
const para = (t: string, color: string = C.body, size = 15) => t.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)
  .map((x) => `<p style="margin:0 0 14px; font-family:${SANS}; font-size:${size}px; line-height:${Math.round(size * 1.6)}px; color:${color};">${esc(x).replace(/\n/g, '<br/>')}</p>`).join('')
const section = (inner: string, bg: string = C.card, pad = '34px 40px') => `<tr><td bgcolor="${bg}" class="px" style="padding:${pad}; border-left:1px solid ${C.line}; border-right:1px solid ${C.line};">${inner}</td></tr>`
const rule = `<tr><td bgcolor="${C.card}" style="padding:0 40px; border-left:1px solid ${C.line}; border-right:1px solid ${C.line};" class="px"><div style="border-top:1px solid ${C.line}; height:1px; line-height:1px; font-size:0;">&nbsp;</div></td></tr>`

function listingCard(l: Picked, campaign: string, big: boolean) {
  const link = withUtm(l.url, campaign, 'newsletter')
  const img = l.photo ? `<a href="${esc(link)}" target="_blank"><img src="${esc(l.photo)}" width="${big ? 520 : 250}" alt="${esc(l.address)}" style="display:block; width:100%; height:auto; border-radius:${big ? 12 : 10}px
${big ? 12 : 10}px 0 0;"/></a>` : ''
  const badge = l.forYou ? `<p style="margin:0 0 8px;"><span style="display:inline-block; padding:4px 10px; border-radius:999px; background:#F7F0DE; font-family:${SANS}; font-size:10px; font-weight:bold; letter-spacing:1.5px; text-transform:uppercase; color:${C.gold};">Picked for you &middot; ${esc(l.forYou)}</span></p>` : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="border:1px solid ${C.line}; border-radius:${big ? 12 : 10}px;"><tr><td>${img}</td></tr>
<tr><td style="padding:${big ? '20px 22px 22px' : '14px 16px 16px'};">${badge}
<p style="margin:0; font-family:${SERIF}; font-size:${big ? 26 : 19}px; line-height:${big ? 32 : 24}px; color:${C.ink};">${esc(l.priceText)}</p>
<p style="margin:4px 0 0; font-family:${SANS}; font-size:${big ? 14 : 13}px; line-height:20px; color:${C.body};">${esc(l.address)}</p>
${l.specs.length ? `<p style="margin:8px 0 0; font-family:${SANS}; font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:${C.faint};">${l.specs.slice(0, big ? 5 : 3).map(esc).join(' &middot; ')}</p>` : ''}
${big ? `<div style="height:16px; line-height:16px; font-size:0;">&nbsp;</div>${button(link, 'View property')}` : `<p style="margin:12px 0 0; font-family:${SANS}; font-size:12px; font-weight:bold; letter-spacing:2px; text-transform:uppercase;"><a href="${esc(link)}" target="_blank" style="color:${C.gold}; text-decoration:none;">View &rarr;</a></p>`}
</td></tr></table>`
}

function renderBlock(b: Block, r: Reader, s: Shared, campaign: string, first: boolean): string {
  switch (b.kind) {
    case 'letter':
      return section(`<p style="margin:0 0 18px; font-family:${SERIF}; font-size:40px; line-height:46px; color:${C.ink};" class="masthead">${fancy(personalise(b.title, r))}</p>${para(personalise(b.body, r))}`, C.card, first ? '40px 40px 20px' : '30px 40px 16px')
    case 'listings': {
      const picks = listingsFor(b, r, s.listings)
      if (!picks.length) return ''
      const [top, ...rest] = picks
      const rows: string[] = []
      for (let i = 0; i < rest.length; i += 2) {
        const pair = rest.slice(i, i + 2)
        rows.push(`<tr>${pair.map((l, j) => `<td class="stack" width="50%" valign="top" style="padding:${j ? '0 0 16px 8px' : '0 8px 16px 0'};">${listingCard(l, campaign, false)}</td>`).join('')}${pair.length === 1 ? '<td class="stack" width="50%">&nbsp;</td>' : ''}</tr>`)
      }
      const let_ = picks.every((l) => l.channel === 'let')
      return section(`${eyebrow(let_ ? 'To rent with us' : picks.some((l) => l.channel === 'let') ? 'For sale & to rent' : 'For sale with us')}
<p style="margin:0 0 20px; font-family:${SERIF}; font-size:28px; line-height:34px; color:${C.ink};">${fancy(personalise(b.title, r))}</p>
${listingCard(top, campaign, true)}
${rows.length ? `<div style="height:16px; line-height:16px; font-size:0;">&nbsp;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>` : ''}
<p style="margin:${rows.length ? 0 : 18}px 0 0; font-family:${SANS}; font-size:13px;"><a href="${esc(withUtm(`${s.base}/properties`, campaign, 'newsletter'))}" target="_blank" style="color:${C.gold}; font-weight:bold; text-decoration:none;">See everything we have on &rarr;</a></p>`, C.cream)
    }
    case 'market': {
      const m = snapshotFor(r, s.market)
      if (!m || !m.median) return ''
      const change = m.prevMedian ? pct(m.median, m.prevMedian) : null
      const stat = (big: string, small: string) => `<td class="stack" width="33%" valign="top" style="padding:0 6px 14px;"><p style="margin:0; font-family:${SERIF}; font-size:28px; line-height:34px; color:#FFFDF6;">${big}</p><p style="margin:4px 0 0; font-family:${SANS}; font-size:12px; line-height:17px; color:#B9B4A0;">${small}</p></td>`
      return `<tr><td bgcolor="${C.dark}" class="px" style="padding:36px 40px;">
${eyebrow(`Market snapshot · ${m.label}`, C.goldBtn)}
<p style="margin:0 0 22px; font-family:${SERIF}; font-size:28px; line-height:34px; color:#FFFDF6;">${fancy(b.title)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -6px;"><tr>
${stat(gbp(m.median), 'Typical sold price, last 12 months')}
${stat(change == null ? '—' : `${change > 0 ? '+' : ''}${change}%`, change == null ? 'Change on a year ago' : `On a year ago (${gbp(m.prevMedian!)})`)}
${stat(m.count.toLocaleString('en-GB'), 'Homes sold in the last 12 months')}
</tr></table>
${m.byType.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">${m.byType.map((t) => `<tr><td style="padding:9px 0; border-top:1px solid #3A372C; font-family:${SANS}; font-size:14px; color:#E9E5D6;">${esc(t.label)}</td><td align="right" style="padding:9px 0; border-top:1px solid #3A372C; font-family:${SERIF}; font-size:16px; color:#FFFDF6;">${gbp(t.median)}</td></tr>`).join('')}</table>` : ''}
${b.note.trim() ? `<div style="height:14px;"></div>${para(personalise(b.note, r), '#E9E5D6', 14)}` : ''}
<p style="margin:18px 0 0; font-family:${SANS}; font-size:13px;"><a href="${esc(withUtm(`${s.base}/sold-prices`, campaign, 'newsletter'))}" target="_blank" style="color:${C.goldBtn}; font-weight:bold; text-decoration:none;">See sold prices on your street &rarr;</a></p>
<p style="margin:14px 0 0; font-family:${SANS}; font-size:10px; line-height:15px; color:#8F8A76;">Medians of HM Land Registry sales${m.latest ? ` recorded up to ${esc(m.latest)}` : ''}. ${esc(s.credit)}</p>
</td></tr>`
    }
    case 'article':
      if (!showsTo(b.show, r) || !b.headline.trim()) return ''
      return section(`${eyebrow(b.tag || 'News')}<p style="margin:0 0 12px; font-family:${SERIF}; font-size:23px; line-height:30px; color:${C.ink};">${fancy(personalise(b.headline, r))}</p>${para(personalise(b.body, r))}${b.link ? `<p style="margin:0; font-family:${SANS}; font-size:13px;"><a href="${esc(b.link)}" target="_blank" style="color:${C.gold}; font-weight:bold; text-decoration:none;">${esc(b.linkLabel || 'Read more')} &rarr;</a></p>` : ''}`, C.card, '28px 40px 20px')
    case 'guides': {
      const gs = (b.slugs.length ? s.guides.filter((g) => b.slugs.includes(g.slug)) : s.guides).slice(0, 3)
      if (!gs.length) return ''
      return section(`${eyebrow('Free guides')}<p style="margin:0 0 14px; font-family:${SERIF}; font-size:23px; line-height:30px; color:${C.ink};">${fancy(b.title)}</p>
${gs.map((g) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};"><tr><td style="padding:14px 0;">
<a href="${esc(withUtm(g.url, campaign, 'newsletter'))}" target="_blank" style="font-family:${SANS}; font-size:15px; font-weight:bold; color:${C.ink}; text-decoration:none;">${esc(g.title)} <span style="color:${C.gold};">&rarr;</span></a>
<p style="margin:4px 0 0; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">${esc(g.summary)}</p></td></tr></table>`).join('')}`, C.card, '28px 40px 20px')
    }
    case 'cta': {
      const v = ctaFor(b.variant, r)
      const c = {
        valuation: { eye: 'Thinking of selling?', h: 'Find out what your home is <em style="color:#C4972F;">worth today.</em>', p: 'A considered figure from people who have valued homes on your street for two decades. Free, and without obligation.', btn: 'Book my free valuation', url: `${s.base}/valuation` },
        letting: { eye: 'For landlords', h: 'What could your property <em style="color:#C4972F;">rent for?</em>', p: 'A free rental valuation and an honest view of what the new rules mean for your letting, from the branch on Preston Road.', btn: 'Get a rental valuation', url: `${s.base}/valuation?intent=letting` },
        mortgage: { eye: 'Buying?', h: 'How much could you <em style="color:#C4972F;">borrow?</em>', p: 'Our calculator gives you a quick idea in a minute, and tells us what you’re looking for so we can send you the right homes first.', btn: 'Try the calculator', url: `${s.base}/mortgage-calculator` },
        register: { eye: 'Looking to rent?', h: 'Tell us what you’re <em style="color:#C4972F;">looking for.</em>', p: 'Good rentals often let before they reach the portals. Reply with your budget, area and move date and we’ll call you first.', btn: 'See homes to rent', url: `${s.base}/properties?channel=let` },
      }[v]
      return `<tr><td bgcolor="${C.dark}" align="center" class="px" style="padding:40px 40px;">${eyebrow(c.eye, C.goldBtn)}
<p style="margin:0 0 14px; font-family:${SERIF}; font-size:28px; line-height:34px; color:#FFFDF6;">${c.h}</p>
<p style="margin:0 0 22px; font-family:${SANS}; font-size:14px; line-height:22px; color:#B9B4A0;">${esc(c.p)}</p>
${button(withUtm(c.url, campaign, 'newsletter'), c.btn)}
<p style="margin:16px 0 0; font-family:${SANS}; font-size:13px; color:#98937F;">Or call the branch: <a href="tel:+442081277001" style="color:${C.goldBtn}; text-decoration:none;">020 8127 7001</a></p></td></tr>`
    }
  }
}

export type CampaignSender = { email: string }

export function renderCampaign(c: Content, r: Reader, s: Shared, opts: { campaign: string; sender: CampaignSender; month: string }): { subject: string; html: string; text: string } {
  const subject = personalise(c.subject || 'News from Preston Hill Estates', r).slice(0, 150)
  const pre = personalise(c.preheader, r)
  const body = c.blocks.map((b, i) => renderBlock(b, r, s, opts.campaign, i === 0)).filter(Boolean)
  // A thin line between two white sections so they don't run together.
  const white = (h: string) => h.startsWith(`<tr><td bgcolor="${C.card}"`)
  const joined = body.map((h, i) => (i && white(h) && white(body[i - 1]) ? rule + h : h)).join('\n')
  const sign = c.signedBy.trim() ? section(`<p style="margin:0; font-family:${SANS}; font-size:15px; color:${C.ink};">With best wishes,</p><p style="margin:4px 0 0; font-family:${SERIF}; font-size:20px; color:${C.ink};">${esc(c.signedBy)}</p><p style="margin:2px 0 0; font-family:${SANS}; font-size:13px; color:${C.faint};">Preston Hill Estates &middot; 020 8127 7001</p>`, C.card, '24px 40px 34px') : ''
  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(subject)}</title>
<style type="text/css">
body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; } table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; } body { margin:0 !important; padding:0 !important; width:100% !important; }
a { color:${C.gold}; }
@media screen and (max-width:640px) { .container { width:100% !important; max-width:100% !important; } .px { padding-left:22px !important; padding-right:22px !important; }
 .stack { display:block !important; width:100% !important; padding-left:0 !important; padding-right:0 !important; } .masthead { font-size:34px !important; line-height:40px !important; } }
</style></head>
<body style="margin:0; padding:0; background-color:${C.page};">
<div style="display:none; font-size:1px; color:${C.page}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${esc(pre)} &#8199;&#847; &#8199;&#847; &#8199;&#847; &#8199;&#847; &#8199;&#847; &#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
<tr><td style="padding:4px 8px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><a href="${esc(withUtm(`${s.base}/`, opts.campaign, 'newsletter'))}" target="_blank" style="text-decoration:none;"><span style="font-family:${SANS}; font-size:15px; font-weight:bold; letter-spacing:3px; color:${C.ink};">PRESTON HILL</span><br/><span style="font-family:${SANS}; font-size:11px; letter-spacing:5px; color:${C.gold};">ESTATES</span></a></td>
<td valign="middle" align="right" style="font-family:${SANS}; font-size:11px; letter-spacing:2px; color:${C.gold}; text-transform:uppercase;">${esc(opts.month)}</td>
</tr></table></td></tr>
<tr><td style="font-size:0; line-height:0; height:14px; border:1px solid ${C.line}; border-bottom:0; border-radius:18px 18px 0 0;" bgcolor="${C.card}">&nbsp;</td></tr>
${joined}
${sign}
<tr><td style="font-size:0; line-height:0; height:10px; border:1px solid ${C.line}; border-top:0; border-radius:0 0 18px 18px;" bgcolor="${C.card}">&nbsp;</td></tr>
<tr><td align="center" style="padding:28px 24px 6px;">
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.body};"><b>Preston Hill Estates</b> &middot; Est. 2004</p>
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">271 Preston Road, Harrow HA3 0PS</p>
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">Monday to Friday 9.00 to 17.30 &middot; Saturday 10.00 to 13.00</p>
<p style="margin:0 0 18px; font-family:${SANS}; font-size:13px; line-height:20px;"><a href="tel:+442081277001" style="color:${C.gold}; text-decoration:none;">020 8127 7001</a> &middot; <a href="mailto:${esc(opts.sender.email)}" style="color:${C.gold}; text-decoration:none;">${esc(opts.sender.email)}</a></p>
<p style="margin:0 0 18px; font-family:${SANS}; font-size:10px; letter-spacing:2px; color:#B8B4A2;">THE PROPERTY OMBUDSMAN &middot; SAFEAGENT &middot; PRS &middot; MYDEPOSITS</p>
<p style="margin:0 0 6px; font-family:${SANS}; font-size:12px; line-height:18px; color:${C.faint};">You’re getting this because you’ve been in touch with Preston Hill Estates about buying, selling, renting or letting a home.</p>
<p style="margin:0 0 8px; font-family:${SANS}; font-size:12px; line-height:18px;"><a href="${esc(r.unsubscribeUrl)}" style="color:${C.faint};">Unsubscribe from our emails</a></p>
<p style="margin:0; font-family:${SANS}; font-size:11px; color:#B8B4A2;">Preston Hill Estates Ltd &middot; Company No. 05058532</p>
</td></tr></table></td></tr></table></body></html>`
  return { subject, html, text: textVersion(c, r, s, opts.campaign) }
}

function textVersion(c: Content, r: Reader, s: Shared, campaign: string) {
  const out: string[] = []
  for (const b of c.blocks) {
    if (b.kind === 'letter') out.push(personalise(b.title, r).replace(/\*/g, '').toUpperCase(), '', personalise(b.body, r))
    else if (b.kind === 'listings') {
      const picks = listingsFor(b, r, s.listings)
      if (picks.length) out.push(personalise(b.title, r).replace(/\*/g, '').toUpperCase(), ...picks.map((l) => `- ${l.priceText} · ${l.address}${l.forYou ? ` (picked for you: ${l.forYou})` : ''}\n  ${withUtm(l.url, campaign, 'newsletter')}`))
    } else if (b.kind === 'market') {
      const m = snapshotFor(r, s.market)
      if (m?.median) out.push(`MARKET SNAPSHOT · ${m.label.toUpperCase()}`, `Typical sold price, last 12 months: ${gbp(m.median)}${m.prevMedian ? ` (${pct(m.median, m.prevMedian) > 0 ? '+' : ''}${pct(m.median, m.prevMedian)}% on a year ago)` : ''}. Homes sold: ${m.count}.`, s.credit)
    } else if (b.kind === 'article' && showsTo(b.show, r) && b.headline.trim()) out.push(`${(b.tag || 'News').toUpperCase()}: ${personalise(b.headline, r)}`, '', personalise(b.body, r), b.link ? `${b.linkLabel || 'Read more'}: ${b.link}` : '')
    else if (b.kind === 'guides') {
      const gs = (b.slugs.length ? s.guides.filter((g) => b.slugs.includes(g.slug)) : s.guides).slice(0, 3)
      if (gs.length) out.push('FROM OUR GUIDES', ...gs.map((g) => `- ${g.title}: ${g.url}`))
    } else if (b.kind === 'cta') out.push(`Call the branch on 020 8127 7001, or visit ${s.base}/valuation for a free valuation.`)
    out.push('')
  }
  if (c.signedBy.trim()) out.push('With best wishes,', c.signedBy, 'Preston Hill Estates · 271 Preston Road, Harrow HA3 0PS · 020 8127 7001', '')
  out.push('You’re getting this because you’ve been in touch with Preston Hill Estates about buying, selling, renting or letting a home.', `Unsubscribe: ${r.unsubscribeUrl}`)
  return out.join('\n')
}
