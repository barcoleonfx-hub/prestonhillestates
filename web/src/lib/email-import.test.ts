import { describe, expect, it } from 'vitest'
import { cleanLines, fixSmallPrint, isBoilerplate, parseOnTheMarket, tidyName } from './email-import'

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
  it('puts right every line that has it, in one go', () => {
    const saved = [`About: ${FOOTER}`, 'OnTheMarket valuation request', `Property: ${FOOTER}`, 'Their address: 19 Example Road, Wembley, HA9 9ZZ'].join('\n')
    const f = fixSmallPrint(saved, 'E14 5HU')!
    expect(f.message).toBe(['About: 19 Example Road, Wembley, HA9 9ZZ', 'OnTheMarket valuation request', 'Property: 19 Example Road, Wembley, HA9 9ZZ', 'Their address: 19 Example Road, Wembley, HA9 9ZZ'].join('\n'))
    expect(f.postcode).toBe('HA9 9ZZ')
    expect(fixSmallPrint(f.message, f.postcode)).toBeNull()
  })
  it('keeps a postcode staff put right themselves', () => {
    expect(fixSmallPrint(`OnTheMarket valuation request\nProperty: ${FOOTER}\nTheir address: 19 Example Road, Wembley, HA9 9ZZ`, 'HA3 0PS')!.postcode).toBe('HA3 0PS')
  })
  it('just removes it from a non-valuation enquiry', () => {
    const f = fixSmallPrint(`OnTheMarket viewing request\nProperty: ${FOOTER}\nComments: hello`, null)!
    expect(f.message).toBe('OnTheMarket viewing request\nComments: hello')
    expect(f.postcode).toBeNull()
  })
})

describe('an OnTheMarket request with a long comment', () => {
  const text = `Request details
You have received a details request from JACQUELENE PERALTA.
Contact information
JACQUELENE PERALTA
07557 385092
jackiejeffyperalta@example.com
28 Caroline Terrace, London, SW1W 8JT
Enquiry details
* I would like: more details for the following property
* Situation: I am a first-time buyer
* Comments: Hi goodday !We are looking for a property to buy.we are interested to view this property if possible please thank you very much. Jacquelene&Jeffy Peralta 07828440500 or 07473820669
£650,000
468, North Circular Road (HMO), London, NW10 1SP
5 bedroom semi-detached house for sale
Your agency ref: ttKudg5UrGI
User achievements
OnTheMarket.com and the associated logos are trade marks of Agents' Mutual Limited. Registered Office: 5 Churchill Place, London E14 5HU`
  it('finds the listing under the comment, not their own address', () => {
    const lead = parseOnTheMarket(cleanLines(text))!
    expect(lead.about).toBe('468, North Circular Road (HMO), London, NW10 1SP')
    expect(lead.propertyPostcode).toBe('NW10 1SP')
    expect(lead.intent).toBe('buy')
    expect(lead.applicantAddress).toBe('28 Caroline Terrace, London, SW1W 8JT')
    expect(lead.comments).toMatch(/^Hi goodday/)
    expect(lead.details).toContain('Listing: £650,000 – 5 bedroom semi-detached house for sale')
    expect(lead.name).toBe('Jacquelene Peralta')
  })
  it('tidies names typed in capitals, and leaves others alone', () => {
    expect(tidyName("MARY O'NEILL-SMITH")).toBe("Mary O'Neill-Smith")
    expect(tidyName('Sam de Souza')).toBe('Sam de Souza')
    expect(tidyName('JK')).toBe('Jk')
  })
})
