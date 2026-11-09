// The valuation booklet the agent takes to a valuation: eight A4 pages about us, plus one page about their home
// in today's market. Everything is filled in from the enquiry, the booked appointment, HM Land Registry,
// OnTheMarket and the valuation check; staff can change any of it before printing. Only what they change is
// saved, so anything they haven't touched (the appointment time, new sales) stays up to date.
// Pure: no server imports, so the editor shows a live preview while staff type.

import { firstName } from './property-email'

export type BookletKind = 'sales' | 'lettings'

export type BookletComp = {
  key: string
  group: 'evidence' | 'market'
  where: string
  what: string
  price: number
  /** "pcm" for rents. */
  rent: boolean
  source: string
  metres?: number | null
}

export type BookletReview = { text: string; name: string; date?: string; rating: number }

/** The fields staff can change. */
export type BookletFields = {
  kind: BookletKind
  forName: string
  home: string
  visit: string
  greeting: string
  letter: string
  /** The figure box: our valuation (or expected rent), and the suggested asking price (or rent). Blank = written in. */
  figure: string
  asking: string
  fee: string
  /** Comparables left out. */
  hide: string[]
}

export type BookletInput = {
  id: string
  enquiryId: string | null
  defaults: BookletFields
  saved: Partial<BookletFields>
  comps: BookletComp[]
  /** Where the comparables come from, for the page's small print. */
  compsWhere: string | null
  /** A typical range to show beside the comparables (rents: our lets nearby or the official figures). */
  estimate: { low: number; high: number; rent: boolean; basis: string } | null
  otm: { url: string; error: string | null } | null
  reviews: BookletReview[]
  google: { rating: number | null; count: number | null }
  prepared: string
  base: string
}

export const FIELDS: (keyof BookletFields)[] = ['kind', 'forName', 'home', 'visit', 'greeting', 'letter', 'figure', 'asking', 'fee', 'hide']

export const merge = (d: BookletFields, s: Partial<BookletFields>): BookletFields => ({ ...d, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) }) as BookletFields

/** Only what differs from the filled-in version is worth saving. */
export function changes(d: BookletFields, f: BookletFields): Partial<BookletFields> {
  const out: Partial<BookletFields> = {}
  for (const k of FIELDS) {
    const a = d[k], b = f[k]
    if (JSON.stringify(a) !== JSON.stringify(b)) (out as Record<string, unknown>)[k] = b
  }
  return out
}

export const greetingFor = (name: string) => {
  const n = name.trim()
  return n ? `Dear ${firstName(n)},` : 'Hello,'
}

export function defaultLetter(kind: BookletKind): string {
  return kind === 'lettings'
    ? [
        'Letting a property should be straightforward, and you deserve straight answers. Today we’ll look round with you, tell you honestly what rent to expect and what (if anything) needs doing first, and explain how we’d look after it.',
        'We’ve been on Preston Road since 2004. We’re independent and founder-led: the people you meet today are the people who will find your tenant, do every viewing and manage the tenancy, including everything the new Renters’ Rights rules ask of landlords.',
        'There’s no obligation. Keep this booklet; everything we discuss is in it.',
      ].join('\n\n')
    : [
        'Deciding to sell is a big step, and you deserve straight answers. Today we’ll look round your home, listen to what you want to do and when, and tell you honestly what we think it’s worth, with the sales that prove it.',
        'We’ve been on Preston Road since 2004. We’re independent and founder-led: the people you meet today are the people who will sell your home, show every buyer round and see it through to completion.',
        'There’s no obligation. Keep this booklet; everything we discuss is in it.',
      ].join('\n\n')
}

export const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
