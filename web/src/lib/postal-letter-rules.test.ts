import { describe, expect, it } from 'vitest'
import { addressLines, chooseByDefault, fillLetter, firstName, LETTER_BEFORE, postable, shortHome } from './postal-letter-rules'

describe('addresses for the envelope window', () => {
  it('puts each part on its own line with the postcode last', () => {
    expect(addressLines('4 Kenton Park Avenue, Harrow, Middlesex, ha3 8dn')).toEqual(['4 Kenton Park Avenue', 'Harrow', 'Middlesex', 'HA3 8DN'])
    expect(addressLines('4 Kenton Park Avenue, Harrow', 'HA3 8DN')).toEqual(['4 Kenton Park Avenue', 'Harrow', 'HA3 8DN'])
    expect(addressLines('12 Elm Way, Wembley, Wembley, United Kingdom', 'HA9 7AB')).toEqual(['12 Elm Way', 'Wembley', 'HA9 7AB'])
  })
  it('only posts to a full address', () => {
    expect(postable(addressLines('4 Kenton Park Avenue', 'HA3 8DN'))).toBe(true)
    expect(postable(addressLines('Rose Cottage, Kenton Lane', 'HA3 8DN'))).toBe(true)
    expect(postable(addressLines('Kenton Park Avenue', 'HA3 8DN'))).toBe(false)
    expect(postable(addressLines('4 Kenton Park Avenue, Harrow'))).toBe(false)
    expect(postable(addressLines(null, 'HA3 8DN'))).toBe(false)
  })
  it('names the home in the letter', () => {
    expect(shortHome(addressLines('4 Kenton Park Avenue, Harrow', 'HA3 8DN'))).toBe('4 Kenton Park Avenue')
    expect(shortHome(addressLines('Flat 2, 10 High Road, Wembley', 'HA9 7AB'))).toBe('Flat 2, 10 High Road')
    expect(shortHome([])).toBeNull()
  })
})

describe('who to write to', () => {
  const ok = { postable: true, booked: false, lastLetterAt: null, status: 'contacted' }
  const now = new Date('2026-11-19T12:00:00Z')
  it('writes to those with an address who aren’t booked in or written to lately', () => {
    expect(chooseByDefault(ok, now)).toEqual({ tick: true, why: null })
    expect(chooseByDefault({ ...ok, postable: false }, now).tick).toBe(false)
    expect(chooseByDefault({ ...ok, booked: true }, now).why).toBe('Valuation already booked')
    expect(chooseByDefault({ ...ok, status: 'won' }, now).tick).toBe(false)
    expect(chooseByDefault({ ...ok, lastLetterAt: '2026-11-01T10:00:00Z' }, now).why).toBe('Written to in the last 30 days')
    expect(chooseByDefault({ ...ok, lastLetterAt: '2026-09-01T10:00:00Z' }, now).tick).toBe(true)
  })
})

describe('the letter', () => {
  it('fills in their name and home', () => {
    expect(firstName('Kanti Patel')).toBe('Kanti')
    expect(firstName('Mrs Patel')).toBe('Mrs Patel')
    const [p] = fillLetter(LETTER_BEFORE, { first: 'Kanti', home: '4 Kenton Park Avenue' })
    expect(p).toMatch(/^Thank you for asking us to value 4 Kenton Park Avenue\./)
    expect(fillLetter('A\n\nB {home}', { first: '', home: null })).toEqual(['A', 'B your home'])
  })
})
