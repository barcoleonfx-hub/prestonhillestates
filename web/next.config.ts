import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['@libsql/client'],
  // The homepage and the rest of the site have separate root layouts, so unmatched URLs need their own 404 page.
  // Spreadsheet imports (e.g. a Rentman export) go through server actions, so allow more than the 1 MB default.
  experimental: { globalNotFound: true, serverActions: { bodySizeLimit: '20mb' } },
}

export default nextConfig
