import { Reviews } from '@/app/(home)/Reviews'
import { ChatPrompt } from '@/components/ChatPrompt'
import Link from 'next/link'
import type { Metadata } from 'next'
import { PROPERTY_TYPES } from '@/lib/options'
import { displayAddressFor, headlineFor, listPublished, priceLabel, slugFor, statusLabel } from '@/lib/properties'

export const dynamic = 'force-dynamic'

type SP = Promise<Record<string, string | string[] | undefined>>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || ''

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const channel = one((await searchParams).channel)
  return { title: channel === 'let' ? 'Property to rent' : channel === 'sale' ? 'Property for sale' : 'Property search' }
}

export default async function PropertySearch({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams
  const channel = one(sp.channel) === 'let' ? 'let' : one(sp.channel) === 'sale' ? 'sale' : ''
  const q = one(sp.q)
  const minBeds = Number(one(sp.beds)) || undefined
  const maxPrice = Number(one(sp.max)) || undefined
  const type = one(sp.type)
  const sort = one(sp.sort)
  const furnishing = channel === 'let' ? one(sp.furn) : ''
  const availableNow = channel === 'let' && one(sp.now) === '1'
  const rows = await listPublished({ channel, q, minBeds, maxPrice, type, sort, furnishing, availableNow })

  const priceSteps = channel === 'let' ? [1000, 1500, 2000, 2500, 3000, 4000] : [300000, 400000, 500000, 600000, 750000, 1000000, 1500000]

  return (
    <div className="wrap">
      <section className="search-hero">
        <div className="label" style={{ color: 'var(--gold-deep)' }}>Wembley · Harrow · Kenton · Preston Road</div>
        <h1 style={{ marginTop: 12 }}>
          {channel === 'let' ? <>Homes <em>to rent</em></> : channel === 'sale' ? <>Homes <em>for sale</em></> : <>Find your next <em>home</em></>}
        </h1>
        <form className={`searchbar2${channel === 'let' ? ' lets' : ''}`} method="get">
          <div className="seg-wrap field">
            <span className="flabel" style={{ fontSize: '0.66rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--faint)', fontWeight: 700 }}>Looking to</span>
            <div className="seg" role="radiogroup" aria-label="Buy or rent">
              {[['', 'Any'], ['sale', 'Buy'], ['let', 'Rent']].map(([v, l]) => (
                <label key={v}><input type="radio" name="channel" value={v} defaultChecked={channel === v} /><span>{l}</span></label>
              ))}
            </div>
          </div>
          <div className="field"><label htmlFor="q">Location</label><input className="input" id="q" name="q" defaultValue={q} placeholder="Street, area or postcode" /></div>
          <div className="field">
            <label htmlFor="type">Type</label>
            <select className="select" id="type" name="type" defaultValue={type}>
              <option value="">Any type</option>
              {PROPERTY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="beds">Bedrooms</label>
            <select className="select" id="beds" name="beds" defaultValue={minBeds ? String(minBeds) : ''}>
              <option value="">Any</option>
              {[1, 2, 3, 4, 5].map((b) => <option key={b} value={b}>{b}+</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="max">Max price</label>
            <select className="select" id="max" name="max" defaultValue={maxPrice ? String(maxPrice) : ''}>
              <option value="">No max</option>
              {priceSteps.map((p) => <option key={p} value={p}>£{p.toLocaleString('en-GB')}{channel === 'let' ? ' pcm' : ''}</option>)}
            </select>
          </div>
          {channel === 'let' ? (
            <div className="field">
              <label htmlFor="furn">Furnished</label>
              <select className="select" id="furn" name="furn" defaultValue={furnishing}>
                <option value="">Either</option><option value="furnished">Furnished</option><option value="unfurnished">Unfurnished</option>
              </select>
            </div>
          ) : null}
          {channel === 'let' ? <label className="now-check"><input type="checkbox" name="now" value="1" defaultChecked={availableNow} /> Available now</label> : null}
          <button className="btn btn-gold go" type="submit" style={{ height: 42 }}>Search</button>
        </form>
        {channel === 'let' ? (
          <a className="borrow-banner" href="/renting#register">
            <span className="bb-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
            </span>
            <span className="bb-text">
              <b>Good homes go in days.</b>
              <span>Tell us what you’re looking for and we’ll email you new homes to rent that fit, often before they reach the portals.</span>
            </span>
            <span className="btn btn-gold bb-btn">Get new homes by email</span>
          </a>
        ) : null}
        {channel !== 'let' ? (
          <a className="borrow-banner" href="/mortgage-calculator">
            <span className="bb-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h2M12 18h4" /></svg>
            </span>
            <span className="bb-text">
              <b>Not sure of your budget?</b>
              <span>See how much you could borrow, what you could afford and the monthly repayments. It takes a minute.</span>
            </span>
            <span className="btn btn-gold bb-btn">See how much you could borrow</span>
          </a>
        ) : null}
      </section>

      <div className="results-meta">
        <span>{rows.length} {rows.length === 1 ? 'property' : 'properties'}</span>
        <span style={{ display: 'flex', gap: 14 }}>
          {[['', 'Recommended'], ['price_asc', 'Lowest price'], ['price_desc', 'Highest price']].map(([v, l]) => {
            const params = new URLSearchParams()
            for (const [k, val] of Object.entries({ channel, q, beds: minBeds ?? '', max: maxPrice ?? '', type, furn: furnishing, now: availableNow ? '1' : '', sort: v })) if (val) params.set(k, String(val))
            return <Link key={v} href={`/properties?${params}`} style={{ textDecoration: sort === v ? 'underline' : 'none', color: sort === v ? 'var(--ink)' : 'var(--faint)' }}>{l}</Link>
          })}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="none">
          <p className="serif" style={{ fontSize: '1.4rem', color: 'var(--ink)' }}>Nothing matches right now.</p>
          <p style={{ marginTop: 8 }}>Try widening your search, or call the branch on 020 8904 9005. New homes often come in before they reach the portals.{channel === 'let' ? <> <a href="/renting#register">Register and we’ll email you the next one that fits.</a></> : null}</p>
        </div>
      ) : (
        <div className="pgrid">
          {rows.map((p) => (
            <Link key={p.id} href={`/properties/${slugFor(p)}`} className="pcard">
              <div className="img">
                {p.cover ? <img src={p.cover.url} alt={p.cover.caption || displayAddressFor(p)} loading="lazy" /> : null}
                {p.status !== 'available' ? <span className="tag state">{statusLabel(p.status)}</span> : <span className="tag">{p.channel === 'let' ? 'To let' : 'For sale'}</span>}
              </div>
              <div className="body">
                <div className="price">{priceLabel(p)}{p.channel === 'let' && p.price && (p.rentFrequency ?? 'pcm') === 'pcm' ? <small className="pw"> · £{Math.round((p.price * 12) / 52).toLocaleString('en-GB')} pw</small> : null}</div>
                <div className="addr">{displayAddressFor(p)}</div>
                <div className="head">{headlineFor(p)}</div>
                <div className="facts">
                  {p.bedrooms != null ? <span>{p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} bed`}</span> : null}
                  {p.bathrooms != null ? <span>{p.bathrooms} bath</span> : null}
                  {p.receptions != null ? <span>{p.receptions} rec</span> : null}
                  {p.channel === 'let' && p.furnishing && p.furnishing !== 'flexible' ? <span>{p.furnishing === 'part_furnished' ? 'Part furnished' : p.furnishing === 'furnished' ? 'Furnished' : 'Unfurnished'}</span> : null}
                  {p.channel === 'let' && p.availableFrom ? <span>{p.availableFrom <= new Date().toISOString().slice(0, 10) ? 'Available now' : `From ${new Date(p.availableFrom).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}</span> : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <Reviews site category={channel === 'let' ? 'lettings' : channel === 'sale' ? 'sales' : 'any'} />
      <ChatPrompt />
    </div>
  )
}
