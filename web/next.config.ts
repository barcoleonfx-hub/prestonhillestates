import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['@libsql/client'],
  // The homepage and the rest of the site have separate root layouts, so unmatched URLs need their own 404 page.
  experimental: { globalNotFound: true },
}

export default nextConfig
