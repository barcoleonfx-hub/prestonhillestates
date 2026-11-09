// Ready-made emails for answering an enquiry: valuations (sales and lettings), buyers and tenants. Pure functions
// with no server imports, so the enquiry page shows a live preview while staff edit the wording, and the server
// sends exactly the same email.
//
// Each email is a short personal message (which staff can edit) set inside a designed layout that makes the case
// for Preston Hill Estates with facts only: on Preston Road since 2004, founder-led, every home on Zoopla,
// OnTheMarket and our own website, buyers and tenants on our books emailed first, viewings done by the branch,
// real sold prices from HM Land Registry, real Google reviews, and the schemes we belong to. Nothing invented.

import { C, SANS, SERIF, esc, firstName, withUtm, type Rendered, type Sender } from './property-email'
import { LETTINGS } from './site'

export type EnquiryEmailKind = 'sales-valuation' | 'lettings-valuation' | 'buyer' | 'tenant'

type QuotedReview = { text: string; name: string; date?: string }
export type EnquiryEmailContext = {
  kind: EnquiryEmailKind
  name: string
  /** Their home (valuations) or the listing they asked about. */
  address: string | null
  postcode: string | null
  property: { url: string; address: string; priceText: string; photo: string | null; specs: string[] } | null
  /** Recent sales near a valuation's postcode, from HM Land Registry. */
  sold: { where: string; type: string; price: string; when: string }[]
  base: string
  sender: Sender
  /** Comparable homes staff noted in the valuation check, and the figure they settled on. */
  evidence?: { where: string; price: string; what: string }[]
  figure?: string
  /** Our Google rating and a real review for each side of the business (4 or 5 stars, chosen in the portal). */
  brand?: { rating: number | null; count: number | null; reviewsUrl: string | null; sales: QuotedReview | null; lettings: QuotedReview | null }
  /** Their personal property report (the valuation booklet at its private link), and a photo of their home from above. */
  report?: { url: string; image: string } | null
}
export type EnquiryEmailExtra = { when?: string; times?: string; figure?: string; attached?: boolean }

type Section =
  | 'stats' | 'valuation-steps' | 'letting-steps' | 'sold' | 'evidence' | 'figure' | 'appointment' | 'why-sell' | 'why-let'
  | 'sell-plan' | 'landlord' | 'rra' | 'landlord-docs' | 'seller-docs' | 'review' | 'founder' | 'schemes' | 'property'
  | 'tenant-docs' | 'buyer-help' | 'tenant-help' | 'offer-steps' | 'report' | 'meet'

export type EnquiryTemplate = {
  key: string
  label: string
  hint: string
  /** A detail staff fill in: the booked time, the times to offer, or the valuation. */
  needs?: 'when' | 'times' | 'figure'
  subject: (c: EnquiryEmailContext, x: EnquiryEmailExtra) => string
  message: (c: EnquiryEmailContext, x: EnquiryEmailExtra) => string
  kicker: string
  /** The big line at the top of the email. */
  headline: (c: EnquiryEmailContext, x: EnquiryEmailExtra) => string
  photo: 'shopfront' | 'property' | 'report'
  sections: Section[]
  cta?: (c: EnquiryEmailContext) => { href: string; label: string } | null
}

const PHONE = '020 8904 9005'
const SINCE = 2004
const years = () => new Date().getFullYear() - SINCE
const first = (c: EnquiryEmailContext) => firstName(c.name)
const hello = (c: EnquiryEmailContext) => `Hello ${first(c)},`
const at = (c: EnquiryEmailContext) => (c.address ? ` at ${c.address}` : c.postcode ? ` in ${c.postcode}` : '')
const about = (c: EnquiryEmailContext) => c.property?.address ?? c.address ?? 'the property'
const WHEN = '[day and time]'
const TIMES = '[the times you can offer]'
const FIGURE = '[your valuation]'
const area = (c: EnquiryEmailContext) => (c.postcode ? c.postcode.split(' ')[0] : 'your area')
const fig = (c: EnquiryEmailContext, x: EnquiryEmailExtra) => x.figure || c.figure || FIGURE
const isPostcode = (s: string) => /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(s.trim())
const book = (c: EnquiryEmailContext, what: string) => ({ href: `mailto:${c.sender.email}?subject=${encodeURIComponent(what)}`, label: 'Reply to book a time' })

// ---------- the emails ----------

const confirmValuation = (letting: boolean): EnquiryTemplate => ({
  key: 'confirm', label: 'Confirm the appointment', hint: 'Once you’ve booked a time.', needs: 'when',
  kicker: letting ? 'Your rental valuation' : 'Your valuation', photo: 'shopfront',
  headline: (c, x) => `We’ll see you ${x.when ? `on ${x.when}` : 'soon'}.`,
  subject: (c, x) => `Your ${letting ? 'rental ' : ''}valuation is booked: ${x.when || WHEN}`,
  message: (c, x) => [
    hello(c),
    `Thank you for booking your ${letting ? 'rental ' : ''}valuation${at(c)}. This is to confirm we’ll be with you on ${x.when || WHEN}.`,
    letting
      ? 'We’ll look round with you, tell you what rent to expect and what (if anything) needs doing before it’s let, and talk you through how we’d look after it. It usually takes about half an hour.'
      : 'We’ll look round with you, talk through what you’d like to do and when, and give you our honest view of what your home is worth and how we’d sell it. It usually takes 30 to 45 minutes.',
    `If you need to change the time, just reply to this email or call us on ${PHONE}.`,
  ].join('\n\n'),
  sections: letting ? ['appointment', 'landlord-docs', 'letting-steps', 'review'] : ['appointment', 'seller-docs', 'valuation-steps', 'review'],
})

const arrangeViewing = (letting: boolean): EnquiryTemplate => ({
  key: 'arrange', label: 'Offer viewing times', hint: 'Suggest a few times and let them pick.', needs: 'times',
  kicker: 'Arrange a viewing', photo: 'property',
  headline: (c) => `Come and see ${about(c)}.`,
  subject: (c) => `Viewing ${about(c)}`,
  message: (c, x) => [
    hello(c),
    `Thank you for your interest in ${about(c)}. We can show you round at any of these times:`,
    x.times || TIMES,
    'Just reply with the one that suits you best and we’ll confirm it. If none of them work, tell us when you’re free and we’ll fit around you.',
    letting ? 'Good homes to rent here tend to go quickly, so the sooner the better.' : '',
  ].filter(Boolean).join('\n\n'),
  sections: ['property', letting ? 'tenant-help' : 'buyer-help'],
})

const confirmViewing = (letting: boolean): EnquiryTemplate => ({
  key: 'confirm', label: 'Confirm the viewing', hint: 'Once a time is agreed.', needs: 'when',
  kicker: 'Viewing confirmed', photo: 'property',
  headline: (c, x) => `See you ${x.when ? `on ${x.when}` : 'soon'}.`,
  subject: (c, x) => `Viewing confirmed: ${x.when || WHEN}`,
  message: (c, x) => [
    hello(c),
    `This is to confirm your viewing of ${about(c)} on ${x.when || WHEN}. We’ll meet you at the property and show you round ourselves.`,
    letting
      ? 'If you like it, we can take a holding deposit (no more than one week’s rent) on the day to take it off the market while we do the referencing.'
      : 'If you have a mortgage agreement in principle, or details of a home you’re selling, bring them along: it helps if you decide to make an offer.',
    `If anything changes, just reply to this email or call us on ${PHONE}.`,
  ].join('\n\n'),
  sections: letting ? ['appointment', 'property', 'tenant-docs'] : ['appointment', 'property', 'offer-steps'],
})

/** The first email for a valuation: their personal property report, what we're about, and an invitation to meet. */
const reportEmail = (letting: boolean): EnquiryTemplate => ({
  key: 'report', label: 'Their property report', hint: 'Recommended first email: their personal report, who we are, and an invitation to meet.',
  kicker: 'Your personal property report', photo: 'report',
  headline: (c) => `${first(c)}, we’ve made something for you.`,
  subject: (c) => `${first(c)}, your personal property report${c.address && !isPostcode(c.address) ? ` for ${c.address}` : ''}`,
  message: (c) => [
    hello(c),
    `Thank you for asking us about ${letting ? 'letting your property' : 'your home'}${at(c)}. Rather than send you a standard reply, we’ve put together a personal report, just for ${letting ? 'your property' : 'your home'}.`,
    letting
      ? 'It shows what tenants will love about where it is, what similar homes nearby let for, how letting with us works, and what our landlords say about us.'
      : 'It shows what buyers will love about where you live, your home’s story, what similar homes nearby have actually sold for, and exactly how we’d sell it.',
    letting
      ? 'An online report is a good start, but the rent a property achieves comes down to things only a visit shows. Give us half an hour at a time that suits you and we’ll tell you exactly what to expect. It’s free, with no obligation.'
      : 'An online figure is a good start, but it can’t see your new kitchen, the extension or the garden, and that’s what buyers pay for. Give us 30 to 45 minutes at a time that suits you and we’ll give you an accurate figure, with the evidence. It’s free, with no obligation.',
    `Just reply with a day and time that works for you, or call us on ${PHONE}.`,
  ].join('\n\n'),
  cta: (c) => (c.report ? { href: c.report.url, label: 'Open your report' } : book(c, 'Booking a valuation')),
  sections: letting ? ['report', 'landlord', 'review', 'meet', 'schemes'] : ['report', 'why-sell', 'review', 'meet', 'founder', 'schemes'],
})

export const ENQUIRY_TEMPLATES: Record<EnquiryEmailKind, EnquiryTemplate[]> = {
  'sales-valuation': [
    reportEmail(false),
    {
      key: 'thanks', label: 'Thank you + book a valuation', hint: 'The first reply: who we are, what happens, and when to visit.',
      kicker: 'Your free valuation', photo: 'shopfront',
      headline: () => 'Let’s find out what your home is really worth.',
      subject: (c) => `${first(c)}, let’s find out what your home is worth`,
      message: (c) => [
        hello(c),
        `Thank you for asking us to value your home${at(c)}. We’d love to come and see it.`,
        `We’ve been selling homes from our branch on Preston Road since ${SINCE}, so we know ${area(c)} street by street: what buyers are paying right now, which roads they ask for, and what makes a home sell well. You’ll get an honest figure, not a flattering one, and a clear plan for getting there.`,
        `When would suit you? Just reply with a day and time, or call us on ${PHONE}, and we’ll book you in. It’s free, and there’s no obligation.`,
      ].join('\n\n'),
      sections: ['stats', 'valuation-steps', 'sold', 'why-sell', 'review', 'founder', 'schemes'],
      cta: (c) => book(c, 'Booking my valuation'),
    },
    confirmValuation(false),
    {
      key: 'result', label: 'Your valuation', hint: 'After the visit: the figure, the evidence and our plan.', needs: 'figure',
      kicker: 'Your valuation', photo: 'shopfront',
      headline: (c, x) => `Your home: ${fig(c, x)}.`,
      subject: (c) => `Your valuation${c.address ? `: ${c.address}` : ''}`,
      message: (c, x) => [
        hello(c),
        `Thank you for showing us round${at(c)}. It was good to meet you.`,
        `Having looked at your home, at what’s sold nearby recently and at similar homes on the market now, we’d put its value at ${fig(c, x)}.`,
        'Below are some of the homes we compared it with, and how we’d go about selling it. We’d be glad to talk you through the asking price we’d suggest and the timing that suits you.',
        `When you’re ready, or if you have any questions at all, just reply to this email or call us on ${PHONE}.`,
      ].join('\n\n'),
      sections: ['figure', 'evidence', 'sell-plan', 'why-sell', 'review', 'founder'],
      cta: (c) => ({ href: `mailto:${c.sender.email}?subject=${encodeURIComponent('Selling my home')}`, label: 'I’d like to go ahead' }),
    },
    {
      key: 'follow', label: 'Follow up', hint: 'If you haven’t heard back.',
      kicker: 'Still thinking of selling?', photo: 'shopfront',
      headline: () => 'Know what your home is worth today.',
      subject: (c) => `${first(c)}, still thinking of selling?`,
      message: (c) => [
        hello(c),
        `I wanted to follow up on your request for a valuation${at(c)}. Would now be a good time for us to come round?`,
        'Even if you’re not planning to move for a while, knowing what your home is worth today helps you plan. We’ll give you an honest view, with no pressure at all.',
        `Just reply with a day and time that suits you, or call us on ${PHONE}.`,
      ].join('\n\n'),
      sections: ['sold', 'why-sell', 'review'],
      cta: (c) => book(c, 'Booking my valuation'),
    },
  ],
  'lettings-valuation': [
    reportEmail(true),
    {
      key: 'thanks', label: 'Thank you + book a visit', hint: 'The first reply: who we are, our service, and when to visit.',
      kicker: 'Letting your property', photo: 'shopfront',
      headline: () => 'Let’s find out what your property could earn.',
      subject: (c) => `${first(c)}, let’s find out what your property could let for`,
      message: (c) => [
        hello(c),
        `Thank you for asking us about letting your property${at(c)}. We’d be glad to help.`,
        `We’ve been letting and looking after homes in ${area(c)} from our branch on Preston Road since ${SINCE}. We’ll tell you honestly what rent to expect, find you a good tenant, and take the day-to-day off your hands, including everything the new Renters’ Rights rules ask of landlords.`,
        `When would suit you for a visit? Just reply with a day and time, or call us on ${PHONE}. It’s free, with no obligation.`,
      ].join('\n\n'),
      sections: ['stats', 'letting-steps', 'landlord', 'rra', 'review', 'schemes'],
      cta: (c) => book(c, 'Booking my rental valuation'),
    },
    confirmValuation(true),
    {
      key: 'result', label: 'Your rental valuation', hint: 'After the visit: the rent to expect, and our service.', needs: 'figure',
      kicker: 'Your rental valuation', photo: 'shopfront',
      headline: (c, x) => `Expected rent: ${fig(c, x)}.`,
      subject: (c) => `Your rental valuation${c.address ? `: ${c.address}` : ''}`,
      message: (c, x) => [
        hello(c),
        `Thank you for showing us round${at(c)}.`,
        `Having looked at the property and at what similar homes nearby are letting for, we’d expect it to let for ${fig(c, x)}.`,
        `Our fully managed service would look after everything from there: finding and referencing the tenant, the paperwork, the rent, repairs and the rules. If you’d like to go ahead, or have any questions, just reply or call us on ${PHONE}.`,
      ].join('\n\n'),
      sections: ['figure', 'evidence', 'landlord', 'letting-steps', 'review'],
      cta: (c) => ({ href: `mailto:${c.sender.email}?subject=${encodeURIComponent('Letting my property')}`, label: 'I’d like to go ahead' }),
    },
    {
      key: 'follow', label: 'Follow up', hint: 'If you haven’t heard back.',
      kicker: 'Still thinking of letting?', photo: 'shopfront',
      headline: () => 'Letting, without the headaches.',
      subject: (c) => `${first(c)}, still thinking of letting?`,
      message: (c) => [
        hello(c),
        `I wanted to follow up on your enquiry about letting your property${at(c)}. Would now be a good time for us to come round?`,
        'Tenant demand in Harrow, Kenton and Wembley is strong, and with the new Renters’ Rights rules there’s more to get right than ever. We take care of all of it.',
        `Just reply with a day and time that suits you, or call us on ${PHONE}.`,
      ].join('\n\n'),
      sections: ['landlord', 'rra', 'review'],
      cta: (c) => book(c, 'Booking my rental valuation'),
    },
  ],
  buyer: [
    {
      key: 'thanks', label: 'Thank you for your enquiry', hint: 'The first reply: thanks them and asks about their position.',
      kicker: 'Thank you for your enquiry', photo: 'property',
      headline: (c) => (c.property ? `Thanks for your interest in ${c.property.address}.` : 'Thanks for getting in touch.'),
      subject: (c) => `Your enquiry about ${about(c)}`,
      message: (c) => [
        hello(c),
        `Thank you for your enquiry about ${about(c)}. We’d be happy to show you round.`,
        'So we can help you properly, could you tell us a little about your position? For example, whether you’re a first-time buyer, whether you have a home to sell, and whether you’ve spoken to a mortgage adviser yet.',
        `Reply with a few days and times that suit you for a viewing, or call us on ${PHONE}.`,
      ].join('\n\n'),
      sections: ['property', 'buyer-help', 'review'],
    },
    arrangeViewing(false),
    confirmViewing(false),
    {
      key: 'follow', label: 'After the viewing', hint: 'Ask what they thought.',
      kicker: 'After your viewing', photo: 'property',
      headline: (c) => `What did you think of ${about(c)}?`,
      subject: (c) => `How did you find ${about(c)}?`,
      message: (c) => [
        hello(c),
        `Thank you for coming to see ${about(c)}. What did you think?`,
        'If you’d like a second viewing or to make an offer, just reply or give us a call. And if it wasn’t quite right, tell us what you’re looking for: we’ll let you know as soon as something suitable comes in.',
        `You can reach us on ${PHONE}.`,
      ].join('\n\n'),
      sections: ['property', 'offer-steps', 'buyer-help'],
    },
  ],
  tenant: [
    {
      key: 'thanks', label: 'Thank you for your enquiry', hint: 'The first reply: thanks them and asks the basics.',
      kicker: 'Thank you for your enquiry', photo: 'property',
      headline: (c) => (c.property ? `Thanks for your interest in ${c.property.address}.` : 'Thanks for getting in touch.'),
      subject: (c) => `Your enquiry about ${about(c)}`,
      message: (c) => [
        hello(c),
        `Thank you for your enquiry about ${about(c)}. We’d be happy to show you round.`,
        'So we can move quickly if you like it, it helps to know when you’d like to move in, who’ll be living there, whether you have any pets, and your household income.',
        `Reply with a few days and times you could view, or call us on ${PHONE}.`,
      ].join('\n\n'),
      sections: ['property', 'tenant-docs', 'tenant-help', 'review'],
      cta: (c) => ({ href: `${c.base}/renting#register`, label: 'Get new homes to rent by email' }),
    },
    arrangeViewing(true),
    confirmViewing(true),
    {
      key: 'follow', label: 'After the viewing', hint: 'Ask if they’d like to apply.',
      kicker: 'After your viewing', photo: 'property',
      headline: (c) => `Would you like to make ${about(c)} your home?`,
      subject: (c) => `Would you like to apply for ${about(c)}?`,
      message: (c) => [
        hello(c),
        `Thank you for coming to see ${about(c)}. Would you like to go ahead?`,
        'If so, we can take a holding deposit of no more than one week’s rent to take it off the market while we do the referencing. It usually takes a few days.',
        `If it wasn’t quite right, just tell us what you’re looking for and we’ll send you the next one that fits. Reply here or call us on ${PHONE}.`,
      ].join('\n\n'),
      sections: ['property', 'tenant-docs'],
    },
  ],
}

// ---------- the design ----------

const PX = 'padding-left:40px; padding-right:40px;'
const row = (inner: string, top = 30) => `<tr><td style="padding-top:${top}px; ${PX}" class="px">${inner}</td></tr>`
const eyebrow = (t: string) => `<p style="margin:0 0 6px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:2.5px; text-transform:uppercase; color:${C.gold};">${esc(t)}</p>`
const h2 = (t: string) => `<p style="margin:0 0 16px; font-family:${SERIF}; font-size:24px; line-height:30px; color:${C.ink};">${t}</p>`
const stars = (n = 5) => `<span style="color:${C.goldBtn}; font-size:16px; letter-spacing:2px;">${'&#9733;'.repeat(n)}</span>`

function paragraphs(text: string) {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p, i) => `<p style="margin:0 0 16px; font-family:${SANS}; font-size:15px; line-height:25px; color:${i === 0 ? C.ink : C.body};">${esc(p).replace(/\n/g, '<br/>')}</p>`).join('\n')
}

function btn(href: string, label: string, dark = false) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${dark ? C.dark : C.goldBtn}" style="border-radius:999px;">
<a href="${esc(href)}" target="_blank" style="display:inline-block; padding:15px 30px; font-family:${SANS}; font-size:13px; font-weight:bold; letter-spacing:1.5px; text-transform:uppercase; color:#FFFFFF; text-decoration:none; border-radius:999px;">${esc(label)}</a>
</td></tr></table>`
}

/** Numbered steps, each with a short title and a line of explanation. */
function steps(title: string, sub: string | null, items: [string, string][]) {
  return row(`${eyebrow(title)}${sub ? h2(sub) : ''}
${items.map(([t, d], i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;"><tr>
<td width="44" valign="top"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="32" height="32" align="center" valign="middle" bgcolor="${C.dark}" style="border-radius:16px; font-family:${SERIF}; font-size:15px; color:#F3D58E;">${i + 1}</td></tr></table></td>
<td valign="top"><p style="margin:4px 0 2px; font-family:${SANS}; font-size:15px; font-weight:bold; line-height:21px; color:${C.ink};">${esc(t)}</p><p style="margin:0; font-family:${SANS}; font-size:14px; line-height:21px; color:${C.body};">${esc(d)}</p></td>
</tr></table>`).join('\n')}`)
}

/** Two-by-two cards: a gold mark, a title and a line. */
function grid(title: string, sub: string, items: [string, string, string][]) {
  const cell = ([mark, t, d]: [string, string, string]) => `<td width="50%" valign="top" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cream}" style="border-radius:14px;"><tr><td style="padding:18px 18px 16px;">
<p style="margin:0 0 8px; font-family:${SERIF}; font-size:22px; line-height:22px; color:${C.goldBtn};">${mark}</p>
<p style="margin:0 0 4px; font-family:${SANS}; font-size:14px; font-weight:bold; line-height:20px; color:${C.ink};">${esc(t)}</p>
<p style="margin:0; font-family:${SANS}; font-size:13px; line-height:19px; color:${C.body};">${esc(d)}</p></td></tr></table></td>`
  const rows: string[] = []
  for (let i = 0; i < items.length; i += 2) rows.push(`<tr>${cell(items[i])}${items[i + 1] ? cell(items[i + 1]) : '<td width="50%"></td>'}</tr>`)
  return row(`${eyebrow(title)}${h2(sub)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -6px;">${rows.join('')}</table>`)
}

function listBox(title: string, items: [string, string | null][]) {
  return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cream}" style="border-radius:14px; border-left:4px solid ${C.goldBtn};"><tr><td style="padding:20px 22px;">
${eyebrow(title)}
${items.map(([t, d]) => `<p style="margin:8px 0 0; font-family:${SANS}; font-size:15px; line-height:22px; color:${C.ink};"><span style="color:${C.gold}; font-weight:bold;">&#10003;</span>&nbsp; ${esc(t)}${d ? `<br/><span style="padding-left:20px; font-size:13px; line-height:19px; color:${C.body};">${esc(d)}</span>` : ''}</p>`).join('\n')}
</td></tr></table>`, 24)
}

function priceRows(rows: { where: string; price: string; what: string }[]) {
  return rows.map((s) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};"><tr>
<td valign="top" style="padding:10px 0; font-family:${SANS}; font-size:14px; line-height:20px; color:${C.ink};">${esc(s.where)}<br/><span style="font-size:12px; color:${C.faint};">${esc(s.what)}</span></td>
<td valign="top" align="right" style="padding:10px 0; font-family:${SERIF}; font-size:19px; line-height:22px; color:${C.ink}; white-space:nowrap;">${esc(s.price)}</td></tr></table>`).join('\n')
}

function section(s: Section, c: EnquiryEmailContext, t: EnquiryTemplate, x: EnquiryEmailExtra, utm: string): string {
  const letting = c.kind === 'lettings-valuation' || c.kind === 'tenant'
  const review = letting ? c.brand?.lettings ?? c.brand?.sales : c.brand?.sales ?? c.brand?.lettings
  switch (s) {
    case 'stats': {
      const cells: [string, string][] = [
        [`${years()}`, 'years on Preston Road'],
        ['35+', 'years’ experience, led by our founder'],
        c.brand?.rating && c.brand.count ? [`${c.brand.rating.toFixed(1)}&#9733;`, `from ${c.brand.count} Google reviews`] : ['3', `places ${letting ? 'tenants' : 'buyers'} look: Zoopla, OnTheMarket and our website`],
      ]
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line}; border-bottom:1px solid ${C.line};"><tr>
${cells.map(([n, l], i) => `<td width="33%" align="center" valign="top" style="padding:18px 6px;${i ? ` border-left:1px solid ${C.line};` : ''}"><p style="margin:0; font-family:${SERIF}; font-size:30px; line-height:34px; color:${C.ink};">${n}</p><p style="margin:4px 0 0; font-family:${SANS}; font-size:12px; line-height:16px; color:${C.faint};">${esc(l)}</p></td>`).join('')}
</tr></table>`, 8)
    }
    case 'valuation-steps':
      return steps('Your free valuation', 'What happens when we visit', [
        ['We come to you', 'One of our team looks round with you and listens to what you’d like to do, and when. About 30 to 45 minutes.'],
        ['You get our figure, with the evidence', 'Real sold prices from HM Land Registry and the homes on the market near you, so you can see exactly how we got there.'],
        ['A clear plan for selling', 'The asking price we’d suggest, the right time to launch, and how we’d market your home. No obligation, ever.'],
      ])
    case 'letting-steps':
      return steps('From valuation to rent', 'How letting with us works', [
        ['Rental valuation', 'We visit, tell you what rent to expect and what (if anything) needs doing first. Free, no obligation.'],
        ['Marketing and viewings', 'Photos, a listing on Zoopla, OnTheMarket and our website, and straight to the tenants already registered with us. We do every viewing.'],
        ['Tenant found and referenced', 'Identity, Right to Rent, income, previous landlords and credit, before anyone moves in.'],
        ['Fully managed from then on', 'Rent collected and paid to you, repairs arranged, the paperwork and the new rules kept right.'],
      ])
    case 'sell-plan':
      return steps('How we’d sell your home', 'The plan', [
        ['Launch it properly', 'Professional photos and floorplan, then live on Zoopla, OnTheMarket and our own website.'],
        ['Buyers we already know', 'We email your home to buyers who’ve already asked us about homes like yours, as soon as it’s ready.'],
        ['Viewings by our own team', 'We show every buyer round ourselves and tell you what they thought.'],
        ['From offer to keys', 'We check each buyer’s position, negotiate the best price, and keep the solicitors and the chain moving to completion.'],
      ])
    case 'why-sell':
      return grid('Why sellers choose us', 'An independent agent, <em style="color:' + C.gold + ';">on your doorstep</em>', [
        ['&#8962;', `Local since ${SINCE}`, `${years()} years on Preston Road: we know what sells, street by street.`],
        ['&#9670;', 'Founder-led', 'Jamil Ahmed and the same team you meet at the valuation look after your sale.'],
        ['&#9673;', 'Seen everywhere', 'Zoopla, OnTheMarket and our own website, plus buyers we email first.'],
        ['&#10003;', 'Honest advice', 'A price backed by real sold prices, not a number to win your instruction.'],
      ])
    case 'why-let':
    case 'landlord': {
      const fee = `${LETTINGS.percent}%${LETTINGS.vat === 'plus' ? ' + VAT' : ''}`
      return grid(`Fully managed for ${fee} of the rent`, 'Everything covered, <em style="color:' + C.gold + ';">one simple fee</em>', LETTINGS.includes.slice(0, 6).map(([title, d]) => ['&#10003;', title, d.split('. ')[0].replace(/\.$/, '') + '.'] as [string, string, string]))
    }
    case 'rra':
      return listBox('The Renters’ Rights Act, handled', [
        ['No more Section 21', 'Tenancies now roll on month to month; we make sure your paperwork stands up.'],
        ['Rent reviews done properly', 'Once a year, with the formal notice, served correctly.'],
        ['Pets, bidding and the landlord database', 'We handle the requests and the new rules for you.'],
      ])
    case 'landlord-docs':
      return listBox('Useful to have ready', [['Your gas safety certificate and EPC', null], ['The electrical safety report (EICR)', null], ['Keys for every door, and any mortgage or freeholder consent to let', null]])
    case 'seller-docs':
      return listBox('Useful to have to hand', [['The lease, for a flat or maisonette', null], ['Any planning or building control papers', null], ['Details of recent work', 'A new boiler, windows, rewiring or an extension']])
    case 'tenant-docs':
      return listBox('If you’d like to apply, you’ll need', [['Photo ID, for identity and Right to Rent', null], ['Proof of income', 'Recent payslips or bank statements, or a guarantor'], ['Your current or previous landlord’s details', null], ['A holding deposit of no more than one week’s rent', 'Refundable, and it comes off your first payment']])
    case 'sold':
      return c.sold.length ? row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cream}" style="border-radius:14px;"><tr><td style="padding:20px 22px;">
${eyebrow(`Recently sold near ${c.postcode ?? 'you'}`)}${priceRows(c.sold.map((s) => ({ where: s.where, price: s.price, what: `${s.type} · ${s.when}` })))}
<p style="margin:10px 0 0; font-family:${SANS}; font-size:11px; line-height:16px; color:${C.faint};">Prices paid, from HM Land Registry. Your own home’s value depends on its size, condition and features: that’s what our visit is for.</p>
${c.postcode ? `<p style="margin:12px 0 0; font-family:${SANS}; font-size:13px; font-weight:bold;"><a href="${esc(withUtm(`${c.base}/sold-prices?postcode=${encodeURIComponent(c.postcode)}`, utm, 'enquiry_reply'))}" style="color:${C.gold}; text-decoration:none;">See every sale near you &rarr;</a></p>` : ''}
</td></tr></table>`, 24) : ''
    case 'evidence': {
      const rows = (c.evidence?.length ? c.evidence : c.sold.map((s) => ({ where: s.where, price: s.price, what: `Sold ${s.when} · ${s.type}` }))).slice(0, 6)
      return rows.length ? row(`${eyebrow(c.kind === 'lettings-valuation' ? 'Similar homes nearby' : 'The evidence')}${h2(c.kind === 'lettings-valuation' ? 'What similar homes let for' : 'Homes we compared yours with')}${priceRows(rows)}`) : ''
    }
    case 'figure':
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.dark}" style="border-radius:16px;"><tr><td align="center" style="padding:28px 22px;">
<p style="margin:0 0 6px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:3px; text-transform:uppercase; color:${C.goldBtn};">${c.kind === 'lettings-valuation' ? 'Expected rent' : 'Our valuation'}</p>
<p style="margin:0; font-family:${SERIF}; font-size:34px; line-height:40px; color:#FFFDF6;">${esc(fig(c, x))}</p>
${c.address ? `<p style="margin:8px 0 0; font-family:${SANS}; font-size:13px; color:#B9B4A0;">${esc(c.address)}${c.postcode ? `, ${esc(c.postcode)}` : ''}</p>` : ''}
</td></tr></table>`, 8)
    case 'appointment':
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line}; border-radius:16px;"><tr>
<td width="86" align="center" valign="middle" bgcolor="${C.dark}" style="border-radius:15px 0 0 15px; padding:18px 8px; font-family:${SERIF}; font-size:28px; color:#F3D58E;">&#9201;</td>
<td valign="middle" style="padding:16px 20px;"><p style="margin:0; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${C.gold};">${t.kicker}</p>
<p style="margin:4px 0 0; font-family:${SERIF}; font-size:22px; line-height:28px; color:${C.ink};">${esc(x.when || WHEN)}</p>
<p style="margin:4px 0 0; font-family:${SANS}; font-size:13px; color:${C.body};">${esc(c.property?.address ?? c.address ?? '')}${c.postcode && !c.property ? `, ${esc(c.postcode)}` : ''}</p></td></tr></table>`, 8)
    case 'property': {
      if (!c.property) return ''
      const link = withUtm(c.property.url, utm, 'enquiry_reply')
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line}; border-radius:16px;"><tr><td style="padding:18px 20px;">
<p style="margin:0; font-family:${SERIF}; font-size:26px; line-height:32px; color:${C.ink};">${esc(c.property.priceText)}</p>
<p style="margin:4px 0 0; font-family:${SANS}; font-size:15px; line-height:22px; color:${C.body};">${esc(c.property.address)}</p>
${c.property.specs.length ? `<p style="margin:8px 0 0; font-family:${SANS}; font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:${C.faint};">${c.property.specs.map(esc).join(' &middot; ')}</p>` : ''}
<p style="margin:12px 0 0; font-family:${SANS}; font-size:13px; font-weight:bold;"><a href="${esc(link)}" target="_blank" style="color:${C.gold}; text-decoration:none;">See all the photos &amp; details &rarr;</a></p>
</td></tr></table>`, 8)
    }
    case 'buyer-help':
      return grid('Buying with us', 'We’re here <em style="color:' + C.gold + ';">to help you move</em>', [
        ['&#9673;', 'Hear about new homes', 'Tell us what you’re after and we’ll email you new homes that fit as soon as they’re ready.'],
        ['&#8962;', 'Viewings by the branch', 'We show every home ourselves, so you can ask us anything about the area.'],
        ['&#9670;', 'Selling too?', 'We’ll value your home for free, and having your own sale agreed makes any offer you make stronger.'],
        ['&#10003;', 'Offers made simple', 'We’ll guide you through making an offer and keep everything moving to completion.'],
      ])
    case 'tenant-help':
      return grid('Renting with us', 'Straightforward, <em style="color:' + C.gold + ';">and fair</em>', [
        ['&#10003;', 'No fees for viewings', 'No charge for viewings, referencing or the tenancy agreement.'],
        ['&#8962;', 'Shown by the branch', 'Every home is shown by our own team, not a call centre.'],
        ['&#9673;', 'Hear about homes first', 'Register and we’ll email you new homes to rent as soon as they come on.'],
        ['&#9670;', 'Deposits protected', 'Your deposit is registered with myDeposits, a government-approved scheme.'],
      ])
    case 'offer-steps':
      return steps('If you love it', 'Making an offer', [
        ['Tell us your offer', 'By phone or email, with your position: mortgage agreed in principle, cash, or a home to sell.'],
        ['We put it to the seller', 'Straight away, and we’ll come back to you with their answer.'],
        ['Agreed: we keep it moving', 'We work with both solicitors and any chain through to completion and your keys.'],
      ])
    case 'review': {
      if (!review) return ''
      const g = c.brand
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line}; border-radius:16px;"><tr><td style="padding:22px 24px;">
${stars()}
<p style="margin:10px 0 0; font-family:${SERIF}; font-style:italic; font-size:18px; line-height:27px; color:${C.ink};">“${esc(review.text.length > 320 ? `${review.text.slice(0, 317).replace(/\s+\S*$/, '')}…` : review.text)}”</p>
<p style="margin:12px 0 0; font-family:${SANS}; font-size:13px; color:${C.faint};"><b style="color:${C.ink};">${esc(review.name)}</b>${review.date ? ` &middot; ${esc(review.date)}` : ''} &middot; Google review</p>
${g?.rating && g.count ? `<p style="margin:10px 0 0; font-family:${SANS}; font-size:13px; color:${C.body};">${g.rating.toFixed(1)} out of 5 from ${g.count} Google reviews${g.reviewsUrl ? ` &middot; <a href="${esc(g.reviewsUrl)}" target="_blank" style="color:${C.gold}; text-decoration:none; font-weight:bold;">Read them all</a>` : ''}</p>` : ''}
</td></tr></table>`)
    }
    case 'founder':
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cream}" style="border-radius:16px;"><tr>
<td width="96" valign="top" style="padding:22px 0 22px 22px;"><img src="${esc(`${c.base}/img/founder.jpg`)}" width="74" height="74" alt="Jamil Ahmed" style="display:block; width:74px; height:74px; border-radius:37px; object-fit:cover;"/></td>
<td valign="top" style="padding:22px 22px 22px 14px;"><p style="margin:0; font-family:${SERIF}; font-style:italic; font-size:17px; line-height:25px; color:${C.ink};">“Never back away from a challenge. Whatever it takes, every client leaves this office with a smile.”</p>
<p style="margin:10px 0 0; font-family:${SANS}; font-size:13px; color:${C.faint};"><b style="color:${C.ink};">Jamil Ahmed</b> &middot; Founder &middot; 35+ years in property</p></td>
</tr></table>`)
    case 'report': {
      if (!c.report) return ''
      const letting = c.kind === 'lettings-valuation'
      const inside: [string, string][] = letting ? [
        ['Why Preston Hill', 'Who we are, and how close we are to you'],
        ['What tenants will love', 'Stations, schools, shops and parks, with walking times'],
        ['Your property’s story', 'Its sales history and energy certificates'],
        ['Rents nearby', 'What similar homes let for, and what’s on the market now'],
        ['How letting with us works', 'From valuation to rent day, fully managed'],
        ['Peace of mind', 'Our fee, the Renters’ Rights Act, and the schemes we belong to'],
      ] : [
        ['Why Preston Hill', 'Who we are, and how close we are to you'],
        ['What buyers will love', 'Stations, schools, shops and parks, with walking times and travel into London'],
        ['Your home’s story', 'Every sale since 1995, and its energy certificates'],
        ['What similar homes sold for', 'Real sold prices nearby from HM Land Registry, on a map'],
        ['How we’d sell it', 'From valuation to keys, step by step'],
        ['What our clients say', 'Real reviews, word for word'],
      ]
      const cell = ([title, d]: [string, string]) => `<td width="50%" valign="top" style="padding:7px 8px 7px 0;"><p style="margin:0; font-family:${SANS}; font-size:14px; line-height:20px; color:#FFFDF6;"><span style="color:${C.goldBtn}; font-weight:bold;">&#10003;</span>&nbsp; <b>${esc(title)}</b></p><p style="margin:2px 0 0 20px; font-family:${SANS}; font-size:12px; line-height:18px; color:#CFC9B6;">${esc(d)}</p></td>`
      const rows: string[] = []
      for (let i = 0; i < inside.length; i += 2) rows.push(`<tr>${cell(inside[i])}${inside[i + 1] ? cell(inside[i + 1]) : '<td></td>'}</tr>`)
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.dark}" style="border-radius:16px;"><tr><td style="padding:24px 24px 22px;">
<p style="margin:0 0 6px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:2.5px; text-transform:uppercase; color:${C.goldBtn};">Inside your report</p>
<p style="margin:0 0 12px; font-family:${SERIF}; font-size:24px; line-height:30px; color:#FFFDF6;">Made for ${esc(c.address && !isPostcode(c.address) ? c.address : letting ? 'your property' : 'your home')}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr><td>${btn(c.report.url, 'Open your report')}</td></tr></table>
<p style="margin:12px 0 0; font-family:${SANS}; font-size:12px; line-height:18px; color:#A9A28C;">Opens in your browser, on your phone or computer. You can save it as a PDF to keep.${x.attached ? ' We’ve also attached it to this email.' : ''}</p>
</td></tr></table>`, 22)
    }
    case 'meet': {
      const letting = c.kind === 'lettings-valuation'
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cream}" style="border-radius:16px;"><tr><td style="padding:24px 26px;">
${eyebrow('The next step')}${h2(letting ? 'Let us see it in person' : 'Let us see your home in person')}
<p style="margin:0 0 16px; font-family:${SANS}; font-size:14px; line-height:22px; color:${C.body};">${letting
        ? 'Your report is a starting point. Condition, furnishing, the garden and the exact street all change the rent, and only a visit shows them. Half an hour is all it takes: we’ll tell you the rent to expect, what (if anything) needs doing first, and how we’d look after it. Free, and no obligation.'
        : 'Your report is a starting point. Size, condition, any extensions, the garden and the exact street all change the price, and only a visit shows them. Give us 30 to 45 minutes and we’ll give you an accurate figure, with the evidence, and a clear plan. Free, and no obligation.'}</p>
${btn(`mailto:${c.sender.email}?subject=${encodeURIComponent(letting ? 'Booking a rental valuation' : 'Booking a valuation')}`, 'Book a time to meet', true)}
<p style="margin:12px 0 0; font-family:${SANS}; font-size:13px; color:${C.body};">Or call us on <a href="tel:+442089049005" style="color:${C.gold}; text-decoration:none; font-weight:bold;">${PHONE}</a></p>
</td></tr></table>`, 26)
    }
    case 'schemes':
      return row(`<p style="margin:0; font-family:${SANS}; font-size:11px; line-height:18px; letter-spacing:1.5px; text-transform:uppercase; color:${C.faint}; text-align:center;">Regulated &amp; protected<br/><span style="color:${C.body};">The Property Ombudsman &middot; safeagent &middot; Property Redress Scheme &middot; myDeposits</span></p>`, 26)
  }
  return ''
}

/** The designed email for one template, with the wording as staff left it. */
export function renderEnquiryEmail(c: EnquiryEmailContext, t: EnquiryTemplate, subject: string, message: string, x: EnquiryEmailExtra = {}): Rendered {
  const utm = `enquiry_${c.kind}_${t.key}`
  const cta = t.cta?.(c) ?? null
  const site = withUtm(`${c.base}/`, utm, 'enquiry_reply')
  const photo = t.photo === 'property' && c.property?.photo ? c.property.photo : t.photo === 'report' && c.report ? c.report.image : `${c.base}/img/shopfront.jpg`
  const photoAlt = t.photo === 'property' && c.property?.photo ? c.property.address : t.photo === 'report' && c.report ? 'Your home from above' : 'Preston Hill Estates, 271 Preston Road, Harrow'
  const body = t.sections.map((s) => section(s, c, t, x, utm)).join('\n')
  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(subject)}</title>
<style type="text/css">
body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; } table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; } body { margin:0 !important; padding:0 !important; width:100% !important; }
a { color:${C.gold}; }
@media screen and (max-width:640px) { .container { width:100% !important; max-width:100% !important; } .px { padding-left:22px !important; padding-right:22px !important; } .hero-h { font-size:28px !important; line-height:34px !important; } }
</style></head>
<body style="margin:0; padding:0; background-color:${C.page};">
<div style="display:none; font-size:1px; color:${C.page}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${esc(t.headline(c, x))} ${esc(message.split('\n').find((l) => l.trim() && !/^hello/i.test(l)) ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">

<tr><td style="padding:4px 8px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding-right:12px;"><a href="${esc(site)}" target="_blank"><img src="${c.base}/img/logo-mark.png" width="46" height="46" alt="Preston Hill Estates" style="display:block; width:46px; height:46px;"/></a></td><td valign="middle"><a href="${esc(site)}" target="_blank" style="text-decoration:none;"><span style="font-family:${SANS}; font-size:15px; font-weight:bold; letter-spacing:3px; color:${C.ink};">PRESTON HILL</span><br/><span style="font-family:${SANS}; font-size:11px; letter-spacing:5px; color:${C.gold};">ESTATES</span></a></td></tr></table></td>
<td valign="middle" align="right" style="font-family:${SANS}; font-size:11px; letter-spacing:2px; color:${C.gold};">EST. ${SINCE} &middot; HARROW</td>
</tr></table></td></tr>

<tr><td bgcolor="${C.card}" style="border:1px solid ${C.line}; border-radius:20px; overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:0;">${t.photo === 'report' && c.report ? `<a href="${esc(c.report.url)}" target="_blank">` : ''}<img src="${esc(photo)}" width="600" alt="${esc(photoAlt)}" style="display:block; width:100%; max-width:600px; height:auto; border-radius:19px 19px 0 0;"/>${t.photo === 'report' && c.report ? '</a>' : ''}</td></tr>
<tr><td bgcolor="${C.dark}" style="padding:26px 40px 28px;" class="px">
<p style="margin:0 0 10px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:3px; text-transform:uppercase; color:${C.goldBtn};">${esc(t.kicker)}</p>
<p class="hero-h" style="margin:0; font-family:${SERIF}; font-size:32px; line-height:38px; color:#FFFDF6;">${esc(t.headline(c, x))}</p>
</td></tr>
<tr><td style="padding:32px 40px 4px;" class="px">${paragraphs(message)}</td></tr>
${cta ? row(btn(cta.href, cta.label), 6) : ''}
${body}
<tr><td style="padding:34px 40px 36px;" class="px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};"><tr><td style="padding-top:22px;">
<p style="margin:0; font-family:${SANS}; font-size:15px; line-height:22px; color:${C.ink};">Kind regards,</p>
<p style="margin:4px 0 0; font-family:${SERIF}; font-size:22px; line-height:28px; color:${C.ink};">${esc(c.sender.name)}</p>
<p style="margin:2px 0 0; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">Preston Hill Estates &middot; <a href="tel:+442089049005" style="color:${C.gold}; text-decoration:none;">${PHONE}</a> &middot; <a href="mailto:${esc(c.sender.email)}" style="color:${C.gold}; text-decoration:none;">${esc(c.sender.email)}</a></p>
</td></tr></table>
</td></tr>
</table></td></tr>

<tr><td align="center" style="padding:26px 24px 6px;">
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.body};"><b>Preston Hill Estates</b> &middot; Independent estate agents since ${SINCE}</p>
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">271 Preston Road, Harrow HA3 0PS &middot; Monday to Friday 9.00 to 17.30 &middot; Saturday 10.00 to 13.00</p>
<p style="margin:0 0 14px; font-family:${SANS}; font-size:13px; line-height:20px;"><a href="${esc(site)}" style="color:${C.gold}; text-decoration:none;">prestonhillestates.com</a> &middot; <a href="tel:+442089049005" style="color:${C.gold}; text-decoration:none;">${PHONE}</a></p>
<p style="margin:0; font-family:${SANS}; font-size:11px; color:#B8B4A2;">Preston Hill Estates Ltd &middot; Company No. 05058532</p>
</td></tr>
</table></td></tr></table>
</body></html>`
  const text = [
    message,
    c.property && t.sections.includes('property') ? `\n${c.property.priceText} · ${c.property.address}\n${c.property.url}` : '',
    cta && !cta.href.startsWith('mailto:') ? `\n${cta.label}: ${cta.href}` : '',
    `\nKind regards,\n${c.sender.name}\nPreston Hill Estates · ${PHONE}\n271 Preston Road, Harrow HA3 0PS`,
  ].filter(Boolean).join('\n')
  return { html, text }
}

export const templateFor = (kind: EnquiryEmailKind, key: string) => ENQUIRY_TEMPLATES[kind].find((t) => t.key === key) ?? null

/** A plain reply in an email conversation: their words stay readable, with our signature underneath. */
export function renderReply(message: string, sender: Sender): Rendered {
  const html = `<!DOCTYPE html><html lang="en"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/></head>
<body style="margin:0; padding:16px; background:#FFFFFF;">
${paragraphs(message)}
<p style="margin:18px 0 0; font-family:${SANS}; font-size:15px; line-height:22px; color:${C.ink};">Kind regards,</p>
<p style="margin:4px 0 0; font-family:${SERIF}; font-size:18px; line-height:24px; color:${C.ink};">${esc(sender.name)}</p>
<p style="margin:2px 0 0; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">Preston Hill Estates &middot; 271 Preston Road, Harrow HA3 0PS &middot; <a href="tel:+442089049005" style="color:${C.gold}; text-decoration:none;">${PHONE}</a></p>
</body></html>`
  return { html, text: `${message}\n\nKind regards,\n${sender.name}\nPreston Hill Estates · 271 Preston Road, Harrow HA3 0PS · ${PHONE}` }
}
