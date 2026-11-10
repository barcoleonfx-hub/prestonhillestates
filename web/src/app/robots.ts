import type { MetadataRoute } from 'next'
import { portalUrl } from '@/lib/mailer'

export const dynamic = 'force-dynamic'

/** Everything public is open to search engines; the staff portal and private report links are not. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/report/', '/api/'] }], sitemap: portalUrl('/sitemap.xml') }
}
