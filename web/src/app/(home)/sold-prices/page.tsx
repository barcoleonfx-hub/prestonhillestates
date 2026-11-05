import type { Metadata } from 'next'
import Link from 'next/link'
import { PageChrome } from '../PageChrome'
import { SoldCredit, SoldList, SoldStats, money } from '@/components/SoldList'
import { PATCH, patchSummary, salesNear } from '@/lib/sold-prices'
import '@/components/sold-prices.css'
import './sold.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Sold house prices in Harrow, Kenton and Wembley',
  description: 'What homes near you have actually sold for: recent sold prices by postcode from HM Land Registry, from Preston Hill Estates on Preston Road.',
}

const POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/
const OUTWARD = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/

export default async function SoldPricesPage({ searchParams }: { searchParams: Promise<{ postcode?: string; type?: string }> }) {
  const sp = await searchParams
  const raw = (sp.postcode ?? '').toUpperCase().trim().replace(/\s+/g, ' ').slice(0, 10)
  const type = sp.type === 'F' || sp.type === 'H' ? sp.type : null
  // A full postcode, or just a district like "HA3" (searched as its first sector-less form).
  const valid = POSTCODE.test(raw) || OUTWARD.test(raw)
  const near = valid ? await salesNear(OUTWARD.test(raw) ? `${raw} 0AA` : raw, { type, limit: 20, district: OUTWARD.test(raw) }).catch(() => null) : null
  const summary = await patchSummary().catch(() => null)
  const href = (t: string) => `/sold-prices?postcode=${encodeURIComponent(raw)}${t ? `&type=${t}` : ''}`

  return (
    <PageChrome reviews="sales">
      <main className="spg" id="top">
        <section className="spg-hero">
          <div className="wide">
            <div className="label"><b>Sold prices</b> · Harrow &amp; North West London</div>
            <h1 className="display">What homes near you <em>actually sold for.</em></h1>
            <p className="sub">Real sale prices from HM Land Registry, for every street we cover. Type a postcode to see recent sales around it.</p>
            <form className="spg-search" action="/sold-prices">
              <label className="sr-only" htmlFor="spg-pc">Postcode</label>
              <input id="spg-pc" name="postcode" defaultValue={raw} placeholder="Postcode, e.g. HA3 0PS" autoComplete="postal-code" />
              <button type="submit" className="btn gold">Show sold prices</button>
            </form>
            {summary?.count ? (
              <div className="spg-patch">
                {summary.byArea.map((a) => (
                  <Link key={a.outward} href={`/sold-prices?postcode=${a.outward}`} className={raw.startsWith(a.outward + ' ') || raw === a.outward ? 'on' : undefined}>
                    <b>{a.outward}</b><span>{money(a.median)}</span><small>{a.count} sold</small>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section className="wide spg-body sp">
          {raw && !valid ? <p className="spg-note">That doesn’t look like a postcode. Try the full postcode, like HA3 0PS, or a district like HA3.</p> : null}
          {valid && !near?.covered ? <p className="spg-note">We don’t have sold prices for {raw}. We cover HA0 to HA9 and NW2, NW4, NW7, NW9 and NW10.</p> : null}
          {near?.covered ? (
            <div className="spg-grid">
              <div>
                <div className="spg-head">
                  <h2>Recent sales {OUTWARD.test(raw) ? `in ${near.area}` : near.scope === 'radius' ? `${near.where} of ${near.postcode}` : `near ${near.postcode}`}</h2>
                  <div className="spg-seg">
                    <Link className={!type ? 'on' : undefined} href={href('')}>All homes</Link>
                    <Link className={type === 'H' ? 'on' : undefined} href={href('H')}>Houses</Link>
                    <Link className={type === 'F' ? 'on' : undefined} href={href('F')}>Flats</Link>
                  </div>
                </div>
                <SoldList sales={near.recent} />
                <SoldCredit />
              </div>
              <aside>
                <SoldStats stats={near.stats} note={near.where} />
                <div className="spg-cta">
                  <h3>Where would yours sit?</h3>
                  <p>Sold prices give you the range; condition, extensions and the exact street decide where in it your home falls. We’ll tell you, free and in person.</p>
                  <a className="btn gold" href={`/valuation?postcode=${encodeURIComponent(POSTCODE.test(raw) ? raw : '')}`}>Book a free valuation</a>
                </div>
              </aside>
            </div>
          ) : null}
          {!raw && summary?.count ? (
            <div className="spg-start">
              <h2>{summary.count.toLocaleString()} homes sold across {PATCH.join(', ')} in the last 12 months</h2>
              <p className="spg-note">Typical price {money(summary.median)}. Choose an area above, or type your postcode.</p>
              <SoldCredit />
            </div>
          ) : null}
        </section>
      </main>
    </PageChrome>
  )
}
