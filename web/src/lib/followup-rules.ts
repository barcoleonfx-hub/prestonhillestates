// Following up a new lead who hasn't replied: what happens on which day, when to stop, and what each email says.
// Emails go automatically from the office mailbox; WhatsApps appear on the Follow-ups page for staff to send.
// Kept free of server code so it's easy to test.

import { addDays, isoToLondon, londonToIso } from './time'

export type Track = 'sales-valuation' | 'lettings-valuation' | 'buyer' | 'tenant'
export type Channel = 'email' | 'whatsapp' | 'call' | 'letter'
export type StepDef = { key: string; day: number; channel: Channel; label: string; /** Needs the finalised OnTheMarket report (it sends the report or its figure). */ report?: boolean }

/** Days after the enquiry. Nothing goes out on Sundays or outside 9am to 9pm; emails go at 10am. */
export const STEPS: StepDef[] = [
  { key: 'wa1', day: 1, channel: 'whatsapp', label: 'WhatsApp: thanks for your enquiry' },
  { key: 'em2', day: 2, channel: 'email', label: 'Email: following up' },
  { key: 'em5', day: 5, channel: 'email', label: 'Email: something useful' },
  { key: 'wa9', day: 9, channel: 'whatsapp', label: 'WhatsApp: still looking?' },
  { key: 'em14', day: 14, channel: 'email', label: 'Email: shall we close it?' },
]

/**
 * The Valuation agent's plan for a new valuation request: speed first (a call and a WhatsApp the same day), the
 * report as soon as its OnTheMarket guide is finalised, then something useful, a check-in, a letter and two final
 * check-ins. Stops the moment they reply, book or say no. After day 30 the lead goes to Seller outreach.
 */
export const VALUATION_STEPS: StepDef[] = [
  { key: 'call0', day: 0, channel: 'call', label: 'Call: the same day' },
  { key: 'wa0', day: 0, channel: 'whatsapp', label: 'WhatsApp: thanks for your request' },
  { key: 'rp1', day: 1, channel: 'email', label: 'Email: your property report', report: true },
  { key: 'call2', day: 2, channel: 'call', label: 'Call: second try' },
  { key: 'em4', day: 4, channel: 'email', label: 'Email: what homes near you sold for' },
  { key: 'em7', day: 7, channel: 'email', label: 'Email: checking in' },
  { key: 'lt14', day: 14, channel: 'letter', label: 'Letter: a follow-up letter', report: true },
  { key: 'em21', day: 21, channel: 'email', label: 'Email: still thinking it over?' },
  { key: 'em30', day: 30, channel: 'email', label: 'Email: leaving it there for now' },
]

/** After the valuation visit, while they think it over: thanks the same day, then a call, an email and a call. */
export const AFTER_VISIT_STEPS: StepDef[] = [
  { key: 'pv0', day: 0, channel: 'email', label: 'Email: thank you for having us' },
  { key: 'pcall2', day: 2, channel: 'call', label: 'Call: any questions?' },
  { key: 'pv5', day: 5, channel: 'email', label: 'Email: here to help' },
  { key: 'pcall10', day: 10, channel: 'call', label: 'Call: have you decided?' },
]

export type Plan = 'standard' | 'valuation' | 'after-visit'
const PLANS: Record<Plan, StepDef[]> = { standard: STEPS, valuation: VALUATION_STEPS, 'after-visit': AFTER_VISIT_STEPS }
/** The steps for a lead's plan (leads started before plans existed are on the standard one). */
export const stepsFor = (plan: string | null | undefined): StepDef[] => PLANS[(plan ?? 'standard') as Plan] ?? STEPS
export const planLabel = (plan: string | null | undefined) => (plan === 'valuation' ? 'Valuation plan' : plan === 'after-visit' ? 'After the visit' : 'Follow-ups')
/** Steps a person does (calls and WhatsApps), as opposed to ones the system does (emails and letters). */
export const isStaffStep = (s: StepDef | undefined) => s?.channel === 'call' || s?.channel === 'whatsapp'

export const EMAIL_STEPS = STEPS.map((s, i) => (s.channel === 'email' ? i : -1)).filter((i) => i >= 0)
export const WHATSAPP_STEPS = STEPS.map((s, i) => (s.channel === 'whatsapp' ? i : -1)).filter((i) => i >= 0)
/** A WhatsApp or call nobody does within this many days is skipped, so the list doesn't fill up with old ones. */
export const WHATSAPP_GRACE_DAYS = 3
/** A step that needs the finalised report waits this long for it, then goes without (a letter or email is skipped). */
export const REPORT_WAIT_DAYS = 3
export const SEND_TIME = '10:00'

/** When a step is due: so many days after the enquiry, at 10am London time, moved off a Sunday to Monday. */
export function dueAt(startedAt: string, day: number): string {
  let d = addDays(isoToLondon(startedAt).date, day)
  if (new Date(`${d}T12:00:00Z`).getUTCDay() === 0) d = addDays(d, 1)
  return londonToIso(d, SEND_TIME)!
}

/**
 * The next step's time. An email is never sooner than 20 hours after the last step, so two never land on the same
 * day; a call or WhatsApp (a person does it), a letter or the report email keeps its planned day.
 */
export function nextDue(startedAt: string, stepIndex: number, now = new Date(), plan?: string | null): string | null {
  const s = stepsFor(plan)[stepIndex]
  if (!s) return null
  const planned = dueAt(startedAt, s.day)
  // Calls, WhatsApps and letters are done by a person or printed; the report is what they asked for.
  if (s.channel !== 'email' || s.report) return planned
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
  /** A number we can call. */
  phone?: string | null
}

/** Why follow-ups should stop for good, or null to carry on. */
export function stopReason(l: LeadState, plan?: string | null): string | null {
  if (l.doNotContact) return 'They asked not to be contacted'
  if (l.lastInboundAt && l.lastInboundAt >= l.startedAt) return 'They replied'
  // After the visit they're further along (visit booked or done); the plan stops once it's won, lost or gone quiet.
  const going = plan === 'after-visit' ? ['new', 'contacted', 'engaged', 'viewing'] : ['new', 'contacted']
  if (!going.includes(l.status)) return `The lead moved on (${l.status})`
  if (!l.email && !l.canWhatsApp) return 'No email address or mobile number'
  return null
}

/** Whether to do this step, or why it's skipped. */
export function stepSkip(step: StepDef, l: LeadState, now = new Date()): string | null {
  if (step.channel === 'email') {
    if (!l.email) return 'No email address'
    if (l.marketingOptOut) return 'They unsubscribed from our emails'
    // The report is what they asked for, so it goes even if we spoke yesterday.
    if (!step.report && l.lastOutboundAt && now.getTime() - Date.parse(l.lastOutboundAt) < 20 * 3600_000) return 'We were in touch in the last day'
    return null
  }
  if (step.channel === 'whatsapp' && !l.canWhatsApp) return 'No mobile number for WhatsApp (or they said STOP)'
  if (step.channel === 'call' && !l.phone) return 'No phone number to call'
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
  /** Their personal property report, only once it's finalised from the OnTheMarket guide. */
  reportUrl?: string | null
  /** The finalised guide's figures (a month's rent when letting). */
  guide?: { asking: number; low: number | null; high: number | null } | null
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
        `We’d be glad to come round at a time that suits you. It’s free and there’s no obligation.`,
        'Just reply with a day and time that works, or call us on 020 8904 9005.',
      ]
    } else {
      subject = c.address ? `Your enquiry about ${c.address}` : 'Your enquiry with Preston Hill Estates'
      body = [
        `I just wanted to follow up on your enquiry${about}.`,
        `Would you like to ${c.address ? 'arrange a viewing' : 'have a chat about what you’re looking for'}? Just reply with a day and time that suits you, or call us on 020 8904 9005.`,
      ]
    }
  } else if (stepKey === 'rp1') {
    // The report, once its OnTheMarket guide is finalised (the agent waits for it; never sent without).
    if (!c.reportUrl || !c.guide) return null
    const p = (n: number) => `£${n.toLocaleString('en-GB')}${rent ? ' a month' : ''}`
    subject = `Your property report${c.address ? `: ${c.address}` : ''}`
    body = [
      `Thank you for asking us about ${c.address ?? 'your home'}. I’ve put together your personal property report: what homes nearby have sold${rent ? ' and let' : ''} for, what buyers${rent ? ' and tenants' : ''} will love about where you live, and our guide ${rent ? 'rent' : 'price'}.`,
      c.reportUrl,
      `Our guide ${rent ? 'rent' : 'price'} is ${p(c.guide.asking)}${c.guide.low && c.guide.high ? `, in a range of ${p(c.guide.low)} to ${p(c.guide.high)}` : ''}. Every home is different, so the final figure comes from a short visit: about 30 minutes, free and with no obligation.`,
      'Just reply with a day and time that suits you, or call us on 020 8904 9005.',
    ]
  } else if (stepKey === 'em7') {
    subject = c.address ? `Any questions about ${c.address}?` : 'Any questions?'
    body = [
      `I wanted to check whether you had any questions about ${rent ? 'letting' : 'selling'}${at}.`,
      c.reportUrl ? `Your property report is here whenever you’d like another look: ${c.reportUrl}` : `If it helps, we can come round for a free, no-obligation look at your home and talk you through what it could ${rent ? 'let' : 'sell'} for.`,
      'You can reply to this email, call us on 020 8904 9005 or send a WhatsApp message to 07745 203146.',
    ]
  } else if (stepKey === 'em21') {
    subject = rent ? 'Still thinking about letting?' : 'Still thinking about selling?'
    body = [
      `Just a quick note in case your plans have moved on since you asked us about ${c.address ?? 'your home'}.`,
      `Whenever you’re ready, we’d be glad to come round: about 30 minutes, free and with no obligation, to show you how we would ${rent ? 'let' : 'sell'} your home and answer any questions.`,
      'Just reply with a day and time that suits you, or call us on 020 8904 9005.',
    ]
  } else if (stepKey === 'em30') {
    subject = 'Leaving your valuation request there for now'
    body = [
      `I haven’t heard back, so I’ll assume now isn’t the right time and I’ll stop following up on your valuation request.`,
      `If anything changes, just reply to this email or call us on 020 8904 9005. We’ve been on Preston Road since 2004 and we’re always happy to help.`,
    ]
  } else if (stepKey === 'pv0') {
    subject = c.address ? `Thank you: ${c.address}` : 'Thank you for having us'
    body = [
      `Thank you for showing us round${c.address ? ` ${c.address}` : ''}. We really appreciate your time.`,
      `As you think things over, if any questions come up about the figure, our fees or how we’d ${rent ? 'let' : 'market'} your home, just reply or call me on 020 8904 9005.`,
      ...(c.reportUrl ? [`Your property report is here too: ${c.reportUrl}`] : []),
    ]
  } else if (stepKey === 'pv5') {
    subject = c.address ? `Here to help with ${c.address}` : 'Here to help'
    body = [
      `I hope you’re well. I wanted to check in after our visit, in case there’s anything else you’d like to know before you decide.`,
      `Happy to go through anything again, by phone or in person, whatever suits you. Just reply or call 020 8904 9005.`,
    ]
  } else if (stepKey === 'em5' || stepKey === 'em4') {
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
  if (stepKey === 'wa1' || stepKey === 'wa0') return `${hi}, ${who}. Thanks for your ${valuation ? 'valuation request' : 'enquiry'}. When’s a good time for a quick call?`
  return valuation
    ? `${hi}, ${who}. Are you still thinking of ${track === 'lettings-valuation' ? 'letting' : 'selling'}? Happy to help whenever you’re ready, just reply here.`
    : `${hi}, ${who}. Are you still looking? If anything’s changed, let me know and I’ll keep an eye out for you.`
}

/** What to say on a call step: a short prompt for whoever makes it. */
export function callScript(track: Track, stepKey: string): string {
  const doing = track === 'lettings-valuation' ? 'letting' : 'selling'
  switch (stepKey) {
    case 'call0': return `Thank them for the request, ask about the home and their plans (when, why ${doing}, what they hope for) and offer a visit this week.`
    case 'call2': return 'Second try: did they get the report? Offer a free 30-minute visit and two times that suit you both.'
    case 'pcall2': return 'After the visit: any questions about the figure, the fees or the marketing? Ask what would help them decide.'
    case 'pcall10': return 'Have they decided? If they’re waiting on something, agree when to talk again; if they chose someone else, ask why (and note it).'
    default: return 'Ask how they are getting on and whether we can help.'
  }
}

/** The Valuation agent's emails about a booked valuation: a confirmation, and a reminder the day before. */
export function bookingEmail(kind: 'confirm' | 'reminder', c: { first: string; when: string; address: string | null; staff: string; letting: boolean; me: string; unsubscribeUrl: string | null }): FollowupEmail {
  const hi = c.first ? `Hi ${c.first},` : 'Hello,'
  const where = c.address ? ` of ${c.address}` : ''
  const who = c.staff ? c.staff.split(/\s+/)[0] : 'one of the team'
  const subject = kind === 'confirm' ? `Your valuation is booked: ${c.when}` : `See you ${c.when}`
  const body = kind === 'confirm'
    ? [
        `Thank you for booking a ${c.letting ? 'rental ' : ''}valuation${where}. ${who} will see you on ${c.when}.`,
        `It takes about 30 minutes, it’s free and there’s no obligation. It helps to have any details of work you’ve done to the home to hand, but there’s nothing you need to prepare.`,
        'If you need to change the time, just reply to this email or call us on 020 8904 9005.',
      ]
    : [
        `Just a reminder that ${who} is coming to see you on ${c.when} for your ${c.letting ? 'rental ' : ''}valuation${where}.`,
        'If that time no longer suits, just reply or call us on 020 8904 9005 and we’ll find another.',
      ]
  const sign = [c.me || 'The team', 'Preston Hill Estates', '271 Preston Road, Harrow HA3 0PS · 020 8904 9005']
  const stop = c.unsubscribeUrl ? `Don’t want emails from us? Reply “stop”, or use this link: ${c.unsubscribeUrl}` : 'Don’t want emails from us? Just reply “stop”.'
  const text = [hi, '', ...body.flatMap((p) => [p, '']), 'Best wishes,', ...sign, '', stop].join('\n')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:600px">`
    + `<p>${esc(hi)}</p>${body.map((p) => `<p>${linkify(p)}</p>`).join('')}`
    + `<p>Best wishes,<br>${sign.map(esc).join('<br>')}</p>`
    + `<p style="font-size:12px;color:#888;margin-top:24px">${linkify(stop)}</p></div>`
  return { subject, text, html }
}
