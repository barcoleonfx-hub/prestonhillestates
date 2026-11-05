import 'server-only'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { convert } from 'html-to-text'
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser'
import { RETENTION_MONTHS, retentionCutoff } from './retention'

/** What the import page shows for one email, and what gets saved if it's ticked. */
export type ImportRow = {
  key: string // Message-ID (or a hash) so nothing is imported twice
  date: string // ISO
  category: 'portal' | 'website' | 'person' | 'skipped'
  source: 'zoopla' | 'onthemarket' | 'website' | 'email'
  reason?: string // why it was skipped
  name: string
  email: string | null
  phone: string | null
  subject: string
  about: string | null // property or address mentioned
  message: string // trimmed body, for the enquiry note
  intent: 'buy' | 'rent' | 'valuation' | null
  /** Structured details read from portal lead emails, shown in the review and saved in the note. */
  details: string[]
  situation: string | null // e.g. "I am a first-time buyer" → the contact's position
  applicantAddress: string | null // where the applicant lives (OnTheMarket includes it)
  propertyPostcode: string | null
}

const OWN_DOMAIN = /@prestonhillestates\.(com|co\.uk)$/i
const NO_REPLY = /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|bounce)/i
const PHONE = /(?:\+44\s?\(?0?\)?\s?|\(?0)(?:\d\s?){9,10}\d?/g
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const EMAIL1 = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

/** Splits an mbox file (Apple Mail's "Export Mailbox…") into raw messages without loading it all into memory. */
export async function* mboxMessages(path: string): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  let buf: string[] = []
  let started = false
  for await (const line of rl) {
    if (/^From \S+.*\d{4}\s*$/.test(line) || (/^From /.test(line) && !started)) {
      if (buf.length) yield buf.join('\n')
      buf = []
      started = true
      continue
    }
    // mboxrd escaping: ">From " at the start of a body line
    buf.push(/^>+From /.test(line) ? line.slice(1) : line)
  }
  if (buf.length && buf.some((l) => l.trim())) yield buf.join('\n')
}

const first = (a: AddressObject | AddressObject[] | undefined) => (Array.isArray(a) ? a[0] : a)?.value?.[0]

function field(text: string, labels: string[]): string | null {
  for (const l of labels) {
    const m = new RegExp(`^\\s*(?:${l})\\s*[:\\-]\\s*(.+)$`, 'im').exec(text)
    if (m && m[1].trim()) return m[1].trim().slice(0, 200)
  }
  return null
}

const tidyPhone = (p: string | null) => {
  if (!p) return null
  const d = p.replace(/[^\d+]/g, '')
  return d.replace(/\D/g, '').length >= 10 ? p.replace(/\s+/g, ' ').trim() : null
}

function intentOf(text: string): ImportRow['intent'] {
  const t = text.toLowerCase()
  if (/valuation|value my|sell my|selling my|market appraisal/.test(t)) return 'valuation'
  if (/to rent|to let|rental|tenant|letting|pcm/.test(t)) return 'rent'
  if (/viewing|for sale|buy|offer|mortgage/.test(t)) return 'buy'
  return null
}

// ---------- portal lead formats ----------

/** Plain-text lines with link targets, image placeholders and bullet marks removed. */
export function cleanLines(text: string): string[] {
  return text
    .replace(/\[(?:https?:|mailto:|cid:)[^\]]*\]/gi, '')
    .replace(/<(?:https?:|mailto:)[^>]*>/gi, '')
    .replace(/\[(?:image|\?)[^\]]*\]/gi, '')
    .split('\n')
    .map((l) => l.replace(/^[\s*•·▪◦□■\u2610\u25A1\-–]+/u, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

const fullPostcode = (s: string | null) => {
  const m = s ? /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i.exec(s) : null
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null
}

/** "Label: value" on one line, or the label on its own line with the value on the next. */
function labelled(lines: string[], labels: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    for (const l of labels) {
      const m = new RegExp(`^${l.replace(/\s+/g, '\\s+')}\\s*:\\s*(.*)$`, 'i').exec(lines[i])
      if (!m) continue
      const v = m[1].trim() || (lines[i + 1] && !/^[A-Za-z][A-Za-z ]{1,30}:/.test(lines[i + 1]) ? lines[i + 1] : '')
      if (v) return v.slice(0, 300)
    }
  }
  return null
}

const enquiryIntent = (s: string | null): ImportRow['intent'] => {
  const t = (s ?? '').toLowerCase()
  if (/vendor|seller|landlord|valuation|valu/.test(t)) return 'valuation'
  if (/tenant|renter|rental|to rent|letting/.test(t)) return 'rent'
  if (/buyer|viewing|purchase|buy/.test(t)) return 'buy'
  return null
}

type Lead = Pick<ImportRow, 'name' | 'email' | 'phone' | 'about' | 'intent' | 'details' | 'situation' | 'applicantAddress' | 'propertyPostcode'> & { comments: string | null }

/** Zoopla "You have a new Buyer enquiry" emails: a table of labelled fields plus the listing card. */
export function parseZoopla(lines: string[]): Lead | null {
  const name = labelled(lines, ['Name'])
  const phone = tidyPhone(labelled(lines, ['Telephone', 'Phone', 'Mobile']))
  const email = labelled(lines, ['Email', 'E-mail'])?.match(EMAIL)?.[0] ?? null
  if (!name && !phone && !email) return null
  const kind = lines.map((l) => /new\s+(\w+)\s+enquiry/i.exec(l)?.[1]).find(Boolean) ?? null
  const type = labelled(lines, ['Type of enquiry'])
  const situation = labelled(lines, ['About'])
  const ref = labelled(lines, ['Unique Reference', 'Reference'])
  const address = labelled(lines, ['Address', 'Property address'])
  const postcode = labelled(lines, ['Postcode'])
  const priceLine = lines.find((l) => /^£\s?[\d,]+/.test(l)) ?? null
  const location = labelled(lines, ['Location'])
  const propType = labelled(lines, ['Type of property'])
  const comments = labelled(lines, ['Message', 'Comments', 'Additional information'])
  const details = [
    kind ? `Zoopla ${kind.toLowerCase()} enquiry` : 'Zoopla enquiry',
    type ? `Type of enquiry: ${type}` : '',
    address ? `Property: ${address}${postcode ? ` (${postcode.toUpperCase()})` : ''}` : '',
    priceLine ? `Listing: ${priceLine.replace(/\s+-\s+/, ' – ')}` : '',
    ref ? `Zoopla reference: ${ref}` : '',
    situation ? `Situation: ${situation}` : '',
    propType ? `Looking for: ${propType}` : '',
    location ? `Location: ${location}` : '',
    comments ? `Comments: ${comments}` : '',
  ].filter(Boolean)
  return {
    name: name ?? '', email, phone, about: address ?? priceLine, intent: enquiryIntent(`${kind ?? ''} ${type ?? ''}`) ?? 'buy',
    details, situation, applicantAddress: null, propertyPostcode: fullPostcode(postcode) ?? fullPostcode(address), comments,
  }
}

/** OnTheMarket "Arrange viewing" emails: a contact block, then enquiry details and the property. */
export function parseOnTheMarket(lines: string[]): Lead | null {
  const from = lines.map((l) => /received an?\s+(.+?)\s+(?:request|enquiry)\s+from\s+(.+?)\.?$/i.exec(l)).find(Boolean)
  const ci = lines.findIndex((l) => /^contact information$/i.test(l))
  const ei = lines.findIndex((l) => /^enquiry details$/i.test(l))
  if (ci < 0 && !from) return null
  const block = ci >= 0 ? lines.slice(ci + 1, ei > ci ? ei : ci + 6) : []
  const email = block.join(' ').match(EMAIL)?.[0] ?? labelled(lines, ['Email'])?.match(EMAIL)?.[0] ?? null
  const phone = tidyPhone(block.find((l) => (l.match(PHONE) ?? []).length > 0) ?? labelled(lines, ['Telephone', 'Phone']))
  const name = (from?.[2] ?? block.find((l) => !EMAIL1.test(l) && !(l.match(PHONE) ?? []).length && !fullPostcode(l)) ?? '').trim()
  const applicantAddress = block.find((l) => fullPostcode(l) && !EMAIL1.test(l)) ?? null
  const after = ei >= 0 ? lines.slice(ei + 1) : lines
  const wants = labelled(after, ['I would like'])
  const situation = labelled(after, ['Situation', 'My situation'])
  const comments = labelled(after, ['Comments', 'Message'])
  const whatsapp = after.some((l) => /whatsapp/i.test(l))
  // The property is the first line after the details that carries a postcode and isn't their own address.
  const property = after.find((l) => fullPostcode(l) && l !== applicantAddress && !/^(comments|situation|i would like)\s*:/i.test(l)) ?? null
  const what = from?.[1] ?? wants ?? ''
  const details = [
    `OnTheMarket ${(from?.[1] ?? 'enquiry').toLowerCase()}${from?.[1] && !/request|enquiry/i.test(from[1]) ? ' request' : ''}`,
    wants ? `Wants: ${wants}` : '',
    property ? `Property: ${property.replace(/\s+,/g, ',')}` : '',
    situation ? `Situation: ${situation}` : '',
    whatsapp ? 'Happy to be contacted on WhatsApp' : '',
    comments ? `Comments: ${comments}` : '',
    applicantAddress ? `Their address: ${applicantAddress}` : '',
  ].filter(Boolean)
  return {
    name, email, phone, about: property?.replace(/\s+,/g, ',') ?? null, intent: enquiryIntent(what) ?? 'buy',
    details, situation, applicantAddress, propertyPostcode: fullPostcode(property), comments,
  }
}

/**
 * HTML emails (Zoopla, OnTheMarket) are laid out in tables. Put every cell on its own line, never wrap long
 * lines, drop images and link addresses, so "Name:" and its value stay readable and nothing is cut off.
 */
const TEXT_OPTIONS = {
  wordwrap: false as const,
  selectors: [
    { selector: 'img', format: 'skip' },
    { selector: 'a', options: { ignoreHref: true } },
    ...['table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th'].map((selector) => ({ selector, format: 'block' })),
    ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({ selector, options: { uppercase: false } })),
    { selector: 'ul', options: { itemPrefix: '* ' } },
  ],
}
export const emailText = (mail: Pick<ParsedMail, 'html' | 'text'>) =>
  (typeof mail.html === 'string' && mail.html ? convert(mail.html, TEXT_OPTIONS) : mail.text ?? '')

/** Reads one email and decides whether it looks like an enquiry, and from whom. */
export async function analyse(raw: string, nowMs = Date.now()): Promise<ImportRow | null> {
  let mail: ParsedMail
  try {
    mail = await simpleParser(raw, { skipHtmlToText: false, skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true })
  } catch {
    return null
  }
  const from = first(mail.from)
  // Not an email at all (e.g. an index file or a text note).
  if (!from && !mail.date && !mail.subject && !mail.messageId) return null
  const replyTo = first(mail.replyTo)
  const subject = (mail.subject ?? '').slice(0, 200)
  const text = emailText(mail).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  const date = (mail.date ?? new Date(0)).toISOString()
  const key = (mail.messageId ?? `${from?.address}|${date}|${subject}`).slice(0, 300)
  const senderText = `${from?.address ?? ''} ${from?.name ?? ''} ${replyTo?.address ?? ''}`.toLowerCase()
  const haystack = `${senderText} ${subject} ${text.slice(0, 2000)}`.toLowerCase()

  const lines = cleanLines(text)
  const joined = lines.join('\n')
  const looksOtm = lines.some((l) => /^contact information$/i.test(l)) && lines.some((l) => /^enquiry details$/i.test(l))
  const looksZoopla = /zooplapro|you have a new \w+ enquiry/i.test(joined) && lines.some((l) => /^(name|telephone)\s*:/i.test(l))
  const source: ImportRow['source'] = /zoopla/.test(senderText) || /zoopla/.test(subject.toLowerCase()) || looksZoopla ? 'zoopla'
    : /onthemarket/.test(senderText) || /onthemarket|on the market/.test(subject.toLowerCase()) || looksOtm ? 'onthemarket'
      : /wix|squarespace|wordpress|form submission|website enquiry|contact form|new submission/.test(haystack) ? 'website'
        : 'email'

  // Portal leads have a known layout: read every field they carry.
  const lead = source === 'zoopla' ? parseZoopla(lines) ?? parseOnTheMarket(lines) : source === 'onthemarket' ? parseOnTheMarket(lines) ?? parseZoopla(lines) : null
  // A buyer who has to sell first is also a valuation for us.
  if (lead && /property to sell|home to sell|need to sell|have to sell|selling my/i.test(lead.situation ?? '')) lead.details.push('Has a home to sell: offer a valuation')

  // Anything else: labelled fields first (form emails), then reply-to, then the sender.
  const labelledName = lead?.name || field(text, ['name', 'full name', 'your name', 'applicant name', 'customer name', 'contact name'])
  const labelledEmail = lead?.email ?? field(text, ['email', 'e-mail', 'email address', 'your email'])?.match(EMAIL1)?.[0] ?? null
  const labelledPhone = lead?.phone ?? tidyPhone(field(text, ['phone', 'telephone', 'tel', 'mobile', 'phone number', 'contact number', 'your phone']))
  const about = lead?.about ?? field(text, ['property', 'property address', 'address', 'listing', 'property reference', 'ref', 'regarding'])
  const bodyEmails = (text.match(EMAIL) ?? []).filter((e) => !OWN_DOMAIN.test(e) && !NO_REPLY.test(e) && !/zoopla|onthemarket|wix/i.test(e))
  const bodyPhone = tidyPhone((text.match(PHONE) ?? []).find((p) => !p.replace(/\D/g, '').match(/20(81277001|89049005)$/)) ?? null)

  const directSender = from?.address && !OWN_DOMAIN.test(from.address) && !NO_REPLY.test(from.address) && source === 'email' ? from : null
  const goodReplyTo = replyTo?.address && !OWN_DOMAIN.test(replyTo.address) && !NO_REPLY.test(replyTo.address) && !/zoopla|onthemarket|wix/i.test(replyTo.address) ? replyTo : null

  const email = labelledEmail ?? goodReplyTo?.address ?? (source === 'email' ? directSender?.address : bodyEmails[0]) ?? null
  const phone = labelledPhone ?? bodyPhone
  const name = (labelledName || goodReplyTo?.name || directSender?.name || (email ? email.split('@')[0].replace(/[._]/g, ' ') : '') || '').trim().slice(0, 120)

  const row: ImportRow = {
    key, date, source, subject, name: name || 'Unknown', email: email?.toLowerCase() ?? null, phone,
    about,
    message: lead
      ? [...lead.details, subject ? `Email subject: ${subject}` : ''].filter(Boolean).join('\n')
      : [subject && `Subject: ${subject}`, text.slice(0, 1500)].filter(Boolean).join('\n'),
    intent: lead?.intent ?? intentOf(haystack),
    category: source === 'zoopla' || source === 'onthemarket' ? 'portal' : source === 'website' ? 'website' : 'person',
    details: lead?.details ?? [],
    situation: lead?.situation ?? null,
    applicantAddress: lead?.applicantAddress ?? null,
    propertyPostcode: lead?.propertyPostcode ?? null,
  }

  // Things that aren't enquiries.
  const skip = (reason: string) => ({ ...row, category: 'skipped' as const, reason })
  if (new Date(date).getTime() < new Date(retentionCutoff(new Date(nowMs))).getTime()) return skip(`Older than ${RETENTION_MONTHS / 12} years`)
  if (from?.address && OWN_DOMAIN.test(from.address) && !goodReplyTo && !labelledName) return skip('Sent from our own address')
  const bulk = mail.headers.has('list') || mail.headers.has('list-unsubscribe') || /bulk|list|junk/i.test(String(mail.headers.get('precedence') ?? '')) || /auto-generated|auto-replied/i.test(String(mail.headers.get('auto-submitted') ?? ''))
  if (bulk && !lead && !labelledName) return skip('Newsletter or mailing list')
  if (row.category === 'person' && from?.address && NO_REPLY.test(from.address)) return skip('Automated email')
  if (!email && !phone) return skip('No name, email or phone to link it to')
  return row
}
