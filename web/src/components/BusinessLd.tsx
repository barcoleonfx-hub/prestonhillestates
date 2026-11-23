import { AREAS } from '@/lib/areas'

/**
 * Who we are, in the form search engines read (schema.org RealEstateAgent): name, address, phone, opening hours and
 * the areas we cover. It helps Google show the right details for searches like "estate agents Preston Road".
 */
export function BusinessLd({ base }: { base: string }) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateAgent',
    '@id': `${base}/#agency`,
    name: 'Preston Hill Estates',
    url: `${base}/`,
    logo: `${base}/apple-icon.png`,
    image: `${base}/apple-icon.png`,
    telephone: '+44 20 8904 9005',
    email: 'info@prestonhillestates.com',
    foundingDate: '2004',
    address: { '@type': 'PostalAddress', streetAddress: '271 Preston Road', addressLocality: 'Harrow', postalCode: 'HA3 0PS', addressCountry: 'GB' },
    openingHoursSpecification: [
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '17:30' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Saturday', opens: '10:00', closes: '13:00' },
    ],
    areaServed: AREAS.map((a) => ({ '@type': 'Place', name: a.name })),
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
}
