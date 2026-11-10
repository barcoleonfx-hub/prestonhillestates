import type { MetadataRoute } from 'next'
import { AREAS } from '@/lib/areas'
import { portalUrl } from '@/lib/mailer'
import { listPublished, slugFor } from '@/lib/properties'

export const dynamic = 'force-dynamic'

/** The public pages, the area pages and every live listing, for search engines. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = ['/', '/properties?channel=sale', '/properties?channel=let', '/valuation', '/landlords', '/renting', '/sold-prices', '/mortgage-calculator', '/fees', '/areas']
  const listings = await listPublished({}).catch(() => [])
  return [
    ...pages.map((p) => ({ url: portalUrl(p), changeFrequency: 'weekly' as const, priority: p === '/' ? 1 : 0.8 })),
    ...AREAS.map((a) => ({ url: portalUrl(`/areas/${a.slug}`), changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...listings.map((p) => ({ url: portalUrl(`/properties/${slugFor(p)}`), lastModified: p.updatedAt ?? undefined, changeFrequency: 'daily' as const, priority: 0.6 })),
  ]
}
