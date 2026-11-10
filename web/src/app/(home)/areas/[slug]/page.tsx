import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AREAS, areaBySlug, districtOf } from '@/lib/areas'
import { recentSalesIn, marketFor } from '@/lib/local-intel'
import { displayAddressFor, listPublished, priceLabel, slugFor, statusLabel } from '@/lib/properties'
import { labelFor, PROPERTY_TYPES } from '@/lib/options'
import { LocalIntel, ValueBanner } from '@/components/LocalIntel'
import { SoldCredit, SoldList } from '@/components/SoldList'
import { PageChrome } from '../../PageChrome'
import '@/components/sold-prices.css'
import '../../valuation/valuation.css'
import '../areas.css'

export const dynamic = 'force-dynamic'

type Params = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const a = areaBySlug((await params).slug)
  if (!a) return { title: 'Area not found' }
  return {
    title: `${a.name} (${a.districts.join(', ')}): homes for sale, to rent and sold prices`,
    description: `Property in ${a.name}: homes for sale and to rent, what homes have actually sold for, and how the ${a.districts.join(' and ')} market is doing. From Preston Hill Estates, on Preston Road since 2004.`,
  }
}

const short = (n: number) => (n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(2).replace(/0$/, '')}m` : `£${Math.round(n / 1000)}k`)

export default async function AreaPage({ params }: { params: Params }) {
  const a = areaBySlug((await params).slug)
  if (!a) notFound()
  const [all, sales, market] = await Promise.all([
    listPublished({}).catch(() => []),
    recentSalesIn(a.districts, 8).catch(() => []),
    marketFor(a.districts).catch(() => null),
  ])
  const here = all.filter((p) => a.districts.includes(districtOf(p.postcode) ?? ''))
  const forSale = here.filter((p) => p.channel === 'sale').slice(0, 6)
  const toLet = here.filter((p) => p.channel === 'let').slice(0, 6)
  const others = AREAS.filter((x) => x.slug !== a.slug)

  const card = (p: (typeof here)[number]) => (
    <a key={p.id} className="prop" href={`/properties/${slugFor(p)}`}>
      <div className="visual">
        <span className={`pill${p.channel === 'let' ? ' let' : ''}`}>{p.channel === 'let' ? 'To let' : 'For sale'}</span>
        {p.status !== 'available' ? <span className="status">{statusLabel(p.status)}</span> : null}
        {p.cover ? <img className="photo" src={p.cover.url} alt="" loading="lazy" /> : null}
      </div>
      <div className="body">
        <div className="price">{priceLabel(p)}</div>
        <div className="addr">{displayAddressFor(p)}</div>
        <div className="meta">
          {p.bedrooms ? <span>{p.bedrooms} bed</span> : null}
          {p.propertyType ? <span>{labelFor(PROPERTY_TYPES, p.propertyType)}</span> : null}
        </div>
      </div>
    </a>
  )

  return (
    <PageChrome reviews="any">
      <main className="vx ar" id="top">
        <section className="wide ar-hero">
          <nav className="ar-crumbs" aria-label="Breadcrumb"><Link href="/areas">Areas we cover</Link><span>/</span><span>{a.name}</span></nav>
          <div className="label"><b>Area guide</b> · {a.districts.join(' · ')}</div>
          <h1 className="display gx-h1">Property in <em>{a.name}</em></h1>
          <p className="gx-lead">{a.covers}. What’s for sale and to rent, what homes have actually sold for, and how the market’s moving, from the independent agent on Preston Road since 2004.</p>
          {market?.median12 ? (
            <ul className="ar-facts">
              <li><b>{short(market.median12)}</b><span>typical price</span></li>
              <li><b>{market.sold12.toLocaleString('en-GB')}</b><span>homes sold in 12 months</span></li>
              {market.change != null ? <li><b>{market.change >= 0 ? '+' : '–'}{Math.abs(market.change).toFixed(1)}%</b><span>on the year before</span></li> : null}
            </ul>
          ) : null}
          <div className="ar-ctas">
            <a className="btn gold" href="/valuation">Book a free valuation</a>
            <a className="btn ghost" href={`/sold-prices?postcode=${a.districts[0]}`}>Sold prices in {a.districts[0]}</a>
          </div>
        </section>

        <LocalIntel districts={a.districts} place={a.name} title={`${a.name} at a glance`} />

        {forSale.length || toLet.length ? (
          <section className="wide ar-homes">
            {forSale.length ? (
              <>
                <div className="ar-head"><h2 className="sect">For sale in <em>{a.name}</em></h2><a href="/properties?channel=sale">All homes for sale →</a></div>
                <div className="cardgrid">{forSale.map(card)}</div>
              </>
            ) : null}
            {toLet.length ? (
              <>
                <div className="ar-head"><h2 className="sect">To rent in <em>{a.name}</em></h2><a href="/properties?channel=let">All homes to rent →</a></div>
                <div className="cardgrid">{toLet.map(card)}</div>
              </>
            ) : null}
          </section>
        ) : (
          <section className="wide ar-homes ar-empty">
            <h2 className="sect">Looking in <em>{a.name}?</em></h2>
            <p>Nothing of ours is on the market here this week. New homes often go to the people on our list first: <a href="/renting#register">register to rent</a>, or <a href="/properties">see everything we have</a>.</p>
          </section>
        )}

        {sales.length ? (
          <section className="wide ar-sold sp">
            <div className="ar-head"><h2 className="sect">Recently sold in <em>{a.name}</em></h2><a href={`/sold-prices?postcode=${a.districts[0]}`}>More sold prices →</a></div>
            <SoldList sales={sales} />
            <SoldCredit />
          </section>
        ) : null}

        <ValueBanner />

        <section className="wide ar-others">
          <h2 className="sect">Other areas we <em>cover</em></h2>
          <div className="ar-chips">{others.map((x) => <Link key={x.slug} href={`/areas/${x.slug}`}><b>{x.name}</b><span>{x.districts.join(' · ')}</span></Link>)}</div>
        </section>
      </main>
    </PageChrome>
  )
}
