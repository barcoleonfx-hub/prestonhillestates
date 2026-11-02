import type { Metadata } from 'next'
import './home.css'

// The homepage has its own root layout so its hand-tuned design never mixes with the portal's styles.
export const metadata: Metadata = {
  title: 'Preston Hill Estates · Independent estate agents in Harrow since 2004',
  description: 'Independent estate agents at 271 Preston Road since 2004. Sales, lettings and property management across Harrow, Kenton and Wembley. Book a free valuation.',
  openGraph: {
    title: 'Preston Hill Estates',
    description: 'A trusted part of the community since 2004. Sales, lettings and management across Harrow, Kenton and Wembley.',
    locale: 'en_GB',
    type: 'website',
  },
}

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  )
}
