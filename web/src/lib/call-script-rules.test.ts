import { describe, expect, it } from 'vitest'
import { buildScript, callNotes, choices, pickSlots, sentPhrase, toldFromForm, type ScriptFacts } from './call-script-rules'

const facts = (over: Partial<ScriptFacts> = {}): ScriptFacts => ({
  kind: 'valuation', letting: false, first: 'Grace', me: 'Moniba', address: '12 Gordon Avenue, HA7 3QD', property: null, price: null,
  sent: { email: true, whatsapp: true, letter: false, calls: 0 },
  report: { state: 'none', asking: null, low: null, high: null, views: 0 },
  told: {}, slots: [{ date: '2026-11-27', time: '10:00', label: 'Friday 27 November at 10am' }, { date: '2026-11-28', time: '17:30', label: 'Saturday 28 November at 5:30pm' }], booked: null,
  ...over,
})
const text = (f: ScriptFacts) => JSON.stringify(buildScript(f))

describe('the call script is written for this lead', () => {
  it('uses their name, our name, their home, what we sent and two real times', () => {
    const s = buildScript(facts())
    expect(s.steps[0].say).toBe('Hi, is that Grace? It’s Moniba from Preston Hill Estates on Preston Road. You asked us about valuing 12 Gordon Avenue, HA7 3QD. I sent you an email and a WhatsApp, and I wanted to say hello properly. Is now an OK time for a couple of minutes?')
    expect(s.steps.find((x) => x.key === 'book')?.say).toBe('Would Friday 27 November at 10am or Saturday 28 November at 5:30pm suit you better?')
    expect(s.whatsapp).toContain('Friday 27 November at 10am or Saturday 28 November at 5:30pm')
    expect(text(facts())).not.toMatch(/\[their name\]|\[your name\]|\[their address\]/)
  })
  it('never gives a figure without a finalised report, and gives the guide when there is one', () => {
    expect(text(facts())).not.toMatch(/£\d/)
    expect(buildScript(facts()).heads.join(' ')).toMatch(/Don’t quote a figure/)
    expect(text(facts({ report: { state: 'draft', asking: 600000, low: null, high: null, views: 0 } }))).not.toMatch(/£\d/)
    const f = facts({ report: { state: 'final', asking: 585000, low: 570000, high: 600000, views: 2 } })
    expect(buildScript(f).heads.join(' ')).toMatch(/guide from it is £585,000 \(range £570,000 to £600,000\)/)
    expect(buildScript(f).steps.some((x) => x.key === 'report')).toBe(true)
    expect(buildScript(f).heads.join(' ')).toMatch(/opened their report 2 times.*don’t say we can see it/)
  })
  it('shows what they already told us against the question, so it isn’t asked twice', () => {
    const told = toldFromForm([{ label: 'When are you looking to sell', value: 'Within 3 months' }, { label: 'Bedrooms', value: '3' }, { label: 'Email', value: 'x@y.com' }, { label: 'Reason', value: 'n/a' }])
    expect(told).toEqual({ when: 'When are you looking to sell: Within 3 months', home: 'Bedrooms: 3' })
    const asks = buildScript(facts({ told })).steps.flatMap((s) => s.asks ?? [])
    expect(asks.find((a) => a.key === 'when')?.known).toMatch(/Within 3 months/)
    expect(asks.find((a) => a.key === 'why')?.known).toBeUndefined()
  })
  it('doesn’t book a second visit when one is already in the diary', () => {
    const s = buildScript(facts({ booked: 'Tue 1 Dec, 11:00' }))
    expect(s.steps.some((x) => x.key === 'book')).toBe(false)
    expect(s.heads[0]).toMatch(/already booked for Tue 1 Dec, 11:00/)
  })
  it('says it plainly when nothing has been sent and no times are free', () => {
    const s = buildScript(facts({ sent: { email: false, whatsapp: false, letter: false, calls: 0 }, slots: [] }))
    expect(s.steps[0].say).toMatch(/I wanted to call you personally about it\./)
    expect(s.steps.find((x) => x.key === 'book')?.say).toMatch(/\[day\] at \[time\] or \[day\] at \[time\]/)
  })
  it('has a rental version for landlords', () => {
    const s = buildScript(facts({ letting: true }))
    expect(s.title).toBe('Rental valuation call')
    expect(text(facts({ letting: true }))).toMatch(/thinking about letting/)
  })
  it('has buyer and tenant versions about the home they asked for', () => {
    const b = buildScript(facts({ kind: 'buyer', address: null, property: '24 Kenton Road, Harrow', price: '£475,000' }))
    expect(b.steps[0].say).toMatch(/You asked about 24 Kenton Road, Harrow, and I sent you an email and a WhatsApp/)
    expect(b.steps.flatMap((s) => s.asks ?? []).map((a) => a.key)).toEqual(['like', 'budget', 'money', 'aip', 'sell'])
    const t = buildScript(facts({ kind: 'tenant', address: null, property: 'Flat 2, 5 Preston Road', price: '£1,650 pcm' }))
    expect(t.title).toBe('Tenant call')
    expect(t.voicemail).toMatch(/about renting Flat 2, 5 Preston Road/)
  })
})

describe('around the call', () => {
  it('lists what we sent', () => {
    expect(sentPhrase({ email: true, whatsapp: false, letter: true, calls: 0 })).toBe('an email and a letter')
    expect(sentPhrase({ email: true, whatsapp: true, letter: true, calls: 0 })).toBe('an email, a WhatsApp and a letter')
    expect(choices([])).toBe('[day] at [time] or [day] at [time]')
  })
  it('offers free times on two different working days, never a Sunday', () => {
    const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
    // Thursday 26 November 2026; Friday 10am is taken.
    const s = pickSlots((d, t) => !(d === '2026-11-27' && t === '10:00'), '2026-11-26', dow, (d, t) => `${d} ${t}`)
    expect(s.map((x) => `${x.date} ${x.time}`)).toEqual(['2026-11-27 11:30', '2026-11-28 17:30'])
    const sat = pickSlots(() => true, '2026-11-27', dow, (d, t) => `${d} ${t}`)
    expect(sat.map((x) => x.date)).toEqual(['2026-11-28', '2026-11-30'])
  })
  it('writes the call log from the answers and notes', () => {
    const s = buildScript(facts())
    const n = callNotes(s, { why: 'Moving to be near family', when: 'Spring', agents: '' }, 'Wife works from home, call after 5', 'callback', 'Fri 27 Nov, 17:30')
    expect(n).toBe('Valuation call: call them back (Fri 27 Nov, 17:30)\nWhat’s got you thinking about selling? Moving to be near family\nWhen would you ideally like to move, or have it on the market? Spring\nNotes: Wife works from home, call after 5')
  })
})
