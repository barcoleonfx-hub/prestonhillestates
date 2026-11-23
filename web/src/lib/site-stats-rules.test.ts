import { describe, expect, it } from 'vitest'
import { deviceOf, isBot, pageLabel, sourceOf } from './site-stats-rules'

const OWN = ['prestonhillestates.com']
describe('where a visit came from', () => {
  it('reads the page that sent it', () => {
    expect(sourceOf('https://www.google.co.uk/', {}, OWN)).toBe('Google')
    expect(sourceOf('https://www.rightmove.co.uk/properties/1', {}, OWN)).toBe('Rightmove')
    expect(sourceOf('https://l.facebook.com/l.php', {}, OWN)).toBe('Social media')
    expect(sourceOf('https://duckduckgo.com/', {}, OWN)).toBe('Other search engines')
    expect(sourceOf('', {}, OWN)).toBe('Direct')
    expect(sourceOf('https://www.prestonhillestates.com/', {}, OWN)).toBe('Direct')
    expect(sourceOf('https://example.org/page', {}, OWN)).toBe('example.org')
  })
  it('prefers the tag on our own links (emails, letters)', () => {
    expect(sourceOf('', { source: 'email', medium: 'newsletter' }, OWN)).toBe('Our emails')
    expect(sourceOf('', { source: 'letter' }, OWN)).toBe('Letters')
    expect(sourceOf('https://www.google.com/', { source: 'facebook' }, OWN)).toBe('Social media')
  })
})

describe('devices and robots', () => {
  it('tells phones, tablets and computers apart', () => {
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toBe('Phone')
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36')).toBe('Phone')
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('Tablet')
    expect(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15')).toBe('Computer')
  })
  it('leaves out robots and link previews', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
    expect(isBot('WhatsApp/2.23.20 A')).toBe(true)
    expect(isBot('')).toBe(true)
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(false)
  })
})

describe('page names', () => {
  it('names our pages and spots property pages', () => {
    expect(pageLabel('/valuation')).toEqual({ label: 'Free valuation', ref: null })
    expect(pageLabel('/')).toEqual({ label: 'Home page', ref: null })
    expect(pageLabel('/properties/phe1005-260-everton-court')).toEqual({ label: 'PHE1005', ref: 'PHE1005' })
    expect(pageLabel('/areas/kenton')).toEqual({ label: 'Area: Kenton', ref: null })
  })
})
