import { describe, expect, it } from 'vitest'
import { AFTER_VISIT_STEPS, VALUATION_STEPS, bookingEmail, callScript, followupEmail, nextDue, stepSkip, stepsFor, stopReason, type LeadState } from './followup-rules'
import { contentChecks, verdictOf } from './sense-check-rules'

const lead = (o: Partial<LeadState> = {}): LeadState => ({ status: 'new', startedAt: '2026-11-16T15:00:00Z', lastInboundAt: null, lastOutboundAt: null, doNotContact: false, marketingOptOut: false, email: 'sam@example.com', canWhatsApp: true, phone: '+447700900123', ...o })
const base = 'https://www.prestonhillestates.com'
const ctx = { first: 'Sam', me: 'Jamil Ahmed', address: '12 Gordon Avenue', postcode: 'HA3 9QS', base, unsubscribeUrl: `${base}/unsubscribe/abc`, reportUrl: `${base}/report/abcdefgh12345678`, guide: { asking: 475000, low: 450000, high: 500000 } }
const facts = { first: 'Sam', postcode: 'HA3 9QS', prices: [475000, 450000, 500000], reportFinal: true, ourHosts: ['www.prestonhillestates.com'] }

describe('the valuation plan', () => {
  it('is speed first, the report on day 1, a letter on day 14 and check-ins to day 30', () => {
    expect(VALUATION_STEPS.map((s) => `${s.channel}:${s.day}`)).toEqual(['call:0', 'whatsapp:0', 'email:1', 'call:2', 'email:4', 'email:7', 'letter:14', 'email:21', 'email:30'])
    expect(VALUATION_STEPS.filter((s) => s.report).map((s) => s.key)).toEqual(['rp1', 'lt14'])
    expect(stepsFor('valuation')).toBe(VALUATION_STEPS)
    expect(stepsFor(null).length).toBe(5) // leads already on the standard plan carry on as they were
  })
  it('puts the WhatsApp the same day as the first call, but keeps emails a day apart', () => {
    // Enquiry Monday 16 Nov 3pm: call due 10am Monday (straight away), WhatsApp too.
    expect(nextDue('2026-11-16T15:00:00Z', 1, new Date('2026-11-16T15:30:00Z'), 'valuation')).toBe('2026-11-16T10:00:00.000Z')
    // The report email keeps day 1 even after a WhatsApp at 3:30pm; the day-4 email keeps 20 hours from the last step.
    expect(nextDue('2026-11-16T15:00:00Z', 2, new Date('2026-11-16T15:30:00Z'), 'valuation')).toBe('2026-11-17T10:00:00.000Z')
    expect(nextDue('2026-11-16T15:00:00Z', 4, new Date('2026-11-20T09:00:00Z'), 'valuation')).toBe('2026-11-21T10:00:00.000Z')
  })
  it('sends the report even if we spoke yesterday, but not other emails', () => {
    const spoke = lead({ lastOutboundAt: '2026-11-17T16:00:00Z' })
    const at = new Date('2026-11-18T10:00:00Z')
    expect(stepSkip(VALUATION_STEPS[2], spoke, at)).toBeNull()
    expect(stepSkip(VALUATION_STEPS[5], spoke, new Date('2026-11-18T08:00:00Z'))).toMatch(/last day/)
    expect(stepSkip(VALUATION_STEPS[0], lead({ phone: null }))).toMatch(/phone/)
  })
  it('never writes the report email without the finalised guide', () => {
    expect(followupEmail('sales-valuation', 'rp1', { ...ctx, reportUrl: null })).toBeNull()
    expect(followupEmail('sales-valuation', 'rp1', { ...ctx, guide: null })).toBeNull()
  })
  it('stops once they book, and after the visit stops once it’s won or lost', () => {
    expect(stopReason(lead({ status: 'viewing' }), 'valuation')).toMatch(/moved on/)
    expect(stopReason(lead({ status: 'viewing' }), 'after-visit')).toBeNull()
    expect(stopReason(lead({ status: 'won' }), 'after-visit')).toMatch(/moved on/)
    expect(stopReason(lead({ lastInboundAt: '2026-11-17T09:00:00Z' }), 'after-visit')).toBe('They replied')
  })
  it('has a call script for every call', () => {
    for (const s of [...VALUATION_STEPS, ...AFTER_VISIT_STEPS].filter((x) => x.channel === 'call')) expect(callScript('sales-valuation', s.key)).not.toMatch(/how they are getting on/)
  })
})

describe('every new email passes the sense-check rules', () => {
  for (const t of ['sales-valuation', 'lettings-valuation'] as const) {
    for (const s of [...VALUATION_STEPS, ...AFTER_VISIT_STEPS].filter((x) => x.channel === 'email')) {
      it(`${t} ${s.key}`, () => {
        const rent = t === 'lettings-valuation'
        const g = rent ? { asking: 1850, low: 1750, high: 1950 } : ctx.guide
        const m = followupEmail(t, s.key, { ...ctx, guide: g })!
        expect(m.text).not.toMatch(/undefined|null|NaN/)
        const c = contentChecks({ subject: m.subject, text: m.text, channel: 'email' }, { ...facts, prices: [g.asking, g.low, g.high] })
        expect(c.filter((x) => !x.ok).map((x) => x.name)).toEqual([])
      })
    }
  }
  it('the report email gives the guide price and range, and a rent a month when letting', () => {
    expect(followupEmail('sales-valuation', 'rp1', ctx)!.text).toContain('Our guide price is £475,000, in a range of £450,000 to £500,000.')
    expect(followupEmail('lettings-valuation', 'rp1', { ...ctx, guide: { asking: 1850, low: null, high: null } })!.text).toContain('Our guide rent is £1,850 a month.')
  })
  it('without a finalised guide, emails that might mention the report don’t', () => {
    for (const k of ['em7', 'pv0']) {
      const m = followupEmail('sales-valuation', k, { ...ctx, reportUrl: null, guide: null })!
      const c = contentChecks({ subject: m.subject, text: m.text, channel: 'email' }, { ...facts, prices: [], reportFinal: false })
      expect(verdictOf(c)).toBe('pass')
    }
  })
  it('booking confirmation and reminder', () => {
    for (const k of ['confirm', 'reminder'] as const) {
      const m = bookingEmail(k, { first: 'Sam', when: 'Tuesday 1 December at 11:00', address: '12 Gordon Avenue, HA3 9QS', staff: 'Jamil Ahmed', letting: false, me: 'Jamil Ahmed', unsubscribeUrl: null })
      expect(m.text).toContain('Jamil will see you on Tuesday 1 December at 11:00'.slice(0, k === 'confirm' ? 99 : 0))
      const c = contentChecks({ subject: m.subject, text: m.text, channel: 'email' }, { ...facts, prices: [], reportFinal: false })
      expect(c.filter((x) => !x.ok).map((x) => x.name)).toEqual([])
    }
  })
})

describe('the instant thank-you', () => {
  it('thanks them, gives no figure and passes the sense-check rules', async () => {
    const { thankYouEmail } = await import('./followup-rules')
    for (const letting of [false, true]) {
      const m = thankYouEmail({ first: 'Sam', address: '12 Gordon Avenue', letting, me: 'Jamil Ahmed', unsubscribeUrl: null })
      expect(m.subject).toBe(`Thank you for your ${letting ? 'rental ' : ''}valuation request: 12 Gordon Avenue`)
      expect(m.text).not.toMatch(/£/)
      const c = contentChecks({ subject: m.subject, text: m.text, channel: 'email' }, { ...facts, prices: [], reportFinal: false })
      expect(c.filter((x) => !x.ok).map((x) => x.name)).toEqual([])
    }
  })
})
