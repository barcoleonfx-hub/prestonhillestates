import { describe, expect, it } from 'vitest'
import { attachLimit, blankLetter, bodyHtml, firstNameOf, parseAddresses, personalise, renderLetter, type LetterProperty } from './letter-email'

const prop: LetterProperty = { id: 'p1', ref: 'PHE9002', address: 'Kenton Road, Harrow HA3', priceText: 'Guide price £650,000', facts: ['3 bedrooms', '2 bathrooms', 'Semi-detached house', 'Freehold'], url: 'https://example.com/properties/phe9002' }
const opts = { base: 'https://example.com', senderEmail: 'info@example.com', property: prop, attachments: ['Brochure.pdf'], footer: 'plain' as const, date: '16 November 2026' }
const letter = { ...blankLetter('Jamil Ahmed'), subject: '{first name}, the brochure for Kenton Road', body: 'As promised, here is the brochure.\n\n**Viewings** this Saturday:\n- 10am\n- 11am\n\nSee https://example.com/x.', propertyId: 'p1' }

describe('names', () => {
  it('uses the first name, never a title on its own or an email address', () => {
    expect(firstNameOf('Sam Example')).toBe('Sam')
    expect(firstNameOf('Mr Patel')).toBe('Mr Patel')
    expect(firstNameOf('Mr')).toBe('')
    expect(firstNameOf('sam@example.com')).toBe('')
  })
  it('fills in {first name}, or reads naturally without one', () => {
    expect(personalise('Dear {first name},', 'Sam Example', 'greeting')).toBe('Dear Sam,')
    expect(personalise('Dear {first name},', '', 'greeting')).toBe('Hello,')
    expect(personalise('{first name}, the brochure', '', 'subject')).toBe('the brochure')
    expect(personalise('Hi {first name}, here it is', '', 'body')).toBe('Hi, here it is')
  })
})

describe('the letter', () => {
  const m = renderLetter(letter, { email: 'sam@example.com', name: 'Sam Example' }, opts)
  it('has the letterhead, date, greeting and sign-off', () => {
    expect(m.subject).toBe('Sam, the brochure for Kenton Road')
    expect(m.html).toContain('PRESTON HILL')
    expect(m.html).toContain('16 November 2026')
    expect(m.html).toContain('Dear Sam,')
    expect(m.html).toContain('Jamil Ahmed')
  })
  it('shows the property as a plain box: no photos, just the key details', () => {
    expect(m.html).toContain('Kenton Road, Harrow HA3')
    expect(m.html).toContain('3 bedrooms &middot; 2 bathrooms &middot; Semi-detached house &middot; Freehold')
    expect(m.html).toContain('Ref PHE9002')
    expect(m.html).toContain('View the property')
    expect((m.html.match(/<img /g) ?? []).length).toBe(1) // only the logo
    expect(m.text).toContain('THE PROPERTY\nKenton Road, Harrow HA3\nGuide price £650,000')
  })
  it('lists the attachments and formats the message', () => {
    expect(m.html).toContain('<b>Attached:</b> Brochure.pdf')
    expect(m.html).toContain('<b>Viewings</b>')
    expect(m.html).toContain('<a href="https://example.com/x"')
    expect(m.text).toContain('Viewings this Saturday:')
  })
  it('leaves the property out when it is switched off or there is none', () => {
    expect(renderLetter({ ...letter, showProperty: false }, { email: 'a@b.co', name: '' }, opts).html).not.toContain('View the property')
    expect(renderLetter(letter, { email: 'a@b.co', name: '' }, { ...opts, property: null }).html).not.toContain('View the property')
  })
  it('has an unsubscribe line for groups, and none for one client', () => {
    expect(m.html).not.toMatch(/unsubscribe/i)
    expect(renderLetter(letter, { email: 'a@b.co', name: '' }, { ...opts, footer: 'unsubscribe', unsubscribeUrl: 'https://example.com/u' }).html).toContain('<a href="https://example.com/u"')
  })
  it('escapes what staff type', () => {
    expect(bodyHtml('<script>x</script> & co')).toContain('&lt;script&gt;x&lt;/script&gt; &amp; co')
  })
})

describe('addresses and attachments', () => {
  it('reads typed addresses with names, and spots mistakes', () => {
    const r = parseAddresses('Sam Example <SAM@example.com>\njo@example.com, not-an-email; jo@example.com')
    expect(r.list).toEqual([{ email: 'sam@example.com', name: 'Sam Example' }, { email: 'jo@example.com', name: '' }])
    expect(r.bad).toEqual(['not-an-email'])
  })
  it('allows less to big lists', () => {
    expect(attachLimit(1)).toBe(15 * 1048576)
    expect(attachLimit(26)).toBe(5 * 1048576)
  })
})

describe('bullet points', () => {
  it('work under a heading line in the same paragraph', () => {
    const h = bodyHtml('**Viewings** are available:\n- Saturday 10am\n- Monday after 5pm')
    expect(h).toMatch(/<p[^>]*><b>Viewings<\/b> are available:<\/p><table/)
    expect((h.match(/&#9679;/g) ?? []).length).toBe(2)
  })
})
