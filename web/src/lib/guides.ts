// Guides for homeowners and landlords. Plain, general advice in the branch's own words.
// Add a guide by adding an entry here; it appears on /guides, the valuation page and the footer.

export type Guide = {
  slug: string
  title: string
  summary: string
  date: string // YYYY-MM-DD
  art: 'fc-semi' | 'fc-terrace' | 'fc-block'
  sections: { heading: string; paragraphs?: string[]; points?: string[] }[]
}

export const GUIDES: Guide[] = [
  {
    slug: 'prepare-your-home-for-a-valuation',
    title: 'How to prepare your home for a valuation',
    summary: 'Small, inexpensive things that help a valuer see your home at its best, and the paperwork worth having to hand.',
    date: '2026-11-03',
    art: 'fc-semi',
    sections: [
      {
        heading: 'You don’t need to redecorate',
        paragraphs: [
          'A good valuer looks past furniture and paint colours to the things that drive price: location, space, layout, condition and outside space. There is no need to spend money before a valuation. A tidy, well-lit home simply makes it easier to see what you have.',
        ],
      },
      {
        heading: 'Quick wins on the day',
        points: [
          'Clear surfaces and open curtains and blinds so rooms look as large and bright as they are.',
          'Fix the small things you have been meaning to: a dripping tap, a loose handle, a blown bulb.',
          'Make sure the valuer can get into every room, the loft if it is converted, and the garden or garage.',
          'Tidy the front: bins away, path clear. First impressions count with buyers, so they count with valuers too.',
        ],
      },
      {
        heading: 'Paperwork that helps',
        points: [
          'Details and dates of any extensions, loft conversions or major works, with planning permission or building regulations sign-off if you have them.',
          'Guarantees and certificates, for example for windows, a new boiler, damp proofing or electrical work.',
          'For flats and maisonettes: the remaining lease length, ground rent and service charge.',
          'Your Energy Performance Certificate if you have one. If not, we can explain how to get one.',
        ],
      },
      {
        heading: 'Be open about any issues',
        paragraphs: [
          'If you know about a problem, such as a leaking roof, a boundary dispute or a short lease, tell us at the valuation. It will come out during a sale, and knowing early means we can price and plan for it rather than lose a buyer later.',
        ],
      },
    ],
  },
  {
    slug: 'selling-or-letting',
    title: 'Selling or letting: how to decide',
    summary: 'Thinking of letting instead of selling? The questions to ask yourself, and what being a landlord involves.',
    date: '2026-11-03',
    art: 'fc-block',
    sections: [
      {
        heading: 'Start with what you need the money for',
        paragraphs: [
          'If you need the equity to buy your next home, selling is usually the simpler route. If you can move without it, letting can give you a monthly income while you keep the property, but it is a long-term commitment and comes with responsibilities.',
        ],
      },
      {
        heading: 'Questions to ask yourself',
        points: [
          'Does my mortgage allow letting? You may need your lender’s consent or a buy-to-let mortgage.',
          'Would the rent cover the mortgage, insurance, maintenance and any agency fees, with something left over?',
          'Am I happy to deal with repairs and tenants, or would I want the property fully managed?',
          'How long do I want to keep it? Selling later means prices could have moved either way.',
          'Have I spoken to an accountant about tax on rental income, and on any gain when I eventually sell?',
        ],
      },
      {
        heading: 'What landlords must do',
        paragraphs: ['Letting a home in England comes with legal duties. Among the main ones:'],
        points: [
          'A gas safety check every year, and an electrical safety inspection at least every five years.',
          'A valid Energy Performance Certificate that meets the minimum rating for letting.',
          'Smoke alarms on every storey and carbon monoxide alarms where required.',
          'Protecting the tenant’s deposit in a government-approved scheme and giving them the prescribed information.',
          'Right to Rent checks on adult occupiers.',
        ],
      },
      {
        heading: 'Rental law is changing',
        paragraphs: [
          'The rules for renting in England are being reformed. Rather than rely on an article that may date, ask us at your valuation and we will explain what currently applies to your situation.',
        ],
      },
      {
        heading: 'Get both figures',
        paragraphs: [
          'Not sure yet? Ask for both. We can give you a sale price and a realistic monthly rent at the same visit, so you can compare like for like.',
        ],
      },
    ],
  },
  {
    slug: 'what-affects-property-prices-in-harrow',
    title: 'What affects property prices in Harrow and North West London',
    summary: 'Transport, schools, space and the details buyers pay for across Harrow, Kenton, Wembley and the streets around them.',
    date: '2026-11-03',
    art: 'fc-terrace',
    sections: [
      {
        heading: 'Getting into London',
        paragraphs: [
          'Distance to a station is one of the biggest factors locally. Our area is well served: the Metropolitan line at Preston Road, Harrow-on-the-Hill and Pinner, the Jubilee line at Wembley Park, Kingsbury and Stanmore, and the Bakerloo line and Overground at Kenton. Homes within a short walk of a station tend to attract more buyers and tenants.',
        ],
      },
      {
        heading: 'Schools',
        paragraphs: [
          'Families pay attention to school catchments, and homes near popular schools can sell faster. Catchments change, so buyers check them carefully, and so do we when we value.',
        ],
      },
      {
        heading: 'Space and layout',
        points: [
          'The number of bedrooms matters, but so does how the space works: a kitchen that opens onto the garden, a downstairs WC, a usable third bedroom.',
          'Extensions and loft conversions add value when they are well done and properly signed off.',
          'Outside space and off-street parking are valued highly, particularly for houses.',
        ],
      },
      {
        heading: 'Condition and the details',
        points: [
          'A home that needs work sells for less, but buyers often overestimate the cost of updating. Pricing it correctly matters more than finishing every job.',
          'For flats, the length of the lease and the level of the service charge can make a significant difference.',
          'Energy efficiency is increasingly on buyers’ and tenants’ minds.',
        ],
      },
      {
        heading: 'Your street, not the average',
        paragraphs: [
          'Two similar homes a few streets apart can be worth noticeably different amounts. That is why we value in person, using what has actually sold and let nearby rather than an area average.',
        ],
      },
    ],
  },
]

export const guideBySlug = (slug: string) => GUIDES.find((g) => g.slug === slug)
export const guideDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
