// Ready-made emails for answering an enquiry: valuations (sales and lettings), buyers and tenants. Pure functions
// with no server imports, so the enquiry page shows a live preview while staff edit the wording, and the server
// sends exactly the same email.

import { C, SANS, SERIF, button, esc, firstName, withUtm, type Rendered, type Sender } from './property-email'
import { LETTINGS } from './site'

export type EnquiryEmailKind = 'sales-valuation' | 'lettings-valuation' | 'buyer' | 'tenant'

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
}
export type EnquiryEmailExtra = { when?: string; times?: string; figure?: string }

export type EnquiryTemplate = {
  key: string
  label: string
  hint: string
  /** A detail staff fill in: the booked time, or times to offer. */
  needs?: 'when' | 'times' | 'figure'
  subject: (c: EnquiryEmailContext, x: EnquiryEmailExtra) => string
  message: (c: EnquiryEmailContext, x: EnquiryEmailExtra) => string
  kicker: string
  extras?: ('property' | 'sold' | 'evidence' | 'landlord' | 'tenant-docs' | 'seller-docs')[]
  cta?: (c: EnquiryEmailContext) => { href: string; label: string } | null
}

const PHONE = '020 8904 9005'
const hello = (c: EnquiryEmailContext) => `Hello ${firstName(c.name)},`
const at = (c: EnquiryEmailContext) => (c.address ? ` at ${c.address}` : c.postcode ? ` in ${c.postcode}` : '')
const about = (c: EnquiryEmailContext) => c.property?.address ?? c.address ?? 'the property'
const WHEN = '[day and time]'
const TIMES = '[the times you can offer]'
const FIGURE = '[your valuation]'
const area = (c: EnquiryEmailContext) => (c.postcode ? c.postcode.split(' ')[0] : 'your area')

const confirmValuation = (letting: boolean): EnquiryTemplate => ({
  key: 'confirm', label: 'Confirm the appointment', hint: 'Once you’ve booked a time.', needs: 'when',
  kicker: letting ? 'Rental valuation booked' : 'Valuation booked',
  subject: (c, x) => `Your ${letting ? 'rental ' : ''}valuation is booked: ${x.when || WHEN}`,
  message: (c, x) => [
    hello(c),
    `This is to confirm your ${letting ? 'rental ' : ''}valuation${at(c)} on ${x.when || WHEN}.`,
    letting
      ? 'One of our lettings team will come to you. It usually takes about half an hour: we’ll look round, tell you what rent to expect, and talk through anything that needs doing before it’s let, from safety certificates to the new rules for landlords.'
      : 'One of our valuers will come to you. It usually takes 30 to 45 minutes. If you have them to hand, it helps to see the lease (for a flat) and details of any recent work, such as a new boiler, windows or an extension.',
    `If you need to change the time, just reply to this email or call us on ${PHONE}.`,
  ].join('\n\n'),
  extras: letting ? ['landlord'] : ['seller-docs'],
})

const arrangeViewing = (letting: boolean): EnquiryTemplate => ({
  key: 'arrange', label: 'Offer viewing times', hint: 'Suggest a few times and let them pick.', needs: 'times',
  kicker: 'Arrange a viewing',
  subject: (c) => `Viewing ${about(c)}`,
  message: (c, x) => [
    hello(c),
    `Thank you for your interest in ${about(c)}. We can show you round at any of these times:`,
    x.times || TIMES,
    'Just reply with the one that suits you best and we’ll confirm it. If none of them work, tell us when you’re free and we’ll do our best to fit around you.',
    letting ? 'Good homes to rent here tend to go quickly, so the sooner the better.' : '',
  ].filter(Boolean).join('\n\n'),
  extras: ['property'],
})

const confirmViewing = (letting: boolean): EnquiryTemplate => ({
  key: 'confirm', label: 'Confirm the viewing', hint: 'Once a time is agreed.', needs: 'when',
  kicker: 'Viewing confirmed',
  subject: (c, x) => `Viewing confirmed: ${x.when || WHEN}`,
  message: (c, x) => [
    hello(c),
    `This is to confirm your viewing of ${about(c)} on ${x.when || WHEN}. We’ll meet you at the property.`,
    letting
      ? 'If you like it, we can take a holding deposit (no more than one week’s rent) on the day to take it off the market while we do the referencing.'
      : 'If you have a mortgage agreement in principle, or details of the home you’re selling, bring them along: it helps if you decide to make an offer.',
    `If anything changes, just reply to this email or call us on ${PHONE}.`,
  ].join('\n\n'),
  extras: ['property'],
})

export const ENQUIRY_TEMPLATES: Record<EnquiryEmailKind, EnquiryTemplate[]> = {
  'sales-valuation': [
    {
      key: 'thanks', label: 'Thank you + book a valuation', hint: 'The first reply: thanks them and asks when to visit.',
      kicker: 'Your free valuation',
      subject: (c) => `Your free valuation${c.address ? `: ${c.address}` : ''}`,
      message: (c) => [
        hello(c),
        `Thank you for asking us to value your home${at(c)}. We’d love to come and see it.`,
        `A valuation takes 30 to 45 minutes. One of our valuers will look round with you, talk through what buyers in ${area(c)} are paying right now, and give you an honest figure and a plan for selling. It’s free, and there’s no obligation.`,
        `When would suit you? Reply with a day and time, or call us on ${PHONE}, and we’ll book you in.`,
      ].join('\n\n'),
      extras: ['sold'],
      cta: (c) => (c.postcode ? { href: `${c.base}/sold-prices?postcode=${encodeURIComponent(c.postcode)}`, label: 'See what’s sold near you' } : null),
    },
    confirmValuation(false),
    {
      key: 'result', label: 'Your valuation', hint: 'After the visit: the figure and the evidence.', needs: 'figure',
      kicker: 'Your valuation',
      subject: (c) => `Your valuation${c.address ? `: ${c.address}` : ''}`,
      message: (c, x) => [
        hello(c),
        `Thank you for showing us round${at(c)}. It was good to meet you.`,
        `Having looked at your home, at what’s sold nearby recently and at similar homes on the market now, we’d put its value at ${x.figure || FIGURE}.`,
        'Some of the sales we looked at are below. We’d be glad to talk you through the asking price we’d suggest, and how we’d find the right buyer.',
        `When you’re ready to go ahead, or if you have any questions, reply to this email or call us on ${PHONE}.`,
      ].join('\n\n'),
      extras: ['evidence'],
      cta: (c) => (c.postcode ? { href: `${c.base}/sold-prices?postcode=${encodeURIComponent(c.postcode)}`, label: 'See what’s sold near you' } : null),
    },
    {
      key: 'follow', label: 'Follow up', hint: 'If you haven’t heard back.',
      kicker: 'Still thinking of selling?',
      subject: (c) => `Still thinking of selling${c.address ? ` ${c.address}` : ''}?`,
      message: (c) => [
        hello(c),
        `I wanted to follow up on your request for a valuation${at(c)}. Would now be a good time for us to come round?`,
        'Even if you’re not planning to move for a while, knowing what your home is worth today helps you plan, and we’re happy to give you an honest view with no pressure at all.',
        `Reply with a day and time that suits you, or call us on ${PHONE}.`,
      ].join('\n\n'),
      extras: ['sold'],
      cta: (c) => (c.postcode ? { href: `${c.base}/sold-prices?postcode=${encodeURIComponent(c.postcode)}`, label: 'See what’s sold near you' } : null),
    },
  ],
  'lettings-valuation': [
    {
      key: 'thanks', label: 'Thank you + book a visit', hint: 'The first reply: our service and when to visit.',
      kicker: 'Letting your property',
      subject: (c) => `Letting your property${c.address ? `: ${c.address}` : ''}`,
      message: (c) => [
        hello(c),
        `Thank you for asking us about letting your property${at(c)}. We’d be glad to help.`,
        'We’d like to visit, tell you what rent to expect, and let you know what (if anything) needs doing before it’s let. It’s free, with no obligation.',
        `When would suit you? Reply with a day and time, or call us on ${PHONE}, and we’ll book you in.`,
      ].join('\n\n'),
      extras: ['landlord'],
      cta: (c) => ({ href: `${c.base}/landlords`, label: 'How we look after landlords' }),
    },
    confirmValuation(true),
    {
      key: 'result', label: 'Your rental valuation', hint: 'After the visit: the rent to expect.', needs: 'figure',
      kicker: 'Your rental valuation',
      subject: (c) => `Your rental valuation${c.address ? `: ${c.address}` : ''}`,
      message: (c, x) => [
        hello(c),
        `Thank you for showing us round${at(c)}.`,
        `Having looked at the property and at what similar homes nearby are letting for, we’d expect it to let for ${x.figure || FIGURE}.`,
        `Our fully managed service would look after everything from there. If you’d like to go ahead, or have any questions, reply to this email or call us on ${PHONE}.`,
      ].join('\n\n'),
      extras: ['evidence', 'landlord'],
      cta: (c) => ({ href: `${c.base}/landlords`, label: 'How we look after landlords' }),
    },
    {
      key: 'follow', label: 'Follow up', hint: 'If you haven’t heard back.',
      kicker: 'Still thinking of letting?',
      subject: (c) => `Still thinking of letting${c.address ? ` ${c.address}` : ''}?`,
      message: (c) => [
        hello(c),
        `I wanted to follow up on your enquiry about letting your property${at(c)}. Would now be a good time for us to come round?`,
        'Tenant demand in Harrow, Kenton and Wembley is strong, and with the new Renters’ Rights rules there’s more to get right than ever. We take care of all of it, from finding and referencing the tenant to the rent, repairs and paperwork.',
        `Reply with a day and time that suits you, or call us on ${PHONE}.`,
      ].join('\n\n'),
      extras: ['landlord'],
      cta: (c) => ({ href: `${c.base}/landlords`, label: 'How we look after landlords' }),
    },
  ],
  buyer: [
    {
      key: 'thanks', label: 'Thank you for your enquiry', hint: 'The first reply: thanks them and asks about their position.',
      kicker: 'Thank you for your enquiry',
      subject: (c) => `Your enquiry about ${about(c)}`,
      message: (c) => [
        hello(c),
        `Thank you for your enquiry about ${about(c)}. We’d be happy to show you round.`,
        'So we can help you properly, could you tell us a little about your position? For example, whether you’re a first-time buyer, whether you have a home to sell, and whether you’ve spoken to a mortgage adviser yet.',
        `Reply with a few days and times that suit you for a viewing, or call us on ${PHONE}.`,
      ].join('\n\n'),
      extras: ['property'],
    },
    arrangeViewing(false),
    confirmViewing(false),
    {
      key: 'follow', label: 'After the viewing', hint: 'Ask what they thought.',
      kicker: 'After your viewing',
      subject: (c) => `How did you find ${about(c)}?`,
      message: (c) => [
        hello(c),
        `Thank you for coming to see ${about(c)}. What did you think?`,
        'If you’d like a second viewing or to make an offer, just reply or give us a call. And if it wasn’t quite right, tell us what you’re looking for: we’ll let you know as soon as something suitable comes in, often before it reaches the portals.',
        `You can reach us on ${PHONE}.`,
      ].join('\n\n'),
      extras: ['property'],
    },
  ],
  tenant: [
    {
      key: 'thanks', label: 'Thank you for your enquiry', hint: 'The first reply: thanks them and asks the basics.',
      kicker: 'Thank you for your enquiry',
      subject: (c) => `Your enquiry about ${about(c)}`,
      message: (c) => [
        hello(c),
        `Thank you for your enquiry about ${about(c)}. We’d be happy to show you round.`,
        'So we can move quickly if you like it, it helps to know when you’d like to move in, who’ll be living there, whether you have any pets, and your household income.',
        `Reply with a few days and times you could view, or call us on ${PHONE}.`,
      ].join('\n\n'),
      extras: ['property', 'tenant-docs'],
      cta: (c) => ({ href: `${c.base}/renting#register`, label: 'Get new homes to rent by email' }),
    },
    arrangeViewing(true),
    confirmViewing(true),
    {
      key: 'follow', label: 'After the viewing', hint: 'Ask if they’d like to apply.',
      kicker: 'After your viewing',
      subject: (c) => `Would you like to apply for ${about(c)}?`,
      message: (c) => [
        hello(c),
        `Thank you for coming to see ${about(c)}. Would you like to go ahead?`,
        'If so, we can take a holding deposit of no more than one week’s rent to take it off the market while we do the referencing. It usually takes a few days.',
        `If it wasn’t quite right, just tell us what you’re looking for and we’ll send you the next one that fits. Reply here or call us on ${PHONE}.`,
      ].join('\n\n'),
      extras: ['property', 'tenant-docs'],
    },
  ],
}

// ---------- the email ----------

const kicker = (t: string) => `<p style="margin:0 0 18px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:3px; text-transform:uppercase; color:${C.gold};">${esc(t)}</p>`
const label = (t: string) => `<p style="margin:0 0 10px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:2.5px; text-transform:uppercase; color:${C.gold};">${esc(t)}</p>`
const tick = (t: string, note?: string) => `<p style="margin:0 0 8px; font-family:${SANS}; font-size:15px; line-height:22px; color:${C.ink};"><span style="color:${C.gold}; font-weight:bold;">&#10003;</span>&nbsp; ${esc(t)}${note ? `<br/><span style="padding-left:20px; font-size:13px; line-height:19px; color:${C.body};">${esc(note)}</span>` : ''}</p>`
const box = (inner: string) => `<tr><td style="padding:8px 40px 0;" class="px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cream}" style="border-radius:14px; border-left:4px solid ${C.goldBtn};"><tr><td style="padding:20px 22px;">${inner}</td></tr></table></td></tr>`

function paragraphs(text: string) {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p, i) => `<p style="margin:0 0 16px; font-family:${SANS}; font-size:15px; line-height:24px; color:${i === 0 ? C.ink : C.body};">${esc(p).replace(/\n/g, '<br/>')}</p>`).join('\n')
}

function extrasHtml(c: EnquiryEmailContext, t: EnquiryTemplate, utm: string): string {
  const out: string[] = []
  for (const x of t.extras ?? []) {
    if (x === 'property' && c.property) {
      const link = withUtm(c.property.url, utm, 'enquiry_reply')
      out.push(`<tr><td style="padding:8px 40px 0;" class="px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line}; border-radius:14px;"><tr>
${c.property.photo ? `<td width="180" valign="top" style="padding:0;"><a href="${esc(link)}" target="_blank"><img src="${esc(c.property.photo)}" width="180" alt="" style="display:block; width:180px; height:auto; border-radius:13px 0 0 13px;"/></a></td>` : ''}
<td valign="middle" style="padding:16px 18px;"><p style="margin:0; font-family:${SERIF}; font-size:22px; line-height:28px; color:${C.ink};">${esc(c.property.priceText)}</p>
<p style="margin:4px 0 0; font-family:${SANS}; font-size:14px; line-height:20px; color:${C.body};">${esc(c.property.address)}</p>
${c.property.specs.length ? `<p style="margin:6px 0 0; font-family:${SANS}; font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:${C.faint};">${c.property.specs.map(esc).join(' &middot; ')}</p>` : ''}
<p style="margin:10px 0 0; font-family:${SANS}; font-size:13px; font-weight:bold;"><a href="${esc(link)}" target="_blank" style="color:${C.gold}; text-decoration:none;">See the photos &amp; details &rarr;</a></p></td>
</tr></table></td></tr>`)
    }
    if (x === 'sold' && c.sold.length) {
      out.push(box(`${label(`Recently sold near ${c.postcode ?? 'you'}`)}
${c.sold.map((s) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};"><tr>
<td valign="top" style="padding:9px 0; font-family:${SANS}; font-size:14px; line-height:20px; color:${C.ink};">${esc(s.where)}<br/><span style="font-size:12px; color:${C.faint};">${esc(s.type)} &middot; ${esc(s.when)}</span></td>
<td valign="top" align="right" style="padding:9px 0; font-family:${SERIF}; font-size:18px; line-height:22px; color:${C.ink}; white-space:nowrap;">${esc(s.price)}</td></tr></table>`).join('\n')}
<p style="margin:8px 0 0; font-family:${SANS}; font-size:11px; line-height:16px; color:${C.faint};">Prices paid, from HM Land Registry. Your valuation takes in your home’s size, condition and what’s selling now.</p>`))
    }
    if (x === 'evidence') {
      // The homes staff chose, if any; otherwise the Land Registry sales nearby (of the same type when known).
      const rows = (c.evidence?.length ? c.evidence : c.sold.map((s) => ({ where: s.where, price: s.price, what: `Sold ${s.when} · ${s.type}` }))).slice(0, 6)
      if (rows.length) out.push(box(`${label(c.kind === 'lettings-valuation' ? 'Similar homes nearby' : 'Homes we compared yours with')}
${rows.map((s) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.line};"><tr>
<td valign="top" style="padding:9px 0; font-family:${SANS}; font-size:14px; line-height:20px; color:${C.ink};">${esc(s.where)}<br/><span style="font-size:12px; color:${C.faint};">${esc(s.what)}</span></td>
<td valign="top" align="right" style="padding:9px 0; font-family:${SERIF}; font-size:18px; line-height:22px; color:${C.ink}; white-space:nowrap;">${esc(s.price)}</td></tr></table>`).join('\n')}`))
    }
    if (x === 'landlord') {
      const fee = `${LETTINGS.percent}%${LETTINGS.vat === 'plus' ? ' + VAT' : ''}`
      out.push(box(`${label(`Fully managed for ${fee} of the rent`)}
${LETTINGS.includes.slice(0, 5).map(([t]) => tick(t)).join('\n')}
<p style="margin:6px 0 0; font-family:${SANS}; font-size:12px; line-height:18px; color:${C.faint};">Nothing to pay up front: our fee comes out of the rent we collect.</p>`))
    }
    if (x === 'tenant-docs') {
      out.push(box(`${label('If you’d like to apply, you’ll need')}
${tick('Photo ID, for identity and Right to Rent')}
${tick('Proof of income', 'Recent payslips or bank statements, or a guarantor')}
${tick('Your current or previous landlord’s details')}
${tick('A holding deposit of no more than one week’s rent', 'Refundable, and it comes off your first payment')}`))
    }
    if (x === 'seller-docs') {
      out.push(box(`${label('Useful to have to hand')}
${tick('The lease, for a flat or maisonette')}
${tick('Any planning or building control papers')}
${tick('Details of recent work', 'A new boiler, windows, rewiring or an extension')}`))
    }
  }
  return out.join('\n')
}

/** The branded email for one template, with the wording staff may have edited. */
export function renderEnquiryEmail(c: EnquiryEmailContext, t: EnquiryTemplate, subject: string, message: string): Rendered {
  const utm = `enquiry_${c.kind}_${t.key}`
  const cta = t.cta?.(c) ?? null
  const site = withUtm(`${c.base}/`, utm, 'enquiry_reply')
  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(subject)}</title>
<style type="text/css">
body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; } table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; } body { margin:0 !important; padding:0 !important; width:100% !important; }
a { color:${C.gold}; }
@media screen and (max-width:640px) { .container { width:100% !important; max-width:100% !important; } .px { padding-left:22px !important; padding-right:22px !important; } }
</style></head>
<body style="margin:0; padding:0; background-color:${C.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">

<tr><td style="padding:4px 8px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><a href="${esc(site)}" target="_blank" style="text-decoration:none;"><span style="font-family:${SANS}; font-size:15px; font-weight:bold; letter-spacing:3px; color:${C.ink};">PRESTON HILL</span><br/><span style="font-family:${SANS}; font-size:11px; letter-spacing:5px; color:${C.gold};">ESTATES</span></a></td>
<td valign="middle" align="right" style="font-family:${SANS}; font-size:11px; letter-spacing:2px; color:${C.gold};">EST. 2004 &middot; HARROW</td>
</tr></table></td></tr>

<tr><td bgcolor="${C.card}" style="border:1px solid ${C.line}; border-radius:18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:40px 40px 4px;" class="px">${kicker(t.kicker)}${paragraphs(message)}</td></tr>
${extrasHtml(c, t, utm)}
${cta ? `<tr><td align="left" style="padding:26px 40px 0;" class="px">${button(withUtm(cta.href, utm, 'enquiry_reply'), cta.label)}</td></tr>` : ''}
<tr><td style="padding:30px 40px 36px;" class="px">
<p style="margin:0; font-family:${SANS}; font-size:15px; line-height:22px; color:${C.ink};">Kind regards,</p>
<p style="margin:4px 0 0; font-family:${SERIF}; font-size:20px; line-height:26px; color:${C.ink};">${esc(c.sender.name)}</p>
<p style="margin:2px 0 0; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">Preston Hill Estates &middot; <a href="tel:+442089049005" style="color:${C.gold}; text-decoration:none;">${PHONE}</a></p>
</td></tr>
</table></td></tr>

<tr><td align="center" style="padding:28px 24px 6px;">
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.body};"><b>Preston Hill Estates</b> &middot; Independent estate agents since 2004</p>
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">271 Preston Road, Harrow HA3 0PS</p>
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">Monday to Friday 9.00 to 17.30 &middot; Saturday 10.00 to 13.00</p>
<p style="margin:0 0 18px; font-family:${SANS}; font-size:13px; line-height:20px;"><a href="tel:+442089049005" style="color:${C.gold}; text-decoration:none;">${PHONE}</a> &middot; <a href="mailto:${esc(c.sender.email)}" style="color:${C.gold}; text-decoration:none;">${esc(c.sender.email)}</a></p>
<p style="margin:0 0 12px; font-family:${SANS}; font-size:10px; letter-spacing:2px; color:#B8B4A2;">THE PROPERTY OMBUDSMAN &middot; SAFEAGENT &middot; PRS &middot; MYDEPOSITS</p>
<p style="margin:0; font-family:${SANS}; font-size:11px; color:#B8B4A2;">Preston Hill Estates Ltd &middot; Company No. 05058532</p>
</td></tr>
</table></td></tr></table>
</body></html>`
  const text = [
    message,
    c.property && t.extras?.includes('property') ? `\n${c.property.priceText} · ${c.property.address}\n${c.property.url}` : '',
    cta ? `\n${cta.label}: ${cta.href}` : '',
    `\nKind regards,\n${c.sender.name}\nPreston Hill Estates · ${PHONE}\n271 Preston Road, Harrow HA3 0PS`,
  ].filter(Boolean).join('\n')
  return { html, text }
}

export const templateFor = (kind: EnquiryEmailKind, key: string) => ENQUIRY_TEMPLATES[kind].find((t) => t.key === key) ?? null
