import { describe, expect, it } from 'vitest'
import { canReach, defaultPropertyOptions, isStop, newHomeMessage, nextTwoDays, positionMessage, propertyMessage, quietEnds, quietReason, waBlocked, waLink, waTemplates, type WaListing } from './whatsapp'

// London times in November are GMT, so these UTC times are the same on the clock.
const at = (iso: string) => new Date(iso)

describe('waLink', () => {
  it('builds a wa.me link with the message filled in', () => {
    expect(waLink('+447745203146', 'Hi Sam, it’s 3pm?')).toBe('https://wa.me/447745203146?text=Hi%20Sam%2C%20it%E2%80%99s%203pm%3F')
    expect(waLink('447745203146', '')).toBe('https://wa.me/447745203146')
  })
})

describe('who WhatsApp can reach', () => {
  it('needs a mobile', () => {
    expect(canReach('+447745203146')).toBe(true)
    expect(canReach('+442089049005')).toBe(false)
    expect(canReach('+33612345678')).toBe(true)
    expect(canReach(null)).toBe(false)
  })
  it('blocks STOP, do-not-contact and landlines, in that order', () => {
    expect(waBlocked({ e164: '+447745203146' })).toBeNull()
    expect(waBlocked({ e164: '+447745203146', doNotContact: true })).toMatch(/not to be contacted/)
    expect(waBlocked({ e164: '+447745203146', stoppedAt: '2026-11-01T10:00:00Z' })).toMatch(/STOP/)
    expect(waBlocked({ e164: '+442089049005' })).toMatch(/mobile/)
    expect(waBlocked({ e164: null })).toMatch(/no phone/)
  })
  it('recognises a STOP reply', () => {
    for (const t of ['STOP', 'stop', ' Stop. ', 'Unsubscribe', 'stop messaging me', 'opt out']) expect(isStop(t)).toBe(true)
    for (const t of ['Can’t stop thinking about the house!', 'Saturday works', '']) expect(isStop(t)).toBe(false)
  })
})

describe('quiet hours (Sundays, and 9pm to 9am)', () => {
  it('is fine on a weekday afternoon and Saturday morning', () => {
    expect(quietReason(at('2026-11-16T14:00:00Z'))).toBeNull() // Monday
    expect(quietReason(at('2026-11-21T09:00:00Z'))).toBeNull() // Saturday 9am
    expect(quietReason(at('2026-11-20T20:59:00Z'))).toBeNull() // Friday 8.59pm
  })
  it('is quiet late, early and all Sunday', () => {
    expect(quietReason(at('2026-11-16T21:00:00Z'))).toMatch(/after 9pm/)
    expect(quietReason(at('2026-11-17T08:59:00Z'))).toMatch(/before 9am/)
    expect(quietReason(at('2026-11-22T13:00:00Z'))).toMatch(/Sunday/)
  })
  it('uses London time in summer too', () => {
    expect(quietReason(at('2026-07-13T08:30:00Z'))).toBeNull() // 9.30am BST
    expect(quietReason(at('2026-07-13T20:30:00Z'))).toMatch(/after 9pm/) // 9.30pm BST
  })
  it('says when it ends', () => {
    expect(quietEnds(at('2026-11-17T07:00:00Z'))).toBe('after 9am')
    expect(quietEnds(at('2026-11-17T22:00:00Z'))).toBe('tomorrow after 9am')
    expect(quietEnds(at('2026-11-21T22:00:00Z'))).toBe('on Monday after 9am')
    expect(quietEnds(at('2026-11-22T12:00:00Z'))).toBe('on Monday after 9am')
  })
})

describe('messages', () => {
  it('writes a first reply for a viewing request with the home’s details, link and two days to choose', () => {
    const [intro] = waTemplates({ first: 'Sam', me: 'Jamil Ahmed', kind: 'viewing', address: '12 Kenton Road, Harrow HA3', days: 'Thursday or Friday',
      home: { url: 'https://example.com/properties/12-kenton-road?utm_source=whatsapp', price: '£650,000', specs: ['3 bed', '2 bath', '1 reception'] } })
    expect(intro.text).toMatch(/^Hi Sam, it’s Jamil from Preston Hill Estates, the estate agent at 271 Preston Road\./)
    expect(intro.text).toContain('*12 Kenton Road, Harrow HA3* (£650,000 · 3 bed · 2 bath)')
    expect(intro.text).toContain('https://example.com/properties/12-kenton-road?utm_source=whatsapp')
    expect(intro.text).toContain('Would *Thursday or Friday* suit you for a viewing?')
    expect(intro.text).toContain('are you buying with a mortgage, and do you have a home to sell?')
    expect(intro.marketing).toBe(false)
    const lets = waTemplates({ first: 'Sam', me: 'Jamil', kind: 'viewing', isLet: true, address: '1 Flat, HA9' })[0].text
    expect(lets).toContain('when are you looking to move')
  })
  it('sends a valuation lead their property report, with honest proof and a clear question', () => {
    const t = waTemplates({ first: 'Kanti', me: 'Jamil', kind: 'valuation', address: '4 Kenton Park Avenue', report: 'https://example.com/report/abc', days: 'tomorrow or Saturday', rating: { rating: 4.86, count: 112 } })
    const intro = t[0].text
    expect(intro).toContain('valuation of *4 Kenton Park Avenue*')
    expect(intro).toContain('free personal property report for your home')
    expect(intro).toContain('https://example.com/report/abc')
    expect(intro).toContain('rated 4.9★ from 112 Google reviews')
    expect(intro).toContain('Would *tomorrow or Saturday* suit you for us to come round?')
    expect(t.find((x) => x.key === 'missed')?.text).toContain('https://example.com/report/abc')
    expect(t.find((x) => x.key === 'checkin')?.text).toContain('https://example.com/report/abc')
    // No rating is claimed unless one has been entered (and it has enough reviews behind it).
    const plain = waTemplates({ first: 'Kanti', me: 'Jamil', kind: 'valuation', rating: null })[0].text
    expect(plain).not.toMatch(/★|Google/)
    expect(plain).toContain('When would suit you for us to come round?')
    expect(waTemplates({ first: 'K', me: 'J', kind: 'valuation', rating: { rating: 5, count: 2 } })[0].text).not.toContain('★')
  })
  it('asks a new buyer or tenant what they need', () => {
    const t = waTemplates({ first: 'Ali', me: 'Jamil', kind: 'tenant' })[0].text
    expect(t).toContain('1. Which areas you’d like')
    expect(t).toContain('monthly budget')
    expect(t).toContain('letting homes around Preston Road since 2004')
  })
  it('suggests the next two days we’re open, skipping Sunday', () => {
    expect(nextTwoDays(new Date('2026-11-18T12:00:00Z'))).toBe('tomorrow or Friday') // a Wednesday
    expect(nextTwoDays(new Date('2026-11-20T12:00:00Z'))).toBe('tomorrow or Monday') // a Friday
    expect(nextTwoDays(new Date('2026-11-21T12:00:00Z'))).toBe('Monday or Tuesday') // a Saturday
    expect(nextTwoDays(new Date('2026-11-22T12:00:00Z'))).toBe('tomorrow or Tuesday') // a Sunday
  })
  it('offers a reminder before an appointment and a follow-up after it', () => {
    const before = waTemplates({ first: 'Sam', me: 'Jamil', kind: 'valuation', appointment: { kind: 'valuation', when: 'Tuesday 18 November at 2:00 pm', address: '3 Elm Way', past: false } })
    expect(before.find((t) => t.key === 'reminder')?.text).toContain('reminder of your valuation at 3 Elm Way on Tuesday 18 November')
    expect(before.find((t) => t.key === 'after')).toBeUndefined()
    const after = waTemplates({ first: 'Sam', me: 'Jamil', kind: 'viewing', appointment: { kind: 'viewing', when: 'x', address: '3 Elm Way', past: true } })
    expect(after.find((t) => t.key === 'after')?.text).toContain('thanks for viewing 3 Elm Way')
  })
  it('copes without a name', () => {
    expect(waTemplates({ first: '', me: '', kind: 'general' })[0].text).toMatch(/^Hi, it’s Preston Hill Estates, the estate agent/)
  })
  it('lets people stop new-home messages', () => {
    const m = newHomeMessage('Sam', 'Jamil Ahmed', { line: '3 bed house, Kenton, £650,000', url: 'https://example.com/p' })
    expect(m).toContain('https://example.com/p')
    expect(m).toMatch(/Reply STOP/)
  })
})

const home: WaListing = {
  id: 'p1', channel: 'sale', status: 'available', what: '3 bedroom semi-detached house', address: 'Carlton Avenue East, Wembley HA9', price: 'Guide price £650,000',
  facts: [{ key: 'beds', text: '3 bedrooms', on: true }, { key: 'baths', text: '2 bathrooms', on: true }, { key: 'tenure', text: 'Freehold', on: true }, { key: 'epc', text: 'EPC C', on: false }],
  short: 'A bright, extended family home on a quiet road.', long: 'A bright, extended family home on a quiet road. The kitchen opens onto a 90ft garden.',
  features: ['Extended kitchen', '90ft garden', 'Off-street parking', 'Close to station', 'Two bathrooms', 'Loft room'],
  url: 'https://example.com/properties/p1?utm_source=whatsapp', tour: 'https://tour.example.com/p1',
}
const who = { first: 'Priya', me: 'Jamil Ahmed', days: 'tomorrow or Friday' }

describe('messages about one of our homes', () => {
  it('writes an accurate first reply from the listing, with what staff chose to include', () => {
    const o = defaultPropertyOptions(home)
    expect(o.facts).toEqual(['price', 'beds', 'baths', 'tenure'])
    expect(o.features).toHaveLength(5)
    const m = propertyMessage(who, home, o, 'first')
    expect(m).toMatch(/^Hi Priya, it’s Jamil from Preston Hill Estates\. Thank you for your enquiry about the \*3 bedroom semi-detached house\* on \*Carlton Avenue East, Wembley HA9\*\./)
    expect(m).toContain('*Guide price £650,000*\n3 bedrooms · 2 bathrooms · Freehold')
    expect(m).not.toContain('EPC C')
    expect(m).toContain('A bright, extended family home on a quiet road.')
    expect(m).toContain('*Key features*\n• Extended kitchen\n• 90ft garden')
    expect(m).not.toContain('Loft room')
    expect(m).toContain('Full details and photos:\nhttps://example.com/properties/p1?utm_source=whatsapp')
    expect(m).not.toContain('tour.example.com')
    expect(m).toContain('Would *tomorrow or Friday* suit you for a viewing?')
    expect(m).toContain('are you buying with a mortgage, and do you have a home to sell?')
  })
  it('leaves out whatever is switched off, and adds the tour and longer description when asked', () => {
    const m = propertyMessage(who, home, { facts: ['epc'], text: 'long', features: ['Loft room'], link: false, tour: true, viewing: false, ask: false })
    expect(m).not.toContain('£650,000')
    expect(m).toContain('EPC C')
    expect(m).toContain('The kitchen opens onto a 90ft garden.')
    expect(m).toContain('• Loft room')
    expect(m).not.toContain('Full details')
    expect(m).toContain('Virtual tour:\nhttps://tour.example.com/p1')
    expect(m).not.toMatch(/viewing|mortgage/)
  })
  it('says plainly when a home is under offer, and offers help instead of a viewing', () => {
    const gone = { ...home, status: 'under_offer' }
    const m = propertyMessage(who, gone, defaultPropertyOptions(gone))
    expect(m).toContain('it’s currently *under offer*')
    expect(m).not.toContain('suit you for a viewing')
    expect(m).toContain('send you similar homes')
    expect(propertyMessage(who, gone, defaultPropertyOptions(gone), 'viewing')).toContain('*under offer*')
  })
  it('sends the details on their own, and a short viewing note', () => {
    const d = propertyMessage(who, home, defaultPropertyOptions(home), 'details')
    expect(d).toMatch(/^Hi Priya, here are the details of the \*3 bedroom/)
    expect(d).toContain('Any questions, just reply here.')
    expect(d).toMatch(/Jamil, Preston Hill Estates$/)
    expect(d).not.toContain('mortgage')
    const v = propertyMessage(who, home, defaultPropertyOptions(home), 'viewing')
    expect(v).toContain('would you like to view the *3 bedroom semi-detached house*')
    expect(v).toContain('I can arrange *tomorrow or Friday*')
  })
  it('asks lettings questions for homes to rent', () => {
    const flat = { ...home, channel: 'let' as const, what: '2 bedroom flat', address: 'Flat 3, 10 High Road, HA9', price: '£1,850 pcm' }
    expect(propertyMessage(who, flat, defaultPropertyOptions(flat))).toContain('when are you looking to move')
    expect(propertyMessage(who, flat, defaultPropertyOptions(flat))).toContain('the *2 bedroom flat* at *Flat 3, 10 High Road, HA9*')
    expect(positionMessage(who, true, flat)).toContain('2. Who would be living there, and are there any pets?')
    expect(positionMessage(who, false, null)).toContain('1. Are you buying with a mortgage, and do you have an agreement in principle?')
  })
})
