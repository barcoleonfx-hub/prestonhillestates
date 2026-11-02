import type { Metadata } from 'next'
import localFont from 'next/font/local'
import '../globals.css'

const fraunces = localFont({
  src: [
    { path: '../fonts/fraunces-roman.woff2', style: 'normal', weight: '300 700' },
    { path: '../fonts/fraunces-italic.woff2', style: 'italic', weight: '300 700' },
  ],
  variable: '--font-serif',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Preston Hill Estates', template: '%s · Preston Hill Estates' },
  description: 'Independent estate agents on Preston Road since 2004. Sales, lettings and property management across Wembley and Harrow.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={fraunces.variable}>
      <body>{children}</body>
    </html>
  )
}
