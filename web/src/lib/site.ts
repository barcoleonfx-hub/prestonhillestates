/** The branch's pages on the property portals. Logos go in public/portals/<key>.svg or .png. */
export const PORTALS = [
  {
    key: 'zoopla',
    name: 'Zoopla',
    url: 'https://www.zoopla.co.uk/find-agents/branch/preston-hill-estates-harrow-middlesex-24845/',
  },
  {
    key: 'onthemarket',
    name: 'OnTheMarket',
    url: 'https://www.onthemarket.com/agents/branch/preston-hill-estates-harrow/',
  },
] as const

/**
 * Redress, client-money and deposit schemes. Logos go in public/accreditations/<key>.svg or .png.
 * `cert` is our current certificate (public/certificates): clicking a scheme's logo downloads it.
 * Swap the PDF when a scheme sends a renewal; keep the file name, or update it here and in concept/homepage_src.html.
 */
export const ACCREDITATIONS = [
  { key: 'tpo', name: 'The Property Ombudsman', url: 'https://www.tpos.co.uk/', cert: '/certificates/property-ombudsman-certificate-D04905.pdf' },
  { key: 'safeagent', name: 'safeagent', url: 'https://www.safeagents.co.uk/', cert: '/certificates/safeagent-certificate-A4118.pdf' },
  { key: 'prs', name: 'Property Redress Scheme', url: 'https://www.theprs.co.uk/', cert: '/certificates/property-redress-scheme-certificate-PRS041838.pdf' },
  { key: 'mydeposits', name: 'myDeposits', url: 'https://www.mydeposits.co.uk/', cert: '/certificates/mydeposits-certificate.pdf' },
] as const

/**
 * Our lettings service and its fee. The law (Consumer Rights Act 2015) requires the fee to be shown including VAT.
 * `vat: 'plus'` means the percentage is before VAT; set it to 'inc' if the quoted figure already includes VAT.
 */
export const LETTINGS = {
  name: 'Fully managed',
  percent: 6,
  vat: 'plus' as 'plus' | 'inc',
  includes: [
    ['Full management', 'We look after the property and the tenancy from the day the tenant moves in: rent collected, tenants’ questions answered, the paperwork kept right.'],
    ['Maintenance covered', 'Tenants report repairs to us. We arrange the work with trusted local tradespeople and see it through, so you don’t get the 10pm phone call.'],
    ['Tenant referencing', 'Every tenant is referenced before they move in: identity, Right to Rent, income, previous landlords and credit.'],
    ['Rent guarantee', 'Your rent is guaranteed, so a tenant falling behind doesn’t leave you out of pocket.'],
    ['Deposit protected', 'Tenants’ deposits are registered with myDeposits, a government-approved scheme.'],
    ['Your money protected', 'Rent we hold for you is covered by client money protection through safeagent.'],
  ] as [string, string][],
}
export const feeIncVat = () => (LETTINGS.vat === 'plus' ? Math.round(LETTINGS.percent * 1.2 * 100) / 100 : LETTINGS.percent)
/** "6% + VAT (7.2% including VAT) of the monthly rent" */
export const feeText = () => (LETTINGS.vat === 'plus' ? `${LETTINGS.percent}% + VAT (${feeIncVat()}% including VAT) of the monthly rent` : `${LETTINGS.percent}% of the monthly rent, including VAT`)
