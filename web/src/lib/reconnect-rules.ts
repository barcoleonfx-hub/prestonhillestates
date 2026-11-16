// Getting back in touch with people who enquired a while ago and went quiet: who's worth contacting, and what the
// email says (something true and useful: what's sold near them, or homes we have now). Kept free of server code so
// it's easy to test.

import type { Track } from './followup-rules'

/** Quiet for at least this long before we reconnect. */
export const QUIET_DAYS = 30
/** Never reconnect with the same lead more often than this. */
export const REPEAT_DAYS = 90
/** At most this many in one go, so the mailbox isn't flooded. */
export const MAX_BATCH = 50

export type ReconnectLead = {
  status: string
  createdAt: string
  lastInboundAt: string | null
  lastOutboundAt: string | null
  doNotContact: boolean
  marketingOptOut: boolean
  email: string | null
  lastReconnectAt: string | null
  /** Being followed up already (Phase 3). */
  followupActive: boolean
}

/** When we last heard from them or contacted them. */
export const lastTouch = (l: Pick<ReconnectLead, 'createdAt' | 'lastInboundAt' | 'lastOutboundAt'>) =>
  [l.createdAt, l.lastInboundAt, l.lastOutboundAt].filter((x): x is string => !!x).sort().at(-1)!

/** Why we shouldn't reconnect with this lead (by email), or null if it's fine. */
export function reconnectBlock(l: ReconnectLead, now = new Date()): string | null {
  if (l.doNotContact) return 'Asked not to be contacted'
  if (l.status === 'won') return 'Already won'
  if (l.status === 'lost') return 'Marked as lost'
  if (l.status === 'offer') return 'An offer is in progress'
  if (l.followupActive) return 'Being followed up already'
  if (!l.email) return 'No email address'
  if (l.marketingOptOut) return 'Unsubscribed from our emails'
  const quiet = (now.getTime() - Date.parse(lastTouch(l))) / 864e5
  if (quiet < QUIET_DAYS) return `In touch ${Math.floor(quiet)} days ago`
  if (l.lastReconnectAt && (now.getTime() - Date.parse(l.lastReconnectAt)) / 864e5 < REPEAT_DAYS) return 'Reconnected with recently'
  return null
}

export type Market = { where: string; count12: number; median12: number | null }
export type Home = { line: string; url: string }
export type ReconnectContext = {
  first: string
  me: string
  /** Their home (valuations) or the home they asked about. */
  address: string | null
  postcode: string | null
  /** "March 2026": when they got in touch. */
  when: string
  market: Market | null
  homes: Home[]
  /** How many homes we have on now, for sale or to let (whichever suits them). */
  liveCount: number
  base: string
  unsubscribeUrl: string | null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const linkify = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`

/** The reconnect email. Every figure in it comes from the Land Registry or our own listings. */
export function reconnectEmail(track: Track, c: ReconnectContext): { subject: string; text: string; html: string } {
  const hi = c.first ? `Hi ${c.first},` : 'Hello,'
  const pcQ = c.postcode ? `?postcode=${encodeURIComponent(c.postcode)}` : ''
  let subject: string
  let body: string[]
  if (track === 'sales-valuation') {
    subject = c.postcode ? `What’s been selling near ${c.postcode}` : 'What’s been selling near you'
    body = [
      `You were in touch with us in ${c.when} about selling${c.address ? ` ${c.address}` : ' your home'}, so I thought you might like to know how the local market is doing.`,
      ...(c.market && c.market.count12 > 0
        ? [`In the last 12 months, ${c.market.count12} home${c.market.count12 === 1 ? '' : 's'} sold ${c.market.where}${c.market.median12 ? `, at a typical price of ${gbp(c.market.median12)}` : ''} (Land Registry). You can see each sale here:`, `${c.base}/sold-prices${pcQ}`]
        : [`You can see what homes near you have sold for here (Land Registry):`, `${c.base}/sold-prices${pcQ}`]),
      `If you’re thinking about it again, we’d be glad to give you an up-to-date valuation. It’s free, there’s no obligation, and we’ll come at a time that suits you. Just reply or call 020 8904 9005.`,
    ]
  } else if (track === 'lettings-valuation') {
    subject = 'Still thinking of letting?'
    body = [
      `You were in touch with us in ${c.when} about letting${c.address ? ` ${c.address}` : ' your property'}. If you’re still thinking about it, you can get an instant rent range for your postcode here:`,
      `${c.base}/landlords#estimate`,
      `For an exact figure we’d come and see it, free and with no obligation. Our fees are all on one page, in plain English: ${c.base}/fees`,
      `Just reply or call 020 8904 9005.`,
    ]
  } else {
    const rent = track === 'tenant'
    subject = rent ? 'Homes to rent with us now' : 'Homes for sale with us now'
    body = [
      `You were in touch with us in ${c.when}${c.address ? ` about ${c.address}` : ''}. In case you’re still looking, ${c.liveCount ? `we have ${c.liveCount} home${c.liveCount === 1 ? '' : 's'} ${rent ? 'to rent' : 'for sale'} at the moment` : `here’s what we have ${rent ? 'to rent' : 'for sale'} at the moment`}${c.homes.length ? ', including:' : ':'}`,
      ...c.homes.slice(0, 3).flatMap((h) => [`${h.line}\n${h.url}`]),
      ...(c.homes.length ? [] : [`${c.base}/properties?channel=${rent ? 'let' : 'sale'}`]),
      rent
        ? `Tell us what you’re looking for and we’ll email you new homes that fit, often before they reach the portals: ${c.base}/renting#register`
        : `If one catches your eye, just reply and we’ll arrange a viewing.`,
    ]
  }
  const sign = [c.me || 'The team', 'Preston Hill Estates', '271 Preston Road, Harrow HA3 0PS · 020 8904 9005']
  const stop = c.unsubscribeUrl ? `Not looking any more? Reply “stop”, or use this link and we won’t email you again: ${c.unsubscribeUrl}` : 'Not looking any more? Just reply “stop” and we won’t email you again.'
  const text = [hi, '', ...body.flatMap((p) => [p, '']), 'Best wishes,', ...sign, '', stop].join('\n')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:600px">`
    + `<p>${esc(hi)}</p>${body.map((p) => `<p>${linkify(p).replace(/\n/g, '<br>')}</p>`).join('')}`
    + `<p>Best wishes,<br>${sign.map(esc).join('<br>')}</p>`
    + `<p style="font-size:12px;color:#888;margin-top:24px">${linkify(stop)}</p></div>`
  return { subject, text, html }
}

/** Homes nearest their budget: the price of the home they asked about, or what they said they could spend. */
export function nearestHomes<T extends { price: number | null }>(homes: T[], target: number | null, n = 3): T[] {
  if (!target) return homes.slice(0, n)
  return [...homes].filter((h) => h.price != null).sort((a, b) => Math.abs(a.price! - target) - Math.abs(b.price! - target)).slice(0, n)
}

/** The WhatsApp version, for people who ticked the WhatsApp box. */
export function reconnectWhatsApp(track: Track, first: string, me: string, when: string): string {
  const hi = first ? `Hi ${first}` : 'Hi'
  const who = me ? `it’s ${me.split(/\s+/)[0]} from Preston Hill Estates` : 'it’s Preston Hill Estates'
  if (track === 'sales-valuation') return `${hi}, ${who}. You were in touch in ${when} about selling. If you’re thinking about it again, we’d be glad to give you an up-to-date valuation, free. Reply STOP if you’d rather not hear from us.`
  if (track === 'lettings-valuation') return `${hi}, ${who}. You were in touch in ${when} about letting your property. Are you still thinking about it? Happy to help whenever you’re ready. Reply STOP if you’d rather not hear from us.`
  return `${hi}, ${who}. You were in touch in ${when}. Are you still looking? I’d be happy to send you what we have on now. Reply STOP if you’d rather not hear from us.`
}
