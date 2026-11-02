import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'Page not found · Preston Hill Estates', robots: { index: false } }

export default function GlobalNotFound() {
  return (
    <html lang="en-GB">
      <body style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#FBFAF6' }}>
        <main style={{ textAlign: 'center', maxWidth: 460 }}>
          <p style={{ letterSpacing: '0.18em', textTransform: 'uppercase', fontSize: '0.72rem', fontWeight: 700, color: '#A47B1D' }}>Page not found</p>
          <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: '2.2rem', margin: '12px 0' }}>We couldn’t find that page.</h1>
          <p style={{ color: '#59554A' }}>It may have moved, or the property may have sold. Try our homepage or the latest homes.</p>
          <p style={{ marginTop: 22, display: 'flex', gap: 10, justifyContent: 'center' }}>
            <a className="btn btn-gold" href="/">Homepage</a>
            <a className="btn btn-ghost" href="/properties">Properties</a>
          </p>
        </main>
      </body>
    </html>
  )
}
