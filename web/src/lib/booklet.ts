// The valuation booklet the agent takes to a valuation: eight A4 pages about us, plus one page about their home
// in today's market. Everything is filled in from the enquiry, the booked appointment, HM Land Registry,
// OnTheMarket and the valuation check; staff can change any of it before printing. Only what they change is
// saved, so anything they haven't touched (the appointment time, new sales) stays up to date.
// Pure: no server imports, so the editor shows a live preview while staff type.

import { firstName } from './property-email'
import type { Place } from './area-facts'
import type { Epc, OurHome, Sale } from './home-history'
import type { LatLon } from './geo'

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
  /** Comparables and places left out. */
  hide: string[]
  /** Extra lines for the home's timeline, one per line: "2015: Rear extension approved". */
  story: string
  /** Show what the home sold for in the past (some owners would rather not see it). */
  showPaid: boolean
}

/** Where the home is and what's around it, for "What buyers will love". */
export type BookletArea = { home: LatLon | null; postcode: string | null; approx: boolean; walked: boolean; mapToken: string | null; mapboxWhy: string; places: Place[]; source: string; error: string | null; pending: boolean }
/** The home's own story, for "Your home's story". */
export type BookletStory = {
  sales: Sale[]
  epcs: Epc[]
  epcKey: boolean
  street: { name: string; count: number; highest: number; latest: { price: number; date: string }; since: string } | null
  demand: { district: number; all: number; months: number; outward: string } | null
  ours: OurHome[]
  council: { name: string; planningUrl: string | null } | null
  facts: { label: string; value: string }[]
  errors: string[]
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
  area: BookletArea
  story: BookletStory
  reviews: BookletReview[]
  google: { rating: number | null; count: number | null }
  prepared: string
  base: string
}

export const FIELDS: (keyof BookletFields)[] = ['kind', 'forName', 'home', 'visit', 'greeting', 'letter', 'figure', 'asking', 'fee', 'hide', 'story', 'showPaid']

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

/** Staff's timeline lines: "2015: Rear extension approved", "March 2021 – new kitchen", or just text. */
export function storyLines(text: string): { when: string; sort: string; what: string }[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12).map((l) => {
    const m = /^((?:[A-Za-z]{3,9}\s+)?(\d{4}))\s*[:\-–—]\s*(.+)$/.exec(l)
    return m ? { when: m[1], sort: m[2], what: m[3] } : { when: '', sort: '9998', what: l }
  })
}
