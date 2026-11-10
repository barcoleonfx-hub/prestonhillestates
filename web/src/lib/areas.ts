// The areas we cover, each with its own page (/areas/kenton etc.) and the postcode districts it's measured by.
// Pure: no server imports, so pages and components can share it.

export type Area = { slug: string; name: string; districts: string[]; covers: string }

export const AREAS: Area[] = [
  { slug: 'harrow', name: 'Harrow', districts: ['HA1', 'HA2'], covers: 'Harrow town centre, Harrow on the Hill, South Harrow and North Harrow' },
  { slug: 'kenton', name: 'Kenton', districts: ['HA3'], covers: 'Kenton and the streets around Preston Road' },
  { slug: 'wealdstone', name: 'Wealdstone', districts: ['HA3'], covers: 'Wealdstone, Harrow Weald and Belmont' },
  { slug: 'wembley', name: 'Wembley', districts: ['HA9', 'HA0'], covers: 'Wembley Park, Wembley Central, Sudbury and Alperton' },
  { slug: 'pinner', name: 'Pinner', districts: ['HA5'], covers: 'Pinner, Hatch End and Eastcote' },
  { slug: 'stanmore', name: 'Stanmore', districts: ['HA7'], covers: 'Stanmore' },
  { slug: 'edgware', name: 'Edgware', districts: ['HA8'], covers: 'Edgware, Burnt Oak, Canons Park and Queensbury' },
  { slug: 'kingsbury', name: 'Kingsbury', districts: ['NW9'], covers: 'Kingsbury, Colindale and The Hyde' },
]

/** What each postcode district is usually called, for "HA3 at a glance" headings. */
export const DISTRICT_NAMES: Record<string, string> = {
  HA0: 'Wembley & Alperton', HA1: 'Harrow', HA2: 'South & North Harrow', HA3: 'Kenton & Harrow Weald', HA5: 'Pinner',
  HA7: 'Stanmore', HA8: 'Edgware', HA9: 'Wembley', NW9: 'Kingsbury & Colindale',
}

export const areaBySlug = (slug: string) => AREAS.find((a) => a.slug === slug.toLowerCase()) ?? null
/** The area page for a postcode district (the first area measured by it). */
export const areaForDistrict = (d: string) => AREAS.find((a) => a.districts.includes(d.toUpperCase())) ?? null
export const districtOf = (postcode: string | null | undefined) => (postcode ?? '').trim().toUpperCase().split(/\s+/)[0] || null
