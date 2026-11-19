// WhatsApp the free way: staff send each message themselves, from the office phone or WhatsApp on a computer, with
// the words ready-written (a wa.me link). Nothing is sent automatically, so nothing is charged. Kept free of server
// code so it's easy to test.

/** The office WhatsApp number (07745 203146), in the form wa.me wants. */
export const OFFICE_WHATSAPP = '447745203146'

/** A link that opens WhatsApp with this message ready to send to this number. */
export function waLink(to: string, text: string): string {
  const digits = to.replace(/\D/g, '')
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

/** Numbers WhatsApp can reach: mobiles. A UK number must be 07...; other countries' numbers are allowed. */
export const canReach = (e164: string | null | undefined) => !!e164 && /^\+\d{8,15}$/.test(e164) && (!e164.startsWith('+44') || /^\+447\d{9}$/.test(e164))

function london(at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(at).map((x) => [x.type, x.value]))
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), mins: Number(p.hour) * 60 + Number(p.minute) }
}

/** Quiet times: all day Sunday, and before 9am or from 9pm on other days (London time). */
export const QUIET = { from: 21 * 60, until: 9 * 60, sunday: true }

/** Why now is a quiet time to message someone, or null if it's fine. */
export function quietReason(at = new Date()): string | null {
  const { day, mins } = london(at)
  if (QUIET.sunday && day === 0) return 'It’s Sunday'
  if (mins >= QUIET.from) return 'It’s after 9pm'
  if (mins < QUIET.until) return 'It’s before 9am'
  return null
}

/** When quiet time ends, in words: "after 9am", "after 9am on Monday", "on Monday after 9am". */
export function quietEnds(at = new Date()): string {
  const { day, mins } = london(at)
  if (day === 0) return 'on Monday after 9am'
  if (mins < QUIET.until) return 'after 9am'
  return day === 6 ? 'on Monday after 9am' : 'tomorrow after 9am'
}

export type WaTemplate = { key: string; label: string; text: string; marketing: boolean }

export type WaContext = {
  first: string
  me: string
  kind: 'viewing' | 'valuation' | 'buyer' | 'tenant' | 'general'
  isLet?: boolean
  /** The home they asked about, or the one to be valued. */
  address?: string | null
  /** Their next booked viewing or valuation, or the last one if it's happened. */
  appointment?: { kind: 'viewing' | 'valuation' | 'other'; when: string; address: string | null; past: boolean } | null
  /** Their personal property report (the valuation booklet at its private link). */
  report?: string | null
  /** The listing they asked about: its link, price and main facts. */
  home?: { url: string; price: string | null; specs: string[] } | null
  /** Our real overall Google rating, when it's been entered in the portal. */
  rating?: { rating: number; count: number } | null
  /** Two days to suggest, e.g. "Thursday or Friday". */
  days?: string | null
}

const sign = (me: string) => (me ? `\n\n${me}, Preston Hill Estates` : '\n\nPreston Hill Estates')
const hi = (first: string) => (first ? `Hi ${first}` : 'Hi')
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The next two days we're open (Monday to Saturday), starting tomorrow, in London: "Thursday or Friday". */
export function nextTwoDays(at = new Date()): string {
  const { day } = london(at)
  const out: string[] = []
  for (let d = 1; out.length < 2 && d < 8; d++) { const x = (day + d) % 7; if (x !== 0) out.push(x === (day + 1) % 7 ? 'tomorrow' : DAYS[x]) }
  return out.join(' or ')
}

/** "We’ve been selling homes around Preston Road since 2004, and we’re rated 4.9★ from 120 Google reviews." Only real figures. */
function proof(c: WaContext): string {
  const what = c.isLet ? 'letting homes' : c.kind === 'tenant' ? 'letting homes' : 'selling homes'
  const r = c.rating && c.rating.count >= 5 ? `, and we’re rated ${c.rating.rating.toFixed(1)}★ from ${c.rating.count} Google reviews` : ''
  return `We’ve been ${what} around Preston Road since 2004${r}.`
}

/** The ready-written messages for one lead. None of these are marketing: each is about their own enquiry. */
export function waTemplates(c: WaContext): WaTemplate[] {
  const me = c.me.split(/\s+/)[0] ?? ''
  const intro = me ? `it’s ${me} from Preston Hill Estates` : 'it’s Preston Hill Estates'
  const days = c.days || 'this week'
  const ask = c.days ? `Would *${days}* suit you` : 'When would suit you'
  const out: WaTemplate[] = []
  const lines: string[] = [`${hi(c.first)}, ${intro}, the estate agent at 271 Preston Road.`]
  if (c.kind === 'valuation') {
    lines.push(`Thank you for asking about a ${c.isLet ? 'rental' : 'sales'} valuation${c.address ? ` of *${c.address}*` : ''}.`)
    if (c.report) lines.push(`I’ve put together a free personal property report for your home, with recent prices nearby and a guide to your local area:\n${c.report}`)
    lines.push(`The next step is a short visit (about 30 minutes) so we can give you an accurate ${c.isLet ? 'rent' : 'price'}. It’s free and there’s no obligation. ${proof(c)}`)
    lines.push(`${ask} for us to come round? Just reply with a day and time that works for you.`)
  } else if (c.kind === 'viewing' && c.address) {
    const facts = c.home ? [c.home.price, ...c.home.specs.slice(0, 2)].filter(Boolean).join(' · ') : ''
    lines.push(`Thanks for your enquiry about *${c.address}*${facts ? ` (${facts})` : ''}.`)
    if (c.home?.url) lines.push(`Here are the full details and photos:\n${c.home.url}`)
    lines.push(`${ask} for a viewing? We’re open Monday to Friday 9 to 5.30 and Saturday 10 to 1.`)
    lines.push(c.isLet
      ? 'So I can help you best: when are you looking to move, and who would be living there?'
      : 'So I can help you best: are you buying with a mortgage, and do you have a home to sell?')
  } else if (c.kind === 'buyer' || c.kind === 'tenant') {
    lines.push(`Thanks for registering with us. So I can send you the right homes first, could you tell me:\n1. Which areas you’d like\n2. Your ${c.kind === 'tenant' ? 'monthly budget' : 'budget'}\n3. How many bedrooms\n4. When you’d like to move`)
    lines.push(`I’ll message you as soon as something suitable comes on. ${proof(c)}`)
  } else {
    lines.push('Thanks for getting in touch. How can I help? If it’s easier to talk, reply with a good time and I’ll call you.')
  }
  out.push({ key: 'intro', label: 'First reply', text: lines.join('\n\n'), marketing: false })
  const reportLine = c.kind === 'valuation' && c.report ? `\n\nIn the meantime, here’s your free property report:\n${c.report}` : ''
  out.push({ key: 'missed', label: 'Tried to call', text: `${hi(c.first)}, ${intro}. I’ve just tried to call you about your ${c.kind === 'valuation' ? 'valuation' : 'enquiry'}${c.address ? ` (${c.address})` : ''}.${reportLine}\n\nWhen’s a good time to ring you back?`, marketing: false })
  const a = c.appointment
  if (a && !a.past) {
    const thing = a.kind === 'valuation' ? 'valuation' : a.kind === 'viewing' ? 'viewing' : 'appointment'
    out.push({ key: 'reminder', label: `${thing[0].toUpperCase()}${thing.slice(1)} reminder`, text: `${hi(c.first)}, just a reminder of your ${thing}${a.address ? ` at ${a.address}` : ''} on ${a.when}. If you need to change it, reply here or call us on 020 8904 9005.${sign(me)}`, marketing: false })
  }
  if (a && a.past) {
    out.push(a.kind === 'valuation'
      ? { key: 'after', label: 'After the valuation', text: `${hi(c.first)}, thank you for having us round${a.address ? ` at ${a.address}` : ''}. If you have any questions about the valuation or how we’d ${c.isLet ? 'let' : 'sell'} it, just reply here.${sign(me)}`, marketing: false }
      : { key: 'after', label: 'After the viewing', text: `${hi(c.first)}, thanks for viewing${a.address ? ` ${a.address}` : ''}. What did you think? Happy to answer any questions or arrange a second look.${sign(me)}`, marketing: false })
  }
  out.push({
    key: 'checkin', label: 'Still looking?',
    text: c.kind === 'valuation'
      ? `${hi(c.first)}, ${intro}. Are you still thinking of ${c.isLet ? 'letting' : 'selling'}${c.address ? ` ${c.address}` : ''}?${c.report ? ` Your free property report is still here if you’d like a look:\n${c.report}\n\n` : ' '}Happy to come round whenever suits you, just reply here.`
      : `${hi(c.first)}, ${intro}. Are you still looking? If anything’s changed, let me know and I’ll keep an eye out for you.`,
    marketing: false,
  })
  out.push({ key: 'own', label: 'Write your own', text: `${hi(c.first)}, `, marketing: false })
  return out
}

// ---------- messages about one of our homes ----------

/** One of our homes, as the WhatsApp messages describe it. Everything comes from the listing itself. */
export type WaListing = {
  id: string
  channel: 'sale' | 'let'
  /** available, under_offer, sold_stc, sold, let_agreed, let, withdrawn */
  status: string
  /** "3 bedroom semi-detached house" */
  what: string
  address: string
  /** "Guide price £650,000", "£1,850 pcm" */
  price: string
  /** The main facts, each of which can be left in or out ("on": in the message to start with). */
  facts: { key: string; text: string; on: boolean }[]
  /** The listing's own words, short (a couple of sentences) and longer. */
  short: string
  long: string
  /** The listing's key features. */
  features: string[]
  url: string
  tour: string | null
}

/** What goes into a message about a home. */
export type WaPropertyOptions = {
  facts: string[]
  text: 'none' | 'short' | 'long'
  features: string[]
  link: boolean
  tour: boolean
  viewing: boolean
  ask: boolean
}

export const defaultPropertyOptions = (l: WaListing): WaPropertyOptions => ({
  facts: ['price', ...l.facts.filter((f) => f.on).map((f) => f.key)], text: l.short ? 'short' : 'none', features: l.features.slice(0, 5),
  link: true, tour: false, viewing: true, ask: true,
})

/** "the *3 bedroom semi-detached house* on *Carlton Avenue East, Wembley HA9*" */
const homeName = (l: WaListing) => `the *${l.what}* ${/^[a-z]/i.test(l.address) && !/^flat\b/i.test(l.address) ? 'on' : 'at'} *${l.address}*`

/** Under offer, sold or let: said plainly, so nobody arranges to see a home they can't have. */
function availability(l: WaListing): string | null {
  if (l.status === 'under_offer') return 'Just so you know, it’s currently *under offer*.'
  if (l.status === 'sold_stc') return 'Just so you know, it’s now *sold subject to contract*.'
  if (l.status === 'let_agreed') return 'Just so you know, it’s now *let agreed*.'
  if (['sold', 'let', 'withdrawn'].includes(l.status)) return 'Just so you know, it’s *no longer available*.'
  return null
}
const isAvailable = (l: WaListing) => l.status === 'available'

/** The questions that help us help them: how they're buying, or who's moving in and when. */
export const positionQuestion = (isLet: boolean) => isLet
  ? 'So I can help you best: when are you looking to move, and who would be living there?'
  : 'So I can help you best: are you buying with a mortgage, and do you have a home to sell?'

/** The details block: price and facts, the description, key features and links, as chosen. */
function details(l: WaListing, o: WaPropertyOptions): string[] {
  const out: string[] = []
  const facts = l.facts.filter((f) => o.facts.includes(f.key)).map((f) => f.text)
  const price = o.facts.includes('price') ? `*${l.price}*` : ''
  if (price || facts.length) out.push([price, facts.join(' · ')].filter(Boolean).join('\n'))
  const words = o.text === 'long' ? l.long || l.short : o.text === 'short' ? l.short : ''
  if (words) out.push(words)
  const feats = l.features.filter((f) => o.features.includes(f))
  if (feats.length) out.push(`*Key features*\n${feats.map((f) => `• ${f}`).join('\n')}`)
  if (o.link) out.push(`Full details and photos:\n${l.url}`)
  if (o.tour && l.tour) out.push(`Virtual tour:\n${l.tour}`)
  return out
}

/** The close: a viewing on two real days (or, if it's gone, an offer to help), and the question about them. */
function close(l: WaListing, o: WaPropertyOptions, days: string | null | undefined): string[] {
  const out: string[] = []
  if (o.viewing) {
    out.push(isAvailable(l)
      ? `${days ? `Would *${days}* suit you` : 'When would suit you'} for a viewing? We’re open Monday to Friday 9 to 5.30 and Saturday 10 to 1.`
      : 'I can let you know straight away if anything changes, and send you similar homes in the meantime. Would that help?')
  }
  if (o.ask) out.push(positionQuestion(l.channel === 'let'))
  return out
}

/**
 * A message about one of our homes. "first": the first reply to their enquiry. "details": the details on their own,
 * to send after a call. "viewing": a short note to book a viewing.
 */
export function propertyMessage(c: { first: string; me: string; days?: string | null }, l: WaListing, o: WaPropertyOptions, style: 'first' | 'details' | 'viewing' = 'first'): string {
  const me = c.me.split(/\s+/)[0] ?? ''
  const name = homeName(l)
  const gone = availability(l)
  if (style === 'viewing') {
    if (!isAvailable(l)) return [`${hi(c.first)}, about ${name}. ${gone}`, 'I can let you know straight away if anything changes, and send you similar homes in the meantime. Would that help?'].join('\n\n') + sign(me)
    return [`${hi(c.first)}, would you like to view ${name}?`,
      `${c.days ? `I can arrange *${c.days}*, or` : 'Just'} reply with a day and time that suits you. We’re open Monday to Friday 9 to 5.30 and Saturday 10 to 1.`].join('\n\n') + sign(me)
  }
  const intro = style === 'first'
    ? `${hi(c.first)}, it’s ${me ? `${me} from ` : ''}Preston Hill Estates. Thank you for your enquiry about ${name}.${gone ? ` ${gone}` : ''}`
    : `${hi(c.first)}, here are the details of ${name}.${gone ? ` ${gone}` : ''}`
  const end = style === 'details' ? [...close(l, { ...o, ask: false }, c.days), 'Any questions, just reply here.'] : close(l, o, c.days)
  return [intro, ...details(l, o), ...end].join('\n\n') + (style === 'details' ? sign(me) : '')
}

/** A few quick questions about where they are, so we know how to help. */
export function positionMessage(c: { first: string; me: string }, isLet: boolean, l?: WaListing | null): string {
  const me = c.me.split(/\s+/)[0] ?? ''
  const about = l ? ` with ${homeName(l)}` : ''
  const qs = isLet
    ? ['When would you like to move in?', 'Who would be living there, and are there any pets?', 'Are you working, or would you need a guarantor?']
    : ['Are you buying with a mortgage, and do you have an agreement in principle?', 'Do you have a home to sell, and is it on the market yet?', 'When would you ideally like to move?']
  return `${hi(c.first)}, so I can help you${about}, could I ask a few quick questions?\n\n${qs.map((q, i) => `${i + 1}. ${q}`).join('\n')}${sign(me)}`
}

/** A new home that might suit them. This is marketing: only for people who ticked the WhatsApp box. */
export function newHomeMessage(first: string, me: string, home: { line: string; url: string }): string {
  return `${hi(first)}, a new home has just come on that might suit you: ${home.line}.\n\n${home.url}\n\nWould you like to see it?${sign(me.split(/\s+/)[0] ?? '')}\n\nReply STOP if you’d rather not get messages like this.`
}

/** Why we can't WhatsApp this person at all, or null. */
export function waBlocked(p: { e164: string | null | undefined; doNotContact?: boolean | null; stoppedAt?: string | null }): string | null {
  if (p.doNotContact) return 'They asked not to be contacted.'
  if (p.stoppedAt) return 'They said STOP to WhatsApp messages.'
  if (!p.e164) return 'There’s no phone number for them.'
  if (!canReach(p.e164)) return 'Their number isn’t a mobile, so it can’t get WhatsApp.'
  return null
}

/** Does a reply ask us to stop? STOP, Stop., "unsubscribe", "stop messaging me"... */
export const isStop = (text: string) => /^\s*(stop|unsubscribe|stop (messaging|texting|contacting) me|no more( messages)?|opt ?out)\W*$/i.test(text)
