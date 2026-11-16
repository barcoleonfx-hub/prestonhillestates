import { describe, expect, it } from 'vitest'
import { STEPS, dueAt, followupEmail, followupWhatsApp, nextDue, stepSkip, stopReason, type LeadState } from './followup-rules'

const lead = (o: Partial<LeadState> = {}): LeadState => ({
  status: 'new', startedAt: '2026-11-16T15:00:00Z', lastInboundAt: null, lastOutboundAt: null, doNotContact: false,
  marketingOptOut: false, email: 'sam@example.com', canWhatsApp: true, ...o,
})

describe('when steps are due', () => {
  it('is so many days after the enquiry, at 10am London time', () => {
    // Monday 16 Nov 2026, 3pm. Day 2 is Wednesday at 10am (GMT in November).
    expect(dueAt('2026-11-16T15:00:00Z', 2)).toBe('2026-11-18T10:00:00.000Z')
    // Summer: 10am BST is 9am UTC.
    expect(dueAt('2026-07-13T15:00:00Z', 2)).toBe('2026-07-15T09:00:00.000Z')
  })
  it('never lands on a Sunday', () => {
    // Friday + 2 days is Sunday: moved to Monday.
    expect(dueAt('2026-11-20T15:00:00Z', 2)).toBe('2026-11-23T10:00:00.000Z')
  })
  it('keeps at least 20 hours between steps when running late', () => {
    // Step 2 (day 2) was due on Wednesday; it's Thursday 11am: it goes Friday 10am, not now.
    expect(nextDue('2026-11-16T15:00:00Z', 1, new Date('2026-11-19T11:00:00Z'))).toBe('2026-11-20T10:00:00.000Z')
    // On time: the planned slot.
    expect(nextDue('2026-11-16T15:00:00Z', 2, new Date('2026-11-18T10:05:00Z'))).toBe('2026-11-21T10:00:00.000Z')
    expect(nextDue('2026-11-16T15:00:00Z', STEPS.length, new Date())).toBeNull()
  })
  it('runs over two weeks, mixing emails and WhatsApps', () => {
    expect(STEPS.map((s) => `${s.channel}:${s.day}`)).toEqual(['whatsapp:1', 'email:2', 'email:5', 'whatsapp:9', 'email:14'])
  })
})

describe('when to stop or skip', () => {
  it('carries on for a new or contacted lead with no reply', () => {
    expect(stopReason(lead())).toBeNull()
    expect(stopReason(lead({ status: 'contacted', lastOutboundAt: '2026-11-17T10:00:00Z' }))).toBeNull()
  })
  it('stops when they reply, move on, or ask us not to', () => {
    expect(stopReason(lead({ lastInboundAt: '2026-11-17T09:00:00Z' }))).toMatch(/replied/)
    expect(stopReason(lead({ status: 'viewing' }))).toMatch(/moved on/)
    expect(stopReason(lead({ status: 'lost' }))).toMatch(/moved on/)
    expect(stopReason(lead({ doNotContact: true }))).toMatch(/not to be contacted/)
    expect(stopReason(lead({ email: null, canWhatsApp: false }))).toMatch(/No email/)
  })
  it('ignores a reply from before the follow-ups started', () => {
    expect(stopReason(lead({ lastInboundAt: '2026-11-01T09:00:00Z' }))).toBeNull()
  })
  it('skips emails to people with no address or who unsubscribed, or who we emailed in the last day', () => {
    const em = STEPS[1]
    expect(stepSkip(em, lead())).toBeNull()
    expect(stepSkip(em, lead({ email: null }))).toMatch(/No email/)
    expect(stepSkip(em, lead({ marketingOptOut: true }))).toMatch(/unsubscribed/)
    expect(stepSkip(em, lead({ lastOutboundAt: '2026-11-18T08:00:00Z' }), new Date('2026-11-18T10:00:00Z'))).toMatch(/last day/)
    expect(stepSkip(STEPS[0], lead({ canWhatsApp: false }))).toMatch(/WhatsApp/)
  })
})

describe('the emails', () => {
  const c = { first: 'Sam', me: 'Jamil Ahmed', address: '12 Example Road', postcode: 'HA3 0PS', base: 'https://example.com', unsubscribeUrl: 'https://example.com/unsubscribe?c=1&t=x' }
  it('follow up a valuation, signed by the person looking after it', () => {
    const m = followupEmail('sales-valuation', 'em2', c)!
    expect(m.subject).toBe('Your valuation: 12 Example Road')
    expect(m.text).toMatch(/^Hi Sam,\n\nI just wanted to follow up on your request for a valuation for 12 Example Road\./)
    expect(m.text).toContain('Jamil Ahmed\nPreston Hill Estates')
    expect(m.text).toContain('https://example.com/unsubscribe?c=1&t=x')
    expect(m.html).toContain('<a href="https://example.com/unsubscribe?c=1&amp;t=x">')
  })
  it('link to something useful for each kind of lead', () => {
    expect(followupEmail('sales-valuation', 'em5', c)!.text).toContain('https://example.com/sold-prices?postcode=HA3%200PS')
    expect(followupEmail('lettings-valuation', 'em5', c)!.text).toContain('https://example.com/landlords#estimate')
    expect(followupEmail('buyer', 'em5', c)!.text).toContain('https://example.com/properties?channel=sale')
    expect(followupEmail('tenant', 'em5', c)!.text).toContain('https://example.com/renting#register')
  })
  it('close politely', () => {
    expect(followupEmail('buyer', 'em14', c)!.subject).toBe('Shall I close your enquiry?')
  })
  it('cope with no name, no address and no owner', () => {
    const m = followupEmail('buyer', 'em2', { ...c, first: '', address: null, me: '', unsubscribeUrl: null })!
    expect(m.text).toMatch(/^Hello,\n/)
    expect(m.subject).toBe('Your enquiry with Preston Hill Estates')
    expect(m.text).toContain('The team\nPreston Hill Estates')
    expect(m.text).toContain('Just reply “stop”')
  })
  it('only exist for email steps', () => {
    expect(followupEmail('buyer', 'wa1', c)).toBeNull()
    expect(followupWhatsApp('buyer', 'wa1', 'Sam', 'Jamil Ahmed')).toBe('Hi Sam, it’s Jamil from Preston Hill Estates. Thanks for your enquiry. When’s a good time for a quick call?')
    expect(followupWhatsApp('lettings-valuation', 'wa9', 'Sam', 'Jamil Ahmed')).toBe('Hi Sam, it’s Jamil from Preston Hill Estates. Are you still thinking of letting? Happy to help whenever you’re ready, just reply here.')
  })
})
