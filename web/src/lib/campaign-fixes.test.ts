import { describe, expect, it } from 'vitest'
import { campaignFields, unshout, unusualLot, whereIs, withCampaignFields, type Content } from './campaign'

describe('tidying listings for an email', () => {
  it('turns shouting titles into title case and keeps postcodes', () => {
    expect(unshout('4 X 2/3 F4-HOLD BATCH OF HOUSES FOR SALE, NORTH WEMBLEY HA0 3AB')).toBe('4 X 2/3 F4-Hold Batch of Houses for Sale, North Wembley HA0 3AB')
    expect(unshout('35 Church Road, Kingsbury NW9')).toBe('35 Church Road, Kingsbury NW9')
  })
  it('spots lots that suit investors only', () => {
    expect(unusualLot({ address: '4 X 2/3 F4-HOLD BATCH OF HOUSES', headline: '10 bed other', type: 'Other', beds: 10 })).toBe(true)
    expect(unusualLot({ address: 'Portfolio of four flats', headline: '', type: 'Flat', beds: 4 })).toBe(true)
    expect(unusualLot({ address: '12 Park Lane, Wembley HA9', headline: '3 bed semi-detached house', type: 'Semi-detached house', beds: 3 })).toBe(false)
  })
  it('always says where a home is', () => {
    expect(whereIs({ address: '35 Church Road', place: 'Kingsbury', outward: 'NW9' })).toBe('35 Church Road, Kingsbury NW9')
    expect(whereIs({ address: '12 Park Lane, Wembley HA9', place: 'Wembley', outward: 'HA9' })).toBe('12 Park Lane, Wembley HA9')
    expect(whereIs({ address: '59 Church Lane', place: null, outward: null })).toBe('59 Church Lane')
  })
})

describe('the wording "Fix these for me" can change', () => {
  const c: Content = {
    subject: 'Property of the week: {spotlight}', preheader: 'The one to see', signedBy: 'Jamil',
    blocks: [
      { id: 'a', kind: 'letter', title: 'Hello', body: 'Hi {first_name},\n\nNews.' },
      { id: 'b', kind: 'spotlight', propertyId: 'p1', label: 'Property of the week', why: '', others: 3 },
      { id: 'c', kind: 'cta', variant: 'auto' },
    ],
  }
  it('lists each piece of wording', () => {
    expect(campaignFields(c).map((f) => f.key)).toEqual(['subject', 'preheader', 'a.title', 'a.body', 'b.label', 'b.why'])
  })
  it('puts new wording back, and ignores anything that isn’t wording', () => {
    const n = withCampaignFields(c, { subject: 'New subject', 'b.why': 'A lovely home.', 'b.propertyId': 'x', 'c.variant': 'letting', 'zz.title': 'no' })
    expect(n.subject).toBe('New subject')
    expect(n.blocks[1]).toMatchObject({ why: 'A lovely home.', propertyId: 'p1' })
    expect(n.blocks[2]).toMatchObject({ variant: 'auto' })
    expect(c.blocks[1]).toMatchObject({ why: '' })
  })
})
