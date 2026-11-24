import { describe, expect, it } from 'vitest'
import { followupEmail } from './followup-rules'
import { contentChecks, greetedAs, pricesIn, verdictOf, type DraftFacts } from './sense-check-rules'

const facts: DraftFacts = { first: 'Jacqueline', postcode: 'HA3 9QS', prices: [475000, 450000, 500000], reportFinal: true, ourHosts: ['www.prestonhillestates.com'] }
const sign = '\n\nBest wishes,\nSam\nPreston Hill Estates\n271 Preston Road, Harrow HA3 0PS · 020 8904 9005\n\nDon’t want follow-up emails? Just reply “stop”.'
const email = (text: string, subject = 'Your valuation') => ({ subject, text: text + sign, channel: 'email' as const })
const failed = (c: ReturnType<typeof contentChecks>) => c.filter((x) => !x.ok).map((x) => x.name)

describe('prices and greetings', () => {
  it('reads prices in every form', () => {
    expect(pricesIn('Guide £475,000, range £450k to £0.5m, rent £1,850 pcm, or £1.2 million')).toEqual([475000, 450000, 500000, 1850, 1200000])
  })
  it('finds the name they are greeted by', () => {
    expect(greetedAs('Hi Jacqueline,\n\nThanks')).toBe('Jacqueline')
    expect(greetedAs('Dear Mrs Lewis,')).toBe('Mrs Lewis')
    expect(greetedAs('Hello,\n')).toBeNull()
    expect(greetedAs('Hi there,')).toBeNull()
  })
})

describe('contentChecks', () => {
  it('passes a correct email', () => {
    const c = contentChecks(email('Hi Jacqueline,\n\nYour guide price is £475,000. See https://www.prestonhillestates.com/report/abc123def'), facts)
    expect(failed(c)).toEqual([])
    expect(verdictOf(c)).toBe('pass')
  })
  it('holds the wrong name, a placeholder or a price that is not the guide', () => {
    expect(failed(contentChecks(email('Hi Sam,\n\nThanks for your valuation request, we would love to help.'), facts))).toEqual(['Greets them by their own name'])
    expect(failed(contentChecks(email('Hi {first_name},\n\nThanks for your valuation request, we would love to help.'), facts))).toContain('No blanks or placeholders')
    const c = contentChecks(email('Hi Jacqueline,\n\nWe think it is worth about £205,000 in today’s market.'), facts)
    expect(failed(c)).toEqual(['Prices match the finalised OnTheMarket guide'])
    expect(verdictOf(c)).toBe('hold')
  })
  it('blocks any valuation figure or report link without the finalised guide', () => {
    const none = { ...facts, prices: [], reportFinal: false }
    const c = contentChecks(email('Hi Jacqueline,\n\nWe think it is worth about £475,000 in today’s market.'), none)
    expect(verdictOf(c)).toBe('block')
    const r = contentChecks(email('Hi Jacqueline,\n\nYour report: https://www.prestonhillestates.com/report/abc123def'), none)
    expect(failed(r)).toEqual(['A report link only with the finalised OnTheMarket guide'])
    expect(verdictOf(r)).toBe('block')
  })
  it('holds links to strange sites and another home’s postcode, and allows our own office', () => {
    expect(failed(contentChecks(email('Hi Jacqueline,\n\nHave a look at https://bit.ly/xyz for homes near HA3 9QS.'), facts))).toEqual(['Links only to our site or trusted ones'])
    expect(failed(contentChecks(email('Hi Jacqueline,\n\nWe sold a lovely home near HA9 8NA last week, have a look.'), facts))).toEqual(['About their own home'])
  })
  it('needs a way to stop in an email', () => {
    expect(failed(contentChecks({ subject: 'Hello', text: 'Hi Jacqueline,\n\nJust checking in about your valuation request with us.', channel: 'email' }, facts))).toEqual(['Says how to stop these emails'])
  })
})

describe('every follow-up email passes the rules', () => {
  const tracks = ['sales-valuation', 'lettings-valuation', 'buyer', 'tenant'] as const
  for (const t of tracks) for (const k of ['em2', 'em5', 'em14']) {
    it(`${t} ${k}`, () => {
      const m = followupEmail(t, k, { first: 'Jacqueline', me: 'Sam Smith', address: '12 Gordon Avenue', postcode: 'HA3 9QS', base: 'https://www.prestonhillestates.com', unsubscribeUrl: 'https://www.prestonhillestates.com/unsubscribe/abc' })!
      const c = contentChecks({ subject: m.subject, text: m.text, channel: 'email' }, { ...facts, prices: [], reportFinal: false })
      expect(failed(c)).toEqual([])
    })
  }
})
