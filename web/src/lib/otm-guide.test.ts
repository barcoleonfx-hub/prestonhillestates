import { describe, expect, it } from 'vitest'
import fixture from './otm-guide.fixture.json'
import { guideGaps, guidePoints, isGuide, lrTypeOf, parseGuide, suggestPrice, withoutOutliers, type GuideItem } from './otm-guide'

// Text and positions from a real Market Appraisal Guide, with the address and references changed.
const items = fixture as GuideItem[]

describe('parseGuide', () => {
  const g = parseGuide(items)
  it('knows a guide when it sees one', () => {
    expect(isGuide(items)).toBe(true)
    expect(isGuide([{ p: 1, x: 0, y: 0, s: 'Bank statement' }])).toBe(false)
  })
  it('reads the key facts', () => {
    expect(g.made).toBe('2026-11-23')
    expect(g.address).toBe('37, Sample Road, Harrow, HA3 9ZZ')
    expect(g.postcode).toBe('HA3 9ZZ')
    expect(g.uprn).toBe('100000000001')
    expect(g.sqft).toBe(936)
    expect(g.sqm).toBe(87)
    expect(g.plotAcres).toBe(0.05)
    expect(g.councilBand).toBe('D')
    expect(g.councilTax).toBe(2511)
    expect(g.title).toBe('MX000001')
    expect(g.tenure).toBe('Freehold')
    expect(g.authority).toBe('Harrow')
    expect(g.flood).toBe('Very low')
    expect(g.conservation).toBe(false)
    expect(g.planning).toEqual([])
    expect(g.type).toBe('Terraced House')
    expect(g.beds).toBe(3)
    expect(g.baths).toBe(1)
    expect(g.outside).toBeNull()
    expect(g.parking).toBeNull()
    expect(g.broadband).toEqual({ basic: 8, superfast: 80, ultrafast: 5000 })
    expect(guideGaps(g)).toEqual([])
  })
  it('reads the energy certificate, current and potential the right way round', () => {
    expect(g.epc).toEqual({ address: '37 SAMPLE ROAD, WEALDSTONE, HA3 9ZZ', validUntil: '2022-11-20', current: { score: 43, band: 'E' }, potential: { score: 80, band: 'C' } })
  })
  it('reads the sales on the street, each under its own home, in both columns', () => {
    const by = Object.fromEntries(g.street.map((h) => [h.address, h]))
    expect(by['47, Sample Road, Harrow, HA3 9ZZ']).toEqual({ address: '47, Sample Road, Harrow, HA3 9ZZ', type: 'Terraced House', sales: [{ date: '2019-09-30', price: 423000 }] })
    expect(by['1, Sample Road, Harrow, HA3 9ZZ'].sales).toHaveLength(4)
    expect(by['31, Sample Road, Harrow, HA3 9ZZ'].sales[0]).toEqual({ date: '2017-02-24', price: 450000 })
    expect(by['1a, Sample Road, Harrow, HA3 9ZZ'].sales).toHaveLength(3)
    expect(by['55, Sample Road, Harrow, HA3 9ZZ'].type).toBe('Semi-Detached House')
  })
  it('reads ten years of price growth', () => {
    expect(g.growth).toEqual({ flat: 46.42, terraced: 62.65, semi: 66.46, detached: 64.54 })
  })
  it('makes points for the owner', () => {
    const pts = guidePoints(g, '2026-11-23', false)
    expect(pts.map((p) => p.title)).toEqual(['A simpler sale.', 'A selling point worth leading with.', 'One thing to sort first.', 'No worries about flooding.'])
    expect(pts[2].text).toContain('new EPC')
  })
})

describe('pricing helpers', () => {
  it('maps the guide’s type to Land Registry’s', () => {
    expect(lrTypeOf('Terraced House')).toBe('T')
    expect(lrTypeOf('End of Terrace House')).toBe('T')
    expect(lrTypeOf('Semi-Detached House')).toBe('S')
    expect(lrTypeOf('Detached House')).toBe('D')
    expect(lrTypeOf('Flat-Maisonette House')).toBe('F')
    expect(lrTypeOf('Bungalow')).toBe('H')
    expect(lrTypeOf(null)).toBeNull()
  })
  it('suggests a price from the middle of the sales', () => {
    expect(suggestPrice([457500, 470000, 530000, 490000, 428500, 470000], false)).toEqual({ asking: 470000, low: 450000, high: 485000 })
    expect(suggestPrice([1, 2], false)).toBeNull()
    expect(suggestPrice([1800, 1900, 2000], true)).toEqual({ asking: 1900, low: 1825, high: 1950 })
  })
  it('drops sales far from the rest', () => {
    expect(withoutOutliers([{ price: 185000 }, { price: 457500 }, { price: 470000 }, { price: 490000 }]).map((x) => x.price)).toEqual([457500, 470000, 490000])
  })
})
