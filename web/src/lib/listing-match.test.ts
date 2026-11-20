import { describe, expect, it } from 'vitest'
import { hintFrom, pickListing, type Candidate } from './listing-match'

const everton: Candidate[] = [
  { id: 'sale', postcode: 'HA7 1JT', channel: 'sale', price: 270000, status: 'available' },
  { id: 'let', postcode: 'HA7 1JT', channel: 'let', price: 1750, status: 'available' },
]

describe('which listing an enquiry is about', () => {
  it('reads sale or let, and the price, from what the portal says', () => {
    expect(hintFrom('Zoopla tenant enquiry\nType of enquiry: Organise a viewing\nListing: £1,750 pcm', 'rent')).toEqual({ channel: 'let', price: 1750 })
    expect(hintFrom('OnTheMarket details request\nListing: £650,000 – 5 bedroom semi-detached house for sale', 'buy')).toEqual({ channel: 'sale', price: 650000 })
    // OnTheMarket calls everything a request; the card says it's to rent.
    expect(hintFrom('OnTheMarket details request\nListing: £1,600 pcm – 2 bedroom flat to rent', 'buy').channel).toBe('let')
    // Their own words don't count: a buyer who rents now is still a buyer.
    // OnTheMarket viewing requests: only the subject says it's a letting.
    expect(hintFrom('OnTheMarket viewing request\nWants: to arrange a viewing for the following property\nProperty: 260 Everton Court, Honeypot Lane, Stanmore, HA7 1DZ\nComments: I am available to rent this property immediately\nEmail subject: Lettings enquiry from Cresan Thevathasan', 'buy').channel).toBe('let')
    expect(hintFrom('OnTheMarket viewing request\nEmail subject: Sales enquiry from Sam Shah', 'buy').channel).toBe('sale')
    expect(hintFrom('Zoopla buyer enquiry\nSituation: I am a tenant\nComments: we pay £1,500 pcm now\nListing: £400,000', 'buy')).toEqual({ channel: 'sale', price: 400000 })
  })
  it('picks the flat to let for a tenant, and the one for sale for a buyer', () => {
    expect(pickListing(everton, 'HA7', { channel: 'let', price: 1750 })).toBe('let')
    expect(pickListing(everton, 'HA7', { channel: 'sale', price: 270000 })).toBe('sale')
    expect(pickListing(everton, 'HA7', { channel: null, price: 1750 })).toBe('let')
  })
  it('links nothing rather than the wrong side', () => {
    expect(pickListing([everton[0]], 'HA7', { channel: 'let', price: 1750 })).toBeNull()
    expect(pickListing(everton, 'HA9', { channel: 'let', price: 1750 })).toBeNull()
  })
})
