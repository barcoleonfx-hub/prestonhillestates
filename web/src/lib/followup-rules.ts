// Following up a new lead who hasn't replied: what happens on which day, when to stop, and what each email says.
// Emails go automatically from the office mailbox; WhatsApps appear on the Follow-ups page for staff to send.
// Kept free of server code so it's easy to test.

import { addDays, isoToLondon, londonToIso } from './time'

export type Track = 'sales-valuation' | 'lettings-valuation' | 'buyer' | 'tenant'
export type Channel = 'email' | 'whatsapp'
export type StepDef = { key: string; day: number; channel: Channel; label: string }

/** Days after the enquiry. Nothing goes out on Sundays or outside 9am to 9pm; emails go at 10am. */
export const STEPS: StepDef[] = [
  { key: 'wa1', day: 1, channel: 'whatsapp', label: 'WhatsApp: thanks for your enquiry' },
  { key: 'em2', day: 2, channel: 'email', label: 'Email: following up' },
  { key: 'em5', day: 5, channel: 'email', label: 'Email: something useful' },
  { key: 'wa9', day: 9, channel: 'whatsapp', label: 'WhatsApp: still looking?' },
  { key: 'em14', day: 14, channel: 'email', label: 'Email: shall we close it?' },
]
export const EMAIL_STEPS = STEPS.map((s, i) => (s.channel === 'email' ? i : -1)).filter((i) => i >= 0)
export const WHATSAPP_STEPS = STEPS.map((s, i) => (s.channel === 'whatsapp' ? i : -1)).filter((i) => i >= 0)
/** A WhatsApp nobody sends within this many days is skipped, so the list doesn't fill up with old ones. */
export const WHATSAPP_GRACE_DAYS = 3
export const SEND_TIME = '10:00'

/** When a step is due: so many days after the enquiry, at 10am London time, moved off a Sunday to Monday. */
export function dueAt(startedAt: string, day: number): string {
  let d = addDays(isoToLondon(startedAt).date, day)
  if (new Date(`${d}T12:00:00Z`).getUTCDay() === 0) d = addDays(d, 1)
  return londonToIso(d, SEND_TIME)!
}

/** The next step's time, never sooner than 20 hours after the last, so two never land on the same day. */
export function nextDue(startedAt: string, stepIndex: number, now = new Date()): string | null {
  const s = STEPS[stepIndex]
  if (!s) return null
  const planned = dueAt(startedAt, s.day)
  const soonest = new Date(now.getTime() + 20 * 3600_000).toISOString()
  if (planned >= soonest) return planned
  // Too soon: the same 10am slot a day later (or the one after, off a Sunday).
  return dueAt(soonest, 0) >= soonest ? dueAt(soonest, 0) : dueAt(soonest, 1)
}

export type LeadState = {
  status: string
  startedAt: string
  lastInboundAt: string | null
  lastOutboundAt: string | null
  doNotContact: boolean
  marketingOptOut: boolean
  email: string | null
  canWhatsApp: boolean
}

/** Why follow-ups should stop for good, or null to carry on. */
export function stopReason(l: LeadState): string | null {
  if (l.doNotContact) return 'They asked not to be contacted'
  if (l.lastInboundAt && l.lastInboundAt >= l.startedAt) return 'They replied'
  if (l.status !== 'new' && l.status !== 'contacted') return `The lead moved on (${l.status})`
  if (!l.email && !l.canWhatsApp) return 'No email address or mobile number'
  return null
}

/** Whether to do this step, or why it's skipped. */
export function stepSkip(step: StepDef, l: LeadState, now = new Date()): string | null {
  if (step.channel === 'email') {
    if (!l.email) return 'No email address'
    if (l.marketingOptOut) return 'They unsubscribed from our emails'
    if (l.lastOutboundAt && now.getTime() - Date.parse(l.lastOutboundAt) < 20 * 3600_000) return 'We were in touch in the last day'
    return null
  }
  if (!l.canWhatsApp) return 'No mobile number for WhatsApp (or they said STOP)'
  return null
}

// ---------- the emails ----------

export type EmailContext = {
  first: string
  /** Who signs it: the person looking after the lead, or the office. */
  me: string
  /** The home to value, or the one they asked about. */
  address: string | null
  postcode: string | null
  base: string
  unsubscribeUrl: string | null
}
export type FollowupEmail = { subject: string; text: string; html: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const linkify = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')

/** The email for one step, or null if this step isn't an email. Plain and personal, like a real person wrote it. */
export function followupEmail(track: Track, stepKey: string, c: EmailContext): FollowupEmail | null {
  const hi = c.first ? `Hi ${c.first},` : 'Hello,'
  const at = c.address ? ` for ${c.address}` : ''
  const about = c.address ? ` about ${c.address}` : ''
  const pcQ = c.postcode ? `?postcode=${encodeURIComponent(c.postcode)}` : ''
  const valuation = track === 'sales-valuation' || track === 'lettings-valuation'
  const rent = track === 'lettings-valuation' || track === 'tenant'
  let subject = ''
  let body: string[] = []
  if (stepKey === 'em2') {
    if (valuation) {
      subject = `Your ${rent ? 'rental ' : ''}valuation${c.address ? `: ${c.address}` : ''}`
      body = [
        `I just wanted to follow up on your request for a ${rent ? 'rental ' : ''}valuation${at}.`,
        `We’d be glad to come round at a time that suits you, including Saturday mornings. It’s free and there’s no obligation.`,
        'Just reply with a day and time that works, or call us on 020 8904 9005.',
      ]
    } else {
      subject = c.address ? `Your enquiry about ${c.address}` : 'Your enquiry with Preston Hill Estates'
      body = [
        `I just wanted to follow up on your enquiry${about}.`,
        `Would you like to ${c.address ? 'arrange a viewing' : 'have a chat about what you’re looking for'}? Just reply with a day and time that suits you, or call us on 020 8904 9005.`,
      ]
    }
  } else if (stepKey === 'em5') {
    if (track === 'sales-valuation') {
      subject = c.postcode ? `What homes near ${c.postcode} have sold for` : 'What homes near you have sold for'
      body = [
        `While you’re thinking about selling, you might find it useful to see what homes near you have actually sold for, from the Land Registry:`,
        `${c.base}/sold-prices${pcQ}`,
        `Every home is different, which is why we like to see yours before giving a figure. If you’d like us to come round, just reply or call 020 8904 9005.`,
      ]
    } else if (track === 'lettings-valuation') {
      subject = 'What your property could let for'
      body = [
        `While you’re thinking about letting, you can get an instant rent range for your postcode here:`,
        `${c.base}/landlords#estimate`,
        `Our fees are all on one page, in plain English: ${c.base}/fees`,
        `For an exact figure we’d need to see the property. Just reply or call 020 8904 9005 and we’ll arrange a time.`,
      ]
    } else if (track === 'buyer') {
      subject = 'Homes for sale with us right now'
      body = [
        `In case it’s useful, here’s everything we have for sale at the moment:`,
        `${c.base}/properties?channel=sale`,
        `And if you’d like a rough idea of what you could borrow: ${c.base}/mortgage-calculator`,
        `If something catches your eye, just reply and we’ll arrange a viewing.`,
      ]
    } else {
      subject = 'Hear about new homes to rent first'
      body = [
        `In case it’s useful: if you tell us what you’re looking for, we’ll email you new homes to rent that fit, often before they reach the portals.`,
        `${c.base}/renting#register`,
        `Everything we have to rent right now is here: ${c.base}/properties?channel=let`,
      ]
    }
  } else if (stepKey === 'em14') {
    subject = valuation ? 'Shall I close your valuation request?' : 'Shall I close your enquiry?'
    body = [
      `I haven’t heard back, so I’ll assume now isn’t the right time and won’t chase you any further.`,
      `If anything changes, just reply to this email or call us on 020 8904 9005. We’ve been on Preston Road since 2004 and we’re always happy to help.`,
    ]
  } else return null

  const sign = [c.me ? c.me : 'The team', 'Preston Hill Estates', '271 Preston Road, Harrow HA3 0PS · 020 8904 9005']
  const stop = c.unsubscribeUrl
    ? `Don’t want follow-up emails? Reply “stop”, or use this link: ${c.unsubscribeUrl}`
    : 'Don’t want follow-up emails? Just reply “stop”.'
  const text = [hi, '', ...body.flatMap((p) => [p, '']), 'Best wishes,', ...sign, '', stop].join('\n')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:600px">`
    + `<p>${esc(hi)}</p>${body.map((p) => `<p>${linkify(p)}</p>`).join('')}`
    + `<p>Best wishes,<br>${sign.map(esc).join('<br>')}</p>`
    + `<p style="font-size:12px;color:#888;margin-top:24px">${linkify(stop)}</p></div>`
  return { subject, text, html }
}

/** The WhatsApp step's message (staff can change it before sending). */
export function followupWhatsApp(track: Track, stepKey: string, first: string, me: string): string {
  const hi = first ? `Hi ${first}` : 'Hi'
  const who = me ? `it’s ${me.split(/\s+/)[0]} from Preston Hill Estates` : 'it’s Preston Hill Estates'
  const valuation = track === 'sales-valuation' || track === 'lettings-valuation'
  if (stepKey === 'wa1') return `${hi}, ${who}. Thanks for your ${valuation ? 'valuation request' : 'enquiry'}. When’s a good time for a quick call?`
  return valuation
    ? `${hi}, ${who}. Are you still thinking of ${track === 'lettings-valuation' ? 'letting' : 'selling'}? Happy to help whenever you’re ready, just reply here.`
    : `${hi}, ${who}. Are you still looking? If anything’s changed, let me know and I’ll keep an eye out for you.`
}
