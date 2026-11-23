import type { NextConfig } from 'next'

// The website's own address (PORTAL_URL, e.g. https://www.prestonhillestates.com). Public pages opened on the old
// onrender.com address are sent there for good, so Google sees one website, not two copies of it. The staff portal,
// the API and files (photos, fonts) still answer on both, so nothing already sent or printed stops working.
const site = (() => { try { return process.env.PORTAL_URL ? new URL(process.env.PORTAL_URL) : null } catch { return null } })()
const ONRENDER = 'prestonhill.onrender.com'

const nextConfig: NextConfig = {
  serverExternalPackages: ['@libsql/client'],
  async redirects() {
    if (!site || site.hostname === ONRENDER) return []
    const has = [{ type: 'host' as const, value: ONRENDER }]
    return [
      { source: '/', has, destination: `${site.origin}/`, permanent: true },
      // Every public page, but not the staff portal, the API, files (photos, fonts) or /properties on its own (Render's
      // health check opens it).
      { source: '/:first((?!(?:admin|api|_next|media|email-img|fonts|go|properties)(?:/|$))[^/]+)/:rest*', has, destination: `${site.origin}/:first/:rest*`, permanent: true },
      { source: '/properties/:rest+', has, destination: `${site.origin}/properties/:rest+`, permanent: true },
    ]
  },
  // The homepage and the rest of the site have separate root layouts, so unmatched URLs need their own 404 page.
  // Spreadsheet imports (e.g. a Rentman export) go through server actions, so allow more than the 1 MB default.
  experimental: { globalNotFound: true, serverActions: { bodySizeLimit: '20mb' } },
}

export default nextConfig
