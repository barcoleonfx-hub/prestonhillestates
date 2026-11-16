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
}

const sign = (me: string) => (me ? `\n\n${me}, Preston Hill Estates` : '\n\nPreston Hill Estates')
const hi = (first: string) => (first ? `Hi ${first}` : 'Hi')

/** The ready-written messages for one lead. None of these are marketing: each is about their own enquiry. */
export function waTemplates(c: WaContext): WaTemplate[] {
  const me = c.me.split(/\s+/)[0] ?? ''
  const intro = me ? `it’s ${me} from Preston Hill Estates` : 'it’s Preston Hill Estates'
  const out: WaTemplate[] = []
  const what = c.kind === 'valuation'
    ? `Thanks for asking about a ${c.isLet ? 'rental' : 'sales'} valuation${c.address ? ` of ${c.address}` : ''}. When would suit you for us to come round? It’s free and there’s no obligation.`
    : c.kind === 'viewing' && c.address
      ? `Thanks for your enquiry about ${c.address}. When would suit you to view it? We’re open Monday to Friday 9 to 5.30 and Saturday 10 to 1.`
      : c.kind === 'buyer' || c.kind === 'tenant'
        ? `Thanks for registering with us. What are you looking for, and where? I’ll let you know as soon as something suitable comes on.`
        : 'Thanks for getting in touch. When’s a good time to talk?'
  out.push({ key: 'intro', label: 'First reply', text: `${hi(c.first)}, ${intro}. ${what}`, marketing: false })
  out.push({ key: 'missed', label: 'Tried to call', text: `${hi(c.first)}, ${intro}. I’ve just tried to call you about your enquiry. When’s a good time to ring you back?`, marketing: false })
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
      ? `${hi(c.first)}, ${intro}. Are you still thinking of ${c.isLet ? 'letting' : 'selling'}? Happy to help whenever you’re ready, just reply here.`
      : `${hi(c.first)}, ${intro}. Are you still looking? If anything’s changed, let me know and I’ll keep an eye out for you.`,
    marketing: false,
  })
  out.push({ key: 'own', label: 'Write your own', text: `${hi(c.first)}, `, marketing: false })
  return out
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
