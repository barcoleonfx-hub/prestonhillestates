import { describe, expect, it } from 'vitest'
import { factSheet, readerNotes, tidyBody, tidyFor, type WriterHome } from './email-writer-rules'

const home: WriterHome = {
  channel: 'sale', status: 'available', headline: 'Extended **family** home', address: 'Carlton Avenue East, Wembley HA9', price: 'Guide price £650,000',
  type: 'Semi-detached house', bedrooms: 3, bathrooms: 2, receptions: 1, floorAreaSqft: 1250, tenure: 'Freehold', leaseYears: null, serviceCharge: null, groundRent: null,
  councilTax: 'D', epc: 'C', parking: 'Driveway for two cars', outside: '90ft garden', heating: null, furnishing: null, availableFrom: null, deposit: null, newBuild: false,
  summary: 'A bright, extended home.', description: 'The kitchen opens onto a 90ft garden.', features: ['Open-plan kitchen', 'South-facing garden'],
  rooms: [{ name: 'Kitchen', dimensions: "18'2 x 12'0", description: 'Fitted with integrated appliances' }], url: 'https://example.com/p',
}

describe('the fact sheet', () => {
  it('lists only what the listing has, in plain words', () => {
    const s = factSheet(home)
    expect(s).toContain('Price: Guide price £650,000')
    expect(s).toContain('Bedrooms: 3')
    expect(s).toContain('Floor area: 1,250 sq ft')
    expect(s).toContain('Council tax band: D')
    expect(s).toContain('Headline: Extended family home')
    expect(s).toContain("- Kitchen (18'2 x 12'0): Fitted with integrated appliances")
    expect(s).not.toMatch(/Status|Lease remaining|Deposit|New build/)
  })
  it('says when a home is under offer', () => {
    expect(factSheet({ ...home, status: 'under_offer' })).toContain('Status: under offer')
  })
})

describe('the reader', () => {
  it('describes what one person is looking for', () => {
    expect(readerNotes({ role: 'buyer', minBeds: 3, maxPrice: 700000, areas: 'Kenton', position: 'First time buyer' }))
      .toBe('They are a buyer. They want at least 3 bedrooms. Their budget is up to £700,000. Areas they like: Kenton. Their position: First time buyer.')
    expect(readerNotes(null)).toBeNull()
    expect(readerNotes({ role: null, minBeds: null, maxPrice: null, areas: null, position: null })).toBeNull()
  })
})

describe('tidying the body', () => {
  it('drops a greeting and sign-off and uses "- " bullets', () => {
    expect(tidyBody('Dear Sam,\n\nA lovely home.\n\n• Garden\n* Parking\n\n\n\nCall us.\n\nKind regards,\nJamil')).toBe('A lovely home.\n\n- Garden\n- Parking\n\nCall us.')
    expect(tidyBody('Hi there,\nText')).toBe('Text')
    expect(tidyBody('Plain text only.')).toBe('Plain text only.')
  })
})

describe('tidying for each place', () => {
  it('keeps the greeting where the message has one, and drops it where the email adds its own', () => {
    const t = 'Hi Sam,\n\nThanks for your email.\n\nKind regards,\nJamil'
    expect(tidyFor('thread-reply', t)).toBe('Hi Sam,\n\nThanks for your email.')
    expect(tidyFor('letter', t)).toBe('Thanks for your email.')
    expect(tidyFor('whatsapp', 'Hi Sam,\n\nThe **3 bedroom house** is still available.')).toBe('Hi Sam,\n\nThe *3 bedroom house* is still available.')
    expect(tidyFor('whatsapp', 'Hi Sam,\n\n• Garden\n- Parking')).toBe('Hi Sam,\n\n• Garden\n• Parking')
    expect(tidyFor('campaign-letter', 'Hello {first_name},\n\nNews from the branch.')).toBe('Hello {first_name},\n\nNews from the branch.')
  })
})
