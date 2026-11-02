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

/** Redress, client-money and deposit schemes. Logos go in public/accreditations/<key>.svg or .png. */
export const ACCREDITATIONS = [
  { key: 'tpo', name: 'The Property Ombudsman', url: 'https://www.tpos.co.uk/' },
  { key: 'safeagent', name: 'safeagent', url: 'https://www.safeagents.co.uk/' },
  { key: 'prs', name: 'Property Redress Scheme', url: 'https://www.theprs.co.uk/' },
  { key: 'mydeposits', name: 'myDeposits', url: 'https://www.mydeposits.co.uk/' },
] as const
