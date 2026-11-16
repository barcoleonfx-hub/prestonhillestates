import { describe, expect, it } from 'vitest'
import { lastTouch, nearestHomes, reconnectBlock, reconnectEmail, reconnectWhatsApp, type ReconnectLead } from './reconnect-rules'

const NOW = new Date('2026-11-16T12:00:00Z')
const lead = (o: Partial<ReconnectLead> = {}): ReconnectLead => ({
  status: 'dormant', createdAt: '2026-05-01T10:00:00Z', lastInboundAt: null, lastOutboundAt: '2026-05-02T10:00:00Z', doNotContact: false,
  marketingOptOut: false, email: 'sam@example.com', lastReconnectAt: null, followupActive: false, ...o,
})

describe('who to reconnect with', () => {
  it('takes quiet leads who are still open', () => {
    expect(reconnectBlock(lead(), NOW)).toBeNull()
    expect(reconnectBlock(lead({ status: 'viewing' }), NOW)).toBeNull()
  })
  it('leaves out anyone won, lost, mid-offer, or asked not to be contacted', () => {
    expect(reconnectBlock(lead({ status: 'won' }), NOW)).toMatch(/won/)
    expect(reconnectBlock(lead({ status: 'lost' }), NOW)).toMatch(/lost/)
    expect(reconnectBlock(lead({ status: 'offer' }), NOW)).toMatch(/offer/)
    expect(reconnectBlock(lead({ doNotContact: true }), NOW)).toMatch(/not to be contacted/)
    expect(reconnectBlock(lead({ marketingOptOut: true }), NOW)).toMatch(/Unsubscribed/)
    expect(reconnectBlock(lead({ email: null }), NOW)).toMatch(/No email/)
    expect(reconnectBlock(lead({ followupActive: true }), NOW)).toMatch(/followed up/)
  })
  it('waits 30 days after the last contact either way, and 90 days between reconnects', () => {
    expect(reconnectBlock(lead({ lastInboundAt: '2026-11-01T10:00:00Z' }), NOW)).toMatch(/In touch 15 days ago/)
    expect(reconnectBlock(lead({ lastReconnectAt: '2026-10-01T10:00:00Z' }), NOW)).toMatch(/recently/)
    expect(reconnectBlock(lead({ lastReconnectAt: '2026-07-01T10:00:00Z' }), NOW)).toBeNull()
    expect(lastTouch({ createdAt: '2026-01-01', lastInboundAt: '2026-03-01', lastOutboundAt: '2026-02-01' })).toBe('2026-03-01')
  })
})

describe('the emails', () => {
  const c = { first: 'Sam', me: 'Jamil Ahmed', address: '12 Example Road', postcode: 'HA3 0PS', when: 'May 2026', market: null, homes: [], liveCount: 0, base: 'https://example.com', unsubscribeUrl: 'https://example.com/u' }
  it('give an owner real local figures, with the source', () => {
    const m = reconnectEmail('sales-valuation', { ...c, market: { where: 'within half a mile', count12: 42, median12: 512500 } })
    expect(m.subject).toBe('What’s been selling near HA3 0PS')
    expect(m.text).toContain('You were in touch with us in May 2026 about selling 12 Example Road')
    expect(m.text).toContain('In the last 12 months, 42 homes sold within half a mile, at a typical price of £512,500 (Land Registry).')
    expect(m.text).toContain('https://example.com/sold-prices?postcode=HA3%200PS')
  })
  it('make no claims when there are no figures', () => {
    const m = reconnectEmail('sales-valuation', c)
    expect(m.text).not.toMatch(/\d+ homes sold/)
    expect(m.text).toContain('You can see what homes near you have sold for here')
  })
  it('show buyers our homes nearest their budget', () => {
    const m = reconnectEmail('buyer', { ...c, liveCount: 7, homes: [{ line: '3 Elm Way, £500,000, 3 bed', url: 'https://example.com/p/1' }] })
    expect(m.text).toContain('we have 7 homes for sale at the moment, including:')
    expect(m.text).toContain('3 Elm Way, £500,000, 3 bed\nhttps://example.com/p/1')
    expect(nearestHomes([{ price: 300000 }, { price: 510000 }, { price: 900000 }, { price: null }], 500000, 2)).toEqual([{ price: 510000 }, { price: 300000 }])
  })
  it('always say how to stop', () => {
    expect(reconnectEmail('tenant', c).text).toContain('https://example.com/u')
    expect(reconnectWhatsApp('buyer', 'Sam', 'Jamil', 'May 2026')).toMatch(/Reply STOP/)
  })
})
