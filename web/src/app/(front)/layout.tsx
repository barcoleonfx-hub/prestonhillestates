import type { Metadata, Viewport } from 'next'
import { VisitTracker } from '@/components/LeadCapture'
import { PageViews } from '@/components/PageViews'

// The homepage, built with the design-taste kit (public/taste: its system, motion, layout and moments), in its own
// root layout so the kit's styles never mix with the other pages' designs.
export const metadata: Metadata = {
  title: 'Preston Hill Estates: estate agents on Preston Road, Harrow',
  description: 'Independent estate agents at 271 Preston Road since 2004. Sales, lettings and property management across Harrow, Kenton, Wembley and Kingsbury. Book a free valuation.',
  openGraph: {
    title: 'Preston Hill Estates: estate agents on Preston Road',
    description: 'Sales, lettings and management from one branch in Harrow since 2004.',
    locale: 'en_GB',
    type: 'website',
    images: ['/img/wembley-night.jpg'],
  },
  twitter: { card: 'summary_large_image' },
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#fbf8ee' }

const ROOT = `
:root {
  --p-bg: #fbf8ee; --p-surface: #f3eddc; --p-ink: #23211a; --p-muted: #6b6658;
  --p-accent: #8a6516; --p-accent-ink: #fbf8ee; --p-action: #8a6516; --p-action-ink: #fbf8ee;
  --p-inv-bg: #23211a; --p-inv-surface: #302d26; --p-inv-ink: #fbf8ee; --p-inv-muted: #a19f96;
  --p-inv-accent: #8a6516; --p-inv-accent-ink: #fbf8ee; --p-inv-action: #8a6516; --p-inv-action-ink: #fbf8ee;
  --font-display: "Fraunces", Georgia, serif;
  --font-text: "Figtree", system-ui, sans-serif;
  --display-weight: 400;
  --display-tracking: -0.02em;
  --display-tracking-xl: -0.028em;
  --display-axes: 'SOFT' 30, 'WONK' 0;
}`

export default function FrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning data-type="service" data-radius="soft" data-buttons="solid" data-motion="">
      <head>
        <meta name="site-kind" content="other" />
        <meta name="page-type" content="service" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,400..700,0..100,0..1&family=Figtree:wght@400..600&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/taste/system.css" />
        <link rel="stylesheet" href="/taste/ui/cards.css" />
        <link rel="stylesheet" href="/taste/motion/motion.css" />
        <link rel="stylesheet" href="/taste/layout/layout.css" />
        <style dangerouslySetInnerHTML={{ __html: ROOT }} />
        <link rel="stylesheet" href="/taste/front.css" />
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('m-enter');setTimeout(()=>document.documentElement.classList.add('m-enter-done'),700);document.documentElement.classList.add('mo-js');setTimeout(()=>document.documentElement.classList.add('mo-safe'),2500)" }} />
        <link rel="modulepreload" href="/taste/moments/moments.js" />
        <link rel="modulepreload" href="/taste/moments/lib.js" />
        <link rel="modulepreload" href="/taste/moments/picture-develops/moment.js" />
      </head>
      <body suppressHydrationWarning>
        {children}
        <VisitTracker />
        <PageViews />
        <script type="module" src="/taste/system.js" />
        <script type="module" src="/taste/motion/motion.js" />
        <script type="module" src="/taste/layout/layout.js" />
      </body>
    </html>
  )
}
