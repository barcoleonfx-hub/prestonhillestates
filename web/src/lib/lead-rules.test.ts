import { describe, expect, it } from 'vitest'
import { CONSENT_WORDING, LEAD_MAGNETS, isUkMobile, nextStatus, parseAttribution, statusLabel, ticked, toE164 } from './lead-rules'
import { leadsIn, parseImportLead } from './lead-import'

describe('nextStatus', () => {
  it('moves a new lead to contacted when we get in touch, and engaged when they reply', () => {
    expect(nextStatus('new', 'outbound')).toBe('contacted')
    expect(nextStatus('contacted', 'inbound')).toBe('engaged')
    expect(nextStatus('new', 'inbound')).toBe('engaged')
  })
  it('never moves backwards on ordinary events', () => {
    expect(nextStatus('engaged', 'outbound')).toBe('engaged')
    expect(nextStatus('viewing', 'inbound')).toBe('viewing')
    expect(nextStatus('offer', 'booked')).toBe('offer')
  })
  it('books a viewing from any open stage', () => {
    for (const s of ['new', 'contacted', 'engaged', 'dormant']) expect(nextStatus(s, 'booked')).toBe('viewing')
  })
  it('keeps won and lost final', () => {
    for (const ev of ['outbound', 'inbound', 'booked', 'dormant'] as const) {
      expect(nextStatus('won', ev)).toBe('won')
      expect(nextStatus('lost', ev)).toBe('lost')
    }
  })
  it('only lets early stages go dormant, and a reply or contact wakes them', () => {
    expect(nextStatus('engaged', 'dormant')).toBe('dormant')
    expect(nextStatus('viewing', 'dormant')).toBe('viewing')
    expect(nextStatus('dormant', 'inbound')).toBe('engaged')
    expect(nextStatus('dormant', 'outbound')).toBe('contacted')
  })
  it('treats an unknown or missing status as new', () => {
    expect(nextStatus(null, 'outbound')).toBe('contacted')
    expect(nextStatus('rubbish', 'inbound')).toBe('engaged')
    expect(statusLabel(undefined)).toBe('New')
  })
})

describe('toE164', () => {
  it.each([
    ['07745 203146', '+447745203146'],
    ['+44 7745 203146', '+447745203146'],
    ['0044 7745 203146', '+447745203146'],
    ['447745203146', '+447745203146'],
    ['020 8904 9005', '+442089049005'],
    ['(020) 8904-9005', '+442089049005'],
    ['+1 415 555 2671', '+14155552671'],
  ])('%s → %s', (raw, want) => expect(toE164(raw)).toBe(want))
  it.each(['', '   ', 'n/a', '12345', '+44 0 7745 203146', '07745 2031467777'])('rejects %j', (raw) => expect(toE164(raw)).toBeNull())
  it('knows UK mobiles', () => {
    expect(isUkMobile('+447745203146')).toBe(true)
    expect(isUkMobile('+442089049005')).toBe(false)
    expect(isUkMobile(null)).toBe(false)
  })
})

describe('parseAttribution', () => {
  it('reads a JSON string from the website', () => {
    const a = parseAttribution(JSON.stringify({ utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'spring-valuations', referrer: 'https://www.google.com/search?q=estate+agent+harrow', landing: '/valuation?utm_source=facebook' }))
    expect(a).toEqual({ utmSource: 'facebook', utmMedium: 'paid', utmCampaign: 'spring-valuations', referrer: 'https://www.google.com/search', landingPage: '/valuation' })
  })
  it('drops odd characters and long values, and copes with junk', () => {
    expect(parseAttribution({ utm_source: '<script>x</script>' }).utmSource).toBe('scriptx/script')
    expect(parseAttribution({ utm_campaign: 'a'.repeat(300) }).utmCampaign).toHaveLength(80)
    expect(parseAttribution('not json')).toEqual({ utmSource: null, utmMedium: null, utmCampaign: null, referrer: null, landingPage: null })
    expect(parseAttribution(null).landingPage).toBeNull()
  })
})

describe('consent', () => {
  it('counts only a real tick', () => {
    for (const v of [true, 'true', 'on', '1', 1]) expect(ticked(v)).toBe(true)
    for (const v of [false, 'false', '', null, undefined, 0, 'no']) expect(ticked(v)).toBe(false)
  })
  it('says how to stop in the wording we store', () => {
    expect(CONSENT_WORDING.email).toMatch(/unsubscribe/i)
    expect(CONSENT_WORDING.whatsapp).toMatch(/STOP/)
  })
  it('names every form', () => {
    for (const k of ['valuation-page', 'valuation-popup', 'home-valuation', 'property-enquiry', 'chat', 'tenant-register', 'buyer-calculator', 'rent-estimate', 'import']) expect(LEAD_MAGNETS[k]).toBeTruthy()
  })
})

describe('lead import', () => {
  it('takes a good lead and fills sensible defaults', () => {
    const r = parseImportLead({ name: ' Asha Patel ', phone: '07700 900123', source: 'Walk-in', kind: 'valuation', consent_email: 'yes' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lead).toMatchObject({ name: 'Asha Patel', phone: '07700 900123', email: null, source: 'walk_in', kind: 'valuation', intent: 'unsure', consentEmail: true, consentWhatsapp: false })
  })
  it('refuses leads it can’t use', () => {
    expect(parseImportLead({ phone: '07700 900123' })).toMatchObject({ ok: false })
    expect(parseImportLead({ name: 'A' })).toMatchObject({ ok: false })
    expect(parseImportLead({ name: 'A', email: 'not-an-email' })).toMatchObject({ ok: false })
    expect(parseImportLead({ name: 'A', phone: '123' })).toMatchObject({ ok: false })
    expect(parseImportLead({ name: 'A', email: 'a@b.co', source: 'rightmove' })).toMatchObject({ ok: false })
    expect(parseImportLead({ name: 'A', email: 'a@b.co', kind: 'party' })).toMatchObject({ ok: false })
    expect(parseImportLead([1])).toMatchObject({ ok: false })
  })
  it('accepts one lead, a list, or { leads }', () => {
    expect(leadsIn({ name: 'A' })).toHaveLength(1)
    expect(leadsIn([{}, {}])).toHaveLength(2)
    expect(leadsIn({ leads: [{}, {}, {}] })).toHaveLength(3)
    expect(leadsIn('x')).toBeNull()
  })
})
