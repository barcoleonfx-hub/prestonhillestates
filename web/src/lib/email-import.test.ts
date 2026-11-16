import { describe, expect, it } from 'vitest'
import { fixSmallPrint, isBoilerplate, parseOnTheMarket } from './email-import'

const FOOTER = "OnTheMarket.com and the associated logos are trade marks of Agents' Mutual Limited, a wholly owned subsidiary of OnTheMarket Limited. Company No: 08381458. Registered in England & Wales. Registered Office: C/O Csc Cls (Uk) Limited, 5 Churchill Place, 10th Floor, London, United Kingdom, E14 5HU, England."

// An OnTheMarket valuation request as our email reader sees it (one table cell per line). Test details only.
const VALUATION = [
  'You have received a valuation request from Test Person.',
  'Contact information',
  'Test Person',
  'test.person@example.com',
  '07700 900123',
  '19 Example Road, Wembley, HA9 9ZZ',
  'Enquiry details',
  'I would like: a valuation',
  'Situation: Thinking of selling',
  FOOTER,
]

describe('OnTheMarket small print', () => {
  it('is recognised', () => {
    expect(isBoilerplate(FOOTER)).toBe(true)
    expect(isBoilerplate('19 Example Road, Wembley, HA9 9ZZ')).toBe(false)
    expect(isBoilerplate('Flat 2, 14 Kenton Road, Harrow HA3 9AB')).toBe(false)
  })
  it('is never taken for the home to value: their own address is', () => {
    const lead = parseOnTheMarket(VALUATION)!
    expect(lead.about).toBe('19 Example Road, Wembley, HA9 9ZZ')
    expect(lead.propertyPostcode).toBe('HA9 9ZZ')
    expect(lead.details.join('\n')).not.toMatch(/Agents' Mutual|Churchill Place/)
  })
  it('still finds the listing on a viewing request, and ignores the footer', () => {
    const lead = parseOnTheMarket([
      'You have received a viewing request from Test Person.', 'Contact information', 'Test Person', 'test.person@example.com', '07700 900123',
      'Enquiry details', 'Kenton Road, Harrow, HA3 9AB', 'Comments: Can I view on Saturday?', FOOTER,
    ])!
    expect(lead.about).toBe('Kenton Road, Harrow, HA3 9AB')
    expect(lead.propertyPostcode).toBe('HA3 9AB')
  })
  it('puts right an enquiry saved with the small print', () => {
    const saved = ['OnTheMarket valuation request', 'Wants: a valuation', `Property: ${FOOTER}`, 'Situation: Thinking of selling', 'Their address: 19 Example Road, Wembley, HA9 9ZZ', 'Email subject: Valuation enquiry from Test Person'].join('\n')
    const f = fixSmallPrint(saved, 'E14 5HU')!
    expect(f.message).toContain('Property: 19 Example Road, Wembley, HA9 9ZZ')
    expect(f.message).not.toMatch(/Churchill/)
    expect(f.postcode).toBe('HA9 9ZZ')
    expect(fixSmallPrint(f.message, f.postcode)).toBeNull()
  })
  it('just removes it from a non-valuation enquiry', () => {
    const f = fixSmallPrint(`OnTheMarket viewing request\nProperty: ${FOOTER}\nComments: hello`, null)!
    expect(f.message).toBe('OnTheMarket viewing request\nComments: hello')
    expect(f.postcode).toBeNull()
  })
})
