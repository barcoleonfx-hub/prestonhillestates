// "Property email": a letter on our letterhead, in staff's own words, with an optional plain box about one of our
// homes (no photos: just its name and a few key details) and any attachments. Pure functions with no server imports,
// so the portal's live preview is exactly what gets sent.

import { C, SANS, SERIF, esc } from './property-email'

export type LetterProperty = {
  id: string
  ref: string
  /** "Kenton Road, Harrow HA3" */
  address: string
  /** "Guide price £650,000" */
  priceText: string
  /** "3 bedrooms", "2 bathrooms", "Semi-detached house", "Freehold"... only what the listing has. */
  facts: string[]
  url: string
}

export type LetterContent = {
  subject: string
  greeting: string
  body: string
  signoff: string
  signedBy: string
  signTitle: string
  propertyId: string | null
  showProperty: boolean
}

export type LetterRecipient = { email: string; name: string }
export type LetterFooter = 'unsubscribe' | 'reply' | 'plain'
export type LetterOptions = {
  base: string
  senderEmail: string
  property: LetterProperty | null
  attachments: string[]
  footer: LetterFooter
  unsubscribeUrl?: string | null
  /** "16 November 2026" */
  date: string
}

export const DEFAULT_GREETING = 'Dear {first name},'

export function blankLetter(signedBy: string): LetterContent {
  return { subject: '', greeting: DEFAULT_GREETING, body: '', signoff: 'Kind regards,', signedBy, signTitle: 'Preston Hill Estates', propertyId: null, showProperty: true }
}

/** First name for "Dear {first name}": not a title on its own ("Mr"), and nothing if we don't know it. */
export function firstNameOf(name: string): string {
  const parts = name.trim().replace(/["<>]/g, '').split(/\s+/).filter(Boolean)
  const first = parts[0] ?? ''
  if (/^(mr|mrs|ms|miss|dr|mx)\.?$/i.test(first)) return parts.length > 1 ? `${first.replace(/\.$/, '')} ${parts[parts.length - 1]}` : ''
  return first.includes('@') ? '' : first
}

/** Fills in {first name} and {name}. With no name: "Dear {first name}," becomes "Hello,", and a subject loses the gap. */
export function personalise(text: string, name: string, kind: 'greeting' | 'subject' | 'body'): string {
  const first = firstNameOf(name)
  const full = name.trim().includes('@') ? '' : name.trim()
  if (!first && /\{(first name|name)\}/i.test(text)) {
    if (kind === 'greeting') return 'Hello,'
    // "Hi {first name}, here's..." becomes "Hi, here's..."; "{first name}, a home for you" becomes "a home for you".
    return text.replace(/[ \t]*\{(first name|name)\}/gi, '').replace(/[ \t]+([,.!?])/g, '$1').replace(/^[ \t]*[,:][ \t]*/gm, '').trim()
  }
  return text.replace(/\{first name\}/gi, first).replace(/\{name\}/gi, full || first)
}

/** Message text to HTML: blank lines make paragraphs, **bold**, links, and lines starting "- " as bullet points. */
export function bodyHtml(text: string): string {
  const inline = (s: string) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, `<a href="$1" target="_blank" style="color:${C.gold}; text-decoration:underline;">$1</a>`)
  const P = `margin:0 0 16px; font-family:${SANS}; font-size:15px; line-height:25px; color:${C.ink};`
  const isBullet = (l: string) => /^\s*[-•*]\s+/.test(l)
  const list = (ls: string[]) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">${ls.map((l) => `<tr><td valign="top" style="padding:2px 10px 2px 2px; font-family:${SANS}; font-size:15px; line-height:24px; color:${C.goldBtn};">&#9679;</td><td style="padding:2px 0; font-family:${SANS}; font-size:15px; line-height:24px; color:${C.ink};">${inline(l.replace(/^\s*[-•*]\s+/, ''))}</td></tr>`).join('')}</table>`
  // Each paragraph: its plain lines as a paragraph, and any run of "- " lines as bullet points.
  return text.replace(/\r/g, '').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean).map((block) => {
    const runs: { bullet: boolean; lines: string[] }[] = []
    for (const l of block.split('\n')) {
      const b = isBullet(l)
      if (runs.length && runs[runs.length - 1].bullet === b) runs[runs.length - 1].lines.push(l)
      else runs.push({ bullet: b, lines: [l] })
    }
    return runs.map((r, i) => (r.bullet ? list(r.lines) : `<p style="${P}${runs[i + 1]?.bullet ? ' margin-bottom:6px;' : ''}">${r.lines.map(inline).join('<br/>')}</p>`)).join('')
  }).join('\n')
}

const bodyText = (text: string) => text.replace(/\r/g, '').replace(/\*\*(.+?)\*\*/g, '$1').trim()

export function renderLetter(c: LetterContent, r: LetterRecipient, o: LetterOptions): { subject: string; html: string; text: string } {
  const subject = (personalise(c.subject, r.name, 'subject') || 'A note from Preston Hill Estates').slice(0, 160)
  const greeting = personalise(c.greeting, r.name, 'greeting').trim()
  const body = personalise(c.body, r.name, 'body')
  const p = c.showProperty ? o.property : null
  const href = p ? `${p.url}${p.url.includes('?') ? '&' : '?'}utm_source=email&utm_medium=letter` : ''

  const propertyBox = p ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cream}" style="border:1px solid ${C.line}; border-left:4px solid ${C.goldBtn}; border-radius:10px; margin:6px 0 22px;">
<tr><td style="padding:18px 22px;">
<p style="margin:0 0 4px; font-family:${SANS}; font-size:11px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:${C.gold};">The property</p>
<p style="margin:0; font-family:${SERIF}; font-size:21px; line-height:27px; color:${C.ink};">${esc(p.address)}</p>
<p style="margin:6px 0 0; font-family:${SANS}; font-size:15px; line-height:22px; font-weight:bold; color:${C.ink};">${esc(p.priceText)}</p>
${p.facts.length ? `<p style="margin:6px 0 0; font-family:${SANS}; font-size:14px; line-height:21px; color:${C.body};">${p.facts.map(esc).join(' &middot; ')}</p>` : ''}
<p style="margin:6px 0 0; font-family:${SANS}; font-size:12px; line-height:18px; color:${C.faint};">Ref ${esc(p.ref)}</p>
<p style="margin:12px 0 0; font-family:${SANS}; font-size:14px; font-weight:bold;"><a href="${esc(href)}" target="_blank" style="color:${C.gold}; text-decoration:none;">View the property &rarr;</a></p>
</td></tr></table>` : ''

  const attached = o.attachments.length ? `<p style="margin:0 0 18px; font-family:${SANS}; font-size:13px; line-height:20px; color:${C.body};"><b>Attached:</b> ${o.attachments.map(esc).join(', ')}</p>` : ''
  const footerLine = o.footer === 'unsubscribe'
    ? `If you’d rather not get emails like this, ${o.unsubscribeUrl ? `<a href="${esc(o.unsubscribeUrl)}" style="color:${C.faint};">unsubscribe here</a>` : 'just reply and let us know'}.`
    : o.footer === 'reply' ? 'If you’d rather not hear from us, just reply and let us know.' : ''

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(subject)}</title>
<style type="text/css">
body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; } table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; } body { margin:0 !important; padding:0 !important; width:100% !important; }
@media screen and (max-width:640px) { .container { width:100% !important; } .px { padding-left:22px !important; padding-right:22px !important; } .lh-contact { display:none !important; } }
</style></head>
<body style="margin:0; padding:0; background-color:${C.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;" bgcolor="${C.card}">
<tr><td class="px" style="padding:30px 40px 0; border:1px solid ${C.line}; border-bottom:0; border-radius:14px 14px 0 0;" bgcolor="${C.card}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:12px;"><a href="${o.base}/" target="_blank"><img src="${o.base}/img/logo-mark.png" width="48" height="48" alt="Preston Hill Estates" style="display:block; width:48px; height:48px;"/></a></td>
<td valign="middle"><a href="${o.base}/" target="_blank" style="text-decoration:none;"><span style="font-family:${SANS}; font-size:16px; font-weight:bold; letter-spacing:3px; color:${C.ink};">PRESTON HILL</span><br/><span style="font-family:${SANS}; font-size:11px; letter-spacing:5px; color:${C.gold};">ESTATES</span></a></td>
</tr></table></td>
<td class="lh-contact" valign="middle" align="right" style="font-family:${SANS}; font-size:12px; line-height:18px; color:${C.faint};">271 Preston Road<br/>Harrow HA3 0PS<br/><a href="tel:+442089049005" style="color:${C.gold}; text-decoration:none;">020 8904 9005</a></td>
</tr></table>
<div style="height:3px; line-height:3px; font-size:0; background:${C.goldBtn}; margin:22px 0 0;">&nbsp;</div>
<div style="height:1px; line-height:1px; font-size:0; background:${C.line}; margin:3px 0 0;">&nbsp;</div>
</td></tr>
<tr><td class="px" style="padding:22px 40px 8px; border-left:1px solid ${C.line}; border-right:1px solid ${C.line};" bgcolor="${C.card}">
<p style="margin:0 0 22px; font-family:${SANS}; font-size:13px; color:${C.faint}; text-align:right;">${esc(o.date)}</p>
${greeting ? `<p style="margin:0 0 16px; font-family:${SANS}; font-size:15px; line-height:25px; color:${C.ink};">${esc(greeting)}</p>` : ''}
${bodyHtml(body)}
${propertyBox}
${attached}
<p style="margin:8px 0 0; font-family:${SANS}; font-size:15px; color:${C.ink};">${esc(c.signoff || 'Kind regards,')}</p>
<p style="margin:14px 0 0; font-family:${SERIF}; font-size:20px; line-height:26px; color:${C.ink};">${esc(c.signedBy)}</p>
${c.signTitle.trim() ? `<p style="margin:2px 0 0; font-family:${SANS}; font-size:13px; color:${C.faint};">${esc(c.signTitle)}</p>` : ''}
<p style="margin:4px 0 26px; font-family:${SANS}; font-size:13px;"><a href="tel:+442089049005" style="color:${C.gold}; text-decoration:none;">020 8904 9005</a> &middot; <a href="mailto:${esc(o.senderEmail)}" style="color:${C.gold}; text-decoration:none;">${esc(o.senderEmail)}</a></p>
</td></tr>
<tr><td style="font-size:0; line-height:0; height:10px; border:1px solid ${C.line}; border-top:0; border-radius:0 0 14px 14px;" bgcolor="${C.card}">&nbsp;</td></tr>
</table>
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;"><tr><td align="center" style="padding:22px 24px 6px;">
<p style="margin:0 0 6px; font-family:${SANS}; font-size:12px; line-height:18px; color:${C.faint};">Preston Hill Estates &middot; 271 Preston Road, Harrow HA3 0PS &middot; <a href="${o.base}/" style="color:${C.faint};">prestonhillestates.com</a></p>
${footerLine ? `<p style="margin:0 0 6px; font-family:${SANS}; font-size:12px; line-height:18px; color:${C.faint};">${footerLine}</p>` : ''}
<p style="margin:0; font-family:${SANS}; font-size:11px; color:#B8B4A2;">Preston Hill Estates Ltd &middot; Company No. 05058532</p>
</td></tr></table>
</td></tr></table></body></html>`

  const text = [
    o.date, '',
    greeting, '',
    bodyText(body), '',
    ...(p ? ['THE PROPERTY', p.address, p.priceText, p.facts.join(' · '), `Ref ${p.ref}`, `View the property: ${href}`, ''] : []),
    ...(o.attachments.length ? [`Attached: ${o.attachments.join(', ')}`, ''] : []),
    c.signoff || 'Kind regards,', c.signedBy, c.signTitle, `020 8904 9005 · ${o.senderEmail}`, '',
    'Preston Hill Estates · 271 Preston Road, Harrow HA3 0PS',
    ...(o.footer === 'unsubscribe' ? [`If you’d rather not get emails like this, ${o.unsubscribeUrl ? `unsubscribe here: ${o.unsubscribeUrl}` : 'just reply and let us know'}.`] : o.footer === 'reply' ? ['If you’d rather not hear from us, just reply and let us know.'] : []),
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim()
  return { subject, html, text }
}

/** Recipients typed as "Name <email>", "email", or one per line or separated by commas. */
export function parseAddresses(text: string): { list: LetterRecipient[]; bad: string[] } {
  const list: LetterRecipient[] = [], bad: string[] = [], seen = new Set<string>()
  for (const raw of text.split(/[\n;]+|,(?![^<]*>)/).map((x) => x.trim()).filter(Boolean)) {
    // "Name <email>" or just "email".
    const angled = /^(.*?)<([^<>]+)>$/.exec(raw)
    const addr = (angled ? angled[2] : raw).trim()
    if (!/^[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(addr)) { bad.push(raw); continue }
    const m = [raw, angled ? angled[1].replace(/"/g, '').trim() : '', addr]
    const email = m[2].toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)
    list.push({ email, name: (m[1] ?? '').trim() })
  }
  return { list, bad }
}

/** Attachments: PDFs, photos and Word documents, up to 10 MB each. All together: 15 MB, or 5 MB to more than 25 people. */
export const ATTACH_TYPES: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}
export const MAX_FILE = 10 * 1024 * 1024
export const attachLimit = (people: number) => (people > 25 ? 5 : 15) * 1024 * 1024
export const SEND_NOW_MAX = 25
