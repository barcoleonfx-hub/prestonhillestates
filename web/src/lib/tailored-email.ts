// Tailored emails: one-off emails staff write and address themselves (another agent, an investor, a solicitor),
// with a banner picture, a property spotlight with photos, a highlighted terms box and a button. Pure: no server
// imports, so the editor's live preview and the sender render exactly the same email.
import { C, SANS, SERIF, button, esc } from './property-email'

export type EmailImage = { id: string; url: string; alt: string }

export type TailoredContent = {
  subject: string
  preheader: string
  /** "Dear {name}," — {name} is each person's name, or `fallbackName` when there isn't one. */
  greeting: string
  fallbackName: string
  hero: EmailImage | null
  eyebrow: string
  headline: string
  intro: string
  spotlight: { show: boolean; label: string; title: string; address: string; photos: EmailImage[]; facts: string; price: string; link: string; linkLabel: string }
  terms: { show: boolean; title: string; rows: string; note: string }
  body: string
  /** Optional button. "{reply}" as the link opens a reply to us. */
  cta: { label: string; url: string }
  signoff: string
  signedBy: string
  signTitle: string
  phone: string
}

export type Recipient = { email: string; name: string }

/** At most this many people per send: these are personal emails, not a mailing list (that's what campaigns are for). */
export const MAX_RECIPIENTS = 25

const EMAIL = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

/**
 * The "To" box: one person per line (or separated by ;). "jo@agency.co.uk", "Jo Smith <jo@agency.co.uk>" and
 * "Foxtons Wembley - wembley@foxtons.co.uk" all work; a line of several bare addresses is several people.
 */
export function parseRecipients(text: string): { list: Recipient[]; bad: string[] } {
  const list: Recipient[] = [], bad: string[] = [], seen = new Set<string>()
  for (const seg of text.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean)) {
    const found = seg.match(EMAIL) ?? []
    if (!found.length) { bad.push(seg); continue }
    const name = found.length === 1 ? seg.replace(found[0], '').replace(/[<>()"“”,:–—-]+/g, ' ').replace(/\s+/g, ' ').trim() : ''
    for (const e of found) {
      const email = e.toLowerCase()
      if (seen.has(email)) continue
      seen.add(email)
      list.push({ email, name: name.slice(0, 80) })
    }
  }
  return { list, bad }
}

/** "[Number of rooms]"-style gaps left in the text, so nothing goes out half-finished. */
export function gapsIn(c: TailoredContent): string[] {
  const all = [c.subject, c.preheader, c.greeting, c.eyebrow, c.headline, c.intro, c.body, c.cta.label, c.signedBy, c.signTitle,
    ...(c.spotlight.show ? [c.spotlight.title, c.spotlight.address, c.spotlight.facts, c.spotlight.price, c.spotlight.label] : []),
    ...(c.terms.show ? [c.terms.title, c.terms.rows, c.terms.note] : [])].join('\n')
  return [...new Set(all.match(/\[[^\]\n]{2,60}\]/g) ?? [])]
}

const personal = (t: string, r: Recipient, fallback: string) => t.replace(/\{name\}/g, r.name || fallback || 'there').replace(/\{first_name\}/g, (r.name || fallback || 'there').split(/\s+/)[0])

// ---------- starting points ----------

const blankContent = (signedBy: string): TailoredContent => ({
  subject: '', preheader: '', greeting: 'Dear {name},', fallbackName: 'Sir or Madam', hero: null, eyebrow: '', headline: '', intro: '',
  spotlight: { show: false, label: 'The property', title: '', address: '', photos: [], facts: '', price: '', link: '', linkLabel: 'See the full details' },
  terms: { show: false, title: 'The terms', rows: '', note: '' },
  body: '', cta: { label: '', url: '' }, signoff: 'Kind regards,', signedBy, signTitle: 'Preston Hill Estates', phone: '020 8904 9005',
})

export const TAILORED_TEMPLATES: { key: string; name: string; about: string; content: (signedBy: string) => TailoredContent }[] = [
  {
    key: 'agent-split', name: 'Work with another agent', about: 'Invite another agency to help sell one of our instructions, with a shared commission. Property spotlight and the terms in a box.',
    content: (signedBy) => ({
      ...blankContent(signedBy),
      subject: 'Joint agency opportunity: HMO in Neasden, NW10 (50% fee share)',
      preheader: 'An HMO at 468 North Circular Road ready to come to market, with half of our 1.5% fee for the agency that finds the buyer.',
      eyebrow: 'Joint agency opportunity',
      headline: 'Shall we sell this *together?*',
      intro: 'I hope you’re well. I’m writing from Preston Hill Estates, the independent agency on Preston Road in Harrow, where we’ve been selling and letting homes since 2004.\n\nWe’re about to bring an HMO in Neasden to the market, and we’d like to work with an agency that knows the NW10 buyers and investors as well as you do.',
      spotlight: {
        show: true, label: 'The property', title: 'HMO for sale', address: '468 North Circular Road, Neasden, London NW10 1SP', photos: [],
        facts: 'House in multiple occupation (HMO)\n[Number of lettable rooms]\n[HMO licence and tenancy position]', price: '[Guide price, or “Price on application”]', link: '', linkLabel: 'See the full details',
      },
      terms: { show: true, title: 'The terms', rows: 'Our total fee: 1.5% of the final sale price\nYour share: 50% of that fee\nWhen: on the successful sale to a buyer you introduce', note: '' },
      body: 'If you have investors or HMO buyers on your books, we’ll send you the photographs and full details so you can put it in front of them straight away.\n\nIf this is of interest, reply to this email or call me on 020 8904 9005 and we can agree the details. I look forward to hearing from you.',
      cta: { label: 'Reply to discuss', url: '{reply}' },
      signTitle: 'Founder, Preston Hill Estates',
    }),
  },
  {
    key: 'investor', name: 'Introduce a property to a buyer or investor', about: 'Put one property in front of someone you know who might buy it, before it goes on the portals.',
    content: (signedBy) => ({
      ...blankContent(signedBy),
      subject: 'Before it goes on the market: [property] in [area]',
      preheader: 'You’re one of the first people we’re telling about this one.',
      greeting: 'Dear {name},', fallbackName: 'there',
      eyebrow: 'Before it goes on the market',
      headline: 'One we thought you’d *want to see*',
      intro: 'I hope you’re well. We’ve just been asked to sell a property that I think fits what you’ve been looking for, and I wanted you to hear about it before it goes on Rightmove, Zoopla and OnTheMarket.',
      spotlight: { show: true, label: 'The property', title: '[Headline, e.g. 3-bedroom semi with a large garden]', address: '[Full address]', photos: [], facts: '[Key feature]\n[Key feature]\n[Key feature]', price: '[Guide price]', link: '', linkLabel: 'See the full details' },
      body: 'If you’d like to see it, reply to this email or call me on 020 8904 9005 and I’ll arrange a viewing before it’s more widely advertised.',
      cta: { label: 'Book a viewing', url: '{reply}' },
      signTitle: 'Preston Hill Estates',
    }),
  },
  { key: 'blank', name: 'Start from scratch', about: 'A letter with your own words. Add a banner picture, a property spotlight, a terms box and a button if you like.', content: (signedBy) => blankContent(signedBy) },
]

export function emptyContent(signedBy: string) { return blankContent(signedBy) }

/** Fills in anything missing (older drafts), so the editor and sender always have every field. */
export function normalise(raw: Partial<TailoredContent> | null, signedBy: string): TailoredContent {
  const b = blankContent(signedBy)
  const r = raw ?? {}
  return { ...b, ...r, spotlight: { ...b.spotlight, ...(r.spotlight ?? {}) }, terms: { ...b.terms, ...(r.terms ?? {}) }, cta: { ...b.cta, ...(r.cta ?? {}) } }
}

// ---------- rendering ----------

/** Words in *asterisks* become gold italics. */
const fancy = (t: string) => esc(t).replace(/\*([^*]+)\*/g, `<em style="color:${C.goldBtn}; font-style:italic;">$1</em>`)
const paras = (t: string, color: string = C.body, size = 15) => t.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)
  .map((x) => `<p style="margin:0 0 14px; font-family:${SANS}; font-size:${size}px; line-height:${Math.round(size * 1.65)}px; color:${color};">${esc(x).replace(/\n/g, '<br/>')}</p>`).join('')
const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean)
const pad = (inner: string, bg: string = C.card, p = '0 40px 8px') => `<tr><td bgcolor="${bg}" class="px" style="padding:${p}; border-left:1px solid ${C.line}; border-right:1px solid ${C.line};">${inner}</td></tr>`
const linkFor = (url: string, sender: string, subject: string) => (url.trim() === '{reply}' ? `mailto:${sender}?subject=${encodeURIComponent(`Re: ${subject}`)}` : url.trim())

export type TailoredOptions = { base: string; senderEmail: string }

export function renderTailored(c: TailoredContent, r: Recipient, o: TailoredOptions): { subject: string; html: string; text: string } {
  const p = (t: string) => personal(t, r, c.fallbackName)
  const subject = p(c.subject || 'A note from Preston Hill Estates').slice(0, 160)
  const s = c.spotlight, t = c.terms
  const rows: string[] = []

  if (c.hero) rows.push(`<tr><td style="border-left:1px solid ${C.line}; border-right:1px solid ${C.line}; padding:0;" bgcolor="${C.card}"><img src="${esc(c.hero.url)}" width="598" alt="${esc(c.hero.alt)}" style="display:block; width:100%; max-width:598px; height:auto;"/></td></tr>`)
  const head = `${c.eyebrow.trim() ? `<p style="margin:0 0 12px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:2.5px; text-transform:uppercase; color:${C.gold};">${esc(p(c.eyebrow))}</p>` : ''}${c.headline.trim() ? `<p class="masthead" style="margin:0 0 22px; font-family:${SERIF}; font-size:36px; line-height:42px; color:${C.ink};">${fancy(p(c.headline))}</p>` : ''}`
  rows.push(pad(`${head}${c.greeting.trim() ? `<p style="margin:0 0 14px; font-family:${SANS}; font-size:15px; line-height:25px; color:${C.ink};">${esc(p(c.greeting))}</p>` : ''}${paras(p(c.intro))}`, C.card, `${c.hero ? 32 : 40}px 40px 10px`))

  if (s.show && (s.title.trim() || s.address.trim() || s.photos.length)) {
    const [main, ...more] = s.photos
    const thumbs = more.slice(0, 3)
    const href = s.link.trim() ? linkFor(s.link, o.senderEmail, subject) : ''
    const facts = lines(p(s.facts))
    rows.push(pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cream}" style="border:1px solid ${C.line}; border-radius:14px;">
${main ? `<tr><td style="padding:0;">${href ? `<a href="${esc(href)}" target="_blank">` : ''}<img src="${esc(main.url)}" width="518" alt="${esc(main.alt || s.address)}" style="display:block; width:100%; height:auto; border-radius:14px 14px 0 0;"/>${href ? '</a>' : ''}</td></tr>` : ''}
${thumbs.length ? `<tr><td style="padding:6px 6px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${thumbs.map((x, i) => `<td width="${Math.floor(100 / thumbs.length)}%" style="padding:0 ${i < thumbs.length - 1 ? 6 : 0}px 0 0;"><img src="${esc(x.url)}" width="${Math.floor(500 / thumbs.length)}" alt="${esc(x.alt)}" style="display:block; width:100%; height:auto; border-radius:8px;"/></td>`).join('')}</tr></table></td></tr>` : ''}
<tr><td style="padding:22px 24px 24px;">
${s.label.trim() ? `<p style="margin:0 0 8px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:2.5px; text-transform:uppercase; color:${C.gold};">${esc(p(s.label))}</p>` : ''}
${s.title.trim() ? `<p style="margin:0; font-family:${SERIF}; font-size:26px; line-height:32px; color:${C.ink};">${fancy(p(s.title))}</p>` : ''}
${s.address.trim() ? `<p style="margin:6px 0 0; font-family:${SANS}; font-size:14px; line-height:21px; color:${C.body};">&#9679;&nbsp; ${esc(p(s.address))}</p>` : ''}
${facts.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">${facts.map((f) => `<tr><td valign="top" style="padding:4px 10px 4px 0; font-family:${SANS}; font-size:14px; color:${C.goldBtn}; font-weight:bold;">&#10003;</td><td style="padding:4px 0; font-family:${SANS}; font-size:14px; line-height:21px; color:${C.ink};">${esc(f)}</td></tr>`).join('')}</table>` : ''}
${s.price.trim() ? `<p style="margin:16px 0 0; font-family:${SERIF}; font-size:22px; line-height:28px; color:${C.ink};">${esc(p(s.price))}</p>` : ''}
${href ? `<p style="margin:16px 0 0; font-family:${SANS}; font-size:13px; font-weight:bold; letter-spacing:1.5px; text-transform:uppercase;"><a href="${esc(href)}" target="_blank" style="color:${C.gold}; text-decoration:none;">${esc(s.linkLabel || 'See the full details')} &rarr;</a></p>` : ''}
</td></tr></table>`, C.card, '14px 40px 18px'))
  }

  if (t.show && lines(t.rows).length) {
    const tr = lines(p(t.rows)).map((l) => { const m = /^([^:]{1,60}):\s*(.+)$/.exec(l); return m ? [m[1], m[2]] : ['', l] })
    rows.push(pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.dark}" style="border-radius:14px;"><tr><td style="padding:24px 26px;">
<p style="margin:0 0 14px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:2.5px; text-transform:uppercase; color:${C.goldBtn};">${esc(p(t.title || 'The terms'))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${tr.map(([k, v], i) => `<tr><td valign="top" style="padding:10px 12px 10px 0; ${i ? 'border-top:1px solid #3A372C;' : ''} font-family:${SANS}; font-size:13px; line-height:19px; color:#B9B4A0; width:40%;">${esc(k)}</td><td valign="top" style="padding:10px 0; ${i ? 'border-top:1px solid #3A372C;' : ''} font-family:${k ? SERIF : SANS}; font-size:${k ? 18 : 14}px; line-height:24px; color:#FFFDF6;">${fancy(v)}</td></tr>`).join('')}</table>
${t.note.trim() ? `<p style="margin:12px 0 0; font-family:${SANS}; font-size:12px; line-height:18px; color:#98937F;">${esc(p(t.note))}</p>` : ''}
</td></tr></table>`, C.card, '4px 40px 20px'))
  }

  if (c.body.trim()) rows.push(pad(paras(p(c.body)), C.card, '8px 40px 6px'))
  if (c.cta.label.trim() && c.cta.url.trim()) rows.push(pad(`<div style="height:6px; line-height:6px; font-size:0;">&nbsp;</div>${button(linkFor(c.cta.url, o.senderEmail, subject), p(c.cta.label))}<div style="height:12px; line-height:12px; font-size:0;">&nbsp;</div>`, C.card, '4px 40px 10px'))

  rows.push(pad(`<div style="border-top:1px solid ${C.line}; height:1px; line-height:1px; font-size:0; margin:10px 0 22px;">&nbsp;</div>
<p style="margin:0; font-family:${SANS}; font-size:15px; color:${C.ink};">${esc(c.signoff || 'Kind regards,')}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>
<td valign="middle" style="padding-right:14px;"><img src="${o.base}/img/logo-mark.png" width="44" height="44" alt="" style="display:block; width:44px; height:44px;"/></td>
<td valign="middle"><p style="margin:0; font-family:${SERIF}; font-size:20px; line-height:24px; color:${C.ink};">${esc(c.signedBy)}</p>
${c.signTitle.trim() ? `<p style="margin:2px 0 0; font-family:${SANS}; font-size:13px; color:${C.faint};">${esc(c.signTitle)}</p>` : ''}
<p style="margin:4px 0 0; font-family:${SANS}; font-size:13px;">${c.phone.trim() ? `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}" style="color:${C.gold}; text-decoration:none;">${esc(c.phone)}</a> &middot; ` : ''}<a href="mailto:${esc(o.senderEmail)}" style="color:${C.gold}; text-decoration:none;">${esc(o.senderEmail)}</a></p></td>
</tr></table>`, C.card, '10px 40px 32px'))

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(subject)}</title>
<style type="text/css">
body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; } table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; } body { margin:0 !important; padding:0 !important; width:100% !important; }
@media screen and (max-width:640px) { .container { width:100% !important; max-width:100% !important; } .px { padding-left:20px !important; padding-right:20px !important; } .masthead { font-size:30px !important; line-height:36px !important; } }
</style></head>
<body style="margin:0; padding:0; background-color:${C.page};">
${c.preheader.trim() ? `<div style="display:none; font-size:1px; color:${C.page}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${esc(p(c.preheader))} &#8199;&#847; &#8199;&#847; &#8199;&#847; &#8199;&#847;</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
<tr><td style="padding:4px 8px 18px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:12px;"><a href="${o.base}/" target="_blank"><img src="${o.base}/img/logo-mark.png" width="46" height="46" alt="Preston Hill Estates" style="display:block; width:46px; height:46px;"/></a></td>
<td valign="middle"><a href="${o.base}/" target="_blank" style="text-decoration:none;"><span style="font-family:${SANS}; font-size:15px; font-weight:bold; letter-spacing:3px; color:${C.ink};">PRESTON HILL</span><br/><span style="font-family:${SANS}; font-size:11px; letter-spacing:5px; color:${C.gold};">ESTATES</span></a></td>
</tr></table></td></tr>
<tr><td style="font-size:0; line-height:0; height:${c.hero ? 0 : 6}px; border:1px solid ${C.line}; border-bottom:0; border-radius:18px 18px 0 0; overflow:hidden;" bgcolor="${C.card}">&nbsp;</td></tr>
${rows.join('\n')}
<tr><td style="font-size:0; line-height:0; height:8px; border:1px solid ${C.line}; border-top:0; border-radius:0 0 18px 18px;" bgcolor="${C.card}">&nbsp;</td></tr>
<tr><td align="center" style="padding:26px 24px 6px;">
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.body};"><b>Preston Hill Estates</b> &middot; Est. 2004</p>
<p style="margin:0 0 6px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.faint};">271 Preston Road, Harrow HA3 0PS &middot; <a href="tel:+442089049005" style="color:${C.gold}; text-decoration:none;">020 8904 9005</a></p>
<p style="margin:0 0 16px; font-family:${SANS}; font-size:10px; letter-spacing:2px; color:#B8B4A2;">THE PROPERTY OMBUDSMAN &middot; SAFEAGENT &middot; PRS &middot; MYDEPOSITS</p>
<p style="margin:0 0 6px; font-family:${SANS}; font-size:12px; line-height:18px; color:${C.faint};">If you’d rather not hear from us about opportunities like this, just reply and let us know.</p>
<p style="margin:0; font-family:${SANS}; font-size:11px; color:#B8B4A2;">Preston Hill Estates Ltd &middot; Company No. 05058532</p>
</td></tr></table></td></tr></table></body></html>`

  const text = [
    c.headline.trim() ? p(c.headline).replace(/\*/g, '').toUpperCase() : '', '',
    p(c.greeting), '', p(c.intro), '',
    ...(s.show && (s.title.trim() || s.address.trim()) ? [`${(s.label || 'The property').toUpperCase()}: ${p(s.title)}`, p(s.address), ...lines(p(s.facts)).map((f) => `- ${f}`), p(s.price), s.link.trim() && s.link.trim() !== '{reply}' ? s.link.trim() : '', ''] : []),
    ...(t.show && lines(t.rows).length ? [(t.title || 'The terms').toUpperCase(), ...lines(p(t.rows)).map((l) => `- ${l.replace(/\*/g, '')}`), t.note.trim() ? p(t.note) : '', ''] : []),
    p(c.body), '',
    c.signoff || 'Kind regards,', c.signedBy, c.signTitle, [c.phone, o.senderEmail].filter((x) => x.trim()).join(' · '), '',
    'Preston Hill Estates · 271 Preston Road, Harrow HA3 0PS · 020 8904 9005',
    'If you’d rather not hear from us about opportunities like this, just reply and let us know.',
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim()
  return { subject, html, text }
}
