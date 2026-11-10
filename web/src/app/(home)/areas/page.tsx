import type { Metadata } from 'next'
import Link from 'next/link'
import { AREAS } from '@/lib/areas'
import { marketFor } from '@/lib/local-intel'
import { ValueBanner } from '@/components/LocalIntel'
import { PageChrome } from '../PageChrome'
import '../valuation/valuation.css'
import './areas.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Areas we cover: Harrow, Kenton, Wembley, Pinner, Stanmore, Edgware and Kingsbury',
  description: 'Homes for sale and to rent, sold prices and how the market is doing in each area we cover, from Preston Hill Estates on Preston Road since 2004.',
}

const short = (n: number) => (n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(2).replace(/0$/, '')}m` : `£${Math.round(n / 1000)}k`)

export default async function AreasPage() {
  const markets = await Promise.all(AREAS.map((a) => marketFor(a.districts).catch(() => null)))
  return (
    <PageChrome reviews="any">
      <main className="vx ar" id="top">
        <section className="wide ar-hero">
          <div className="label"><b>Areas we cover</b></div>
          <h1 className="display gx-h1">Our patch, <em>street by street</em></h1>
          <p className="gx-lead">We’ve been on Preston Road since 2004. Choose an area for what’s for sale and to rent, what homes have actually sold for, and how the market’s doing.</p>
        </section>
        <section className="wide ar-grid">
          {AREAS.map((a, i) => {
            const m = markets[i]
            return (
              <Link key={a.slug} href={`/areas/${a.slug}`} className="ar-card">
                <span className="ar-pc">{a.districts.join(' · ')}</span>
                <b>{a.name}</b>
                <span className="ar-covers">{a.covers}</span>
                {m?.median12 ? <span className="ar-stat">Typical price <strong>{short(m.median12)}</strong> · {m.sold12.toLocaleString('en-GB')} sold in 12 months</span> : null}
                <span className="ar-go">See {a.name} →</span>
              </Link>
            )
          })}
        </section>
        <ValueBanner />
      </main>
    </PageChrome>
  )
}
