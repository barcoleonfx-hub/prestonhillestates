import { DEMAND_MIN, demandFor, marketFor, type Demand, type Market } from '@/lib/local-intel'
import { LR_CREDIT } from '@/lib/sold-prices'
import { DISTRICT_NAMES } from '@/lib/areas'
import './local-intel.css'

// "HA3 at a glance" and the "Has your home gone up in value?" banner. Self-contained styles, as they appear on
// pages in both of the site's designs (property pages, sold prices, area pages).

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
const short = (n: number) => (n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(2).replace(/0$/, '')}m` : `£${Math.round(n / 1000)}k`)
const COLOURS: Record<string, string> = { studio: '#E6CF95', '1': '#C4972F', '2': '#8C6A1C', '3': '#23211A', any: '#CFC8B4' }

function Ring({ demand }: { demand: Demand }) {
  const r = 70, c = 2 * Math.PI * r, gap = demand.groups.length > 1 ? 4 : 0
  let at = 0
  return (
    <svg viewBox="0 0 180 180" className="li-ring" aria-hidden="true">
      <circle cx="90" cy="90" r={r} fill="none" stroke="#F1ECDD" strokeWidth="16" />
      {demand.groups.map((g) => {
        const len = (g.count / demand.total) * c
        const el = <circle key={g.key} cx="90" cy="90" r={r} fill="none" stroke={COLOURS[g.key]} strokeWidth="16"
          strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-at} transform="rotate(-90 90 90)" />
        at += len
        return el
      })}
    </svg>
  )
}

function DemandCard({ demand, place, rent }: { demand: Demand; place: string; rent: boolean }) {
  return (
    <article className="li-card">
      <h3>People looking to {rent ? 'rent' : 'buy'} in {place} through us</h3>
      <div className="li-ringwrap">
        <Ring demand={demand} />
        <div className="li-ringmid"><span>{rent ? 'Tenants' : 'Buyers'}</span><b>{demand.total.toLocaleString('en-GB')}</b></div>
      </div>
      <ul className="li-legend">
        {demand.groups.map((g) => <li key={g.key}><i style={{ background: COLOURS[g.key] }} /><span>{g.label}</span><b>{g.count}</b></li>)}
      </ul>
      <p className="li-foot">Everyone who’s been in touch with us in the last {demand.months} months, counted once, by the size of home they asked about.</p>
    </article>
  )
}

function MarketCard({ market, place }: { market: Market; place: string }) {
  const top = Math.max(...market.byType.map((t) => t.median ?? 0), 1)
  return (
    <article className="li-card">
      <h3>How is the market doing in {place}?</h3>
      <div className="li-big">
        <span>Typical price</span>
        <b>{market.median12 ? gbp(market.median12) : '–'}</b>
        {market.change != null ? (
          <em className={market.change >= 0 ? 'up' : 'down'}>{market.change >= 0 ? '▲' : '▼'} {Math.abs(market.change).toFixed(1)}% on the year before</em>
        ) : null}
        <small>{market.sold12.toLocaleString('en-GB')} homes sold in the last 12 months</small>
      </div>
      {market.byType.length ? (
        <ul className="li-bars">
          {market.byType.map((t) => (
            <li key={t.type}>
              <span>{t.label}</span>
              <span className="li-bar"><i style={{ width: `${Math.max(8, ((t.median ?? 0) / top) * 100)}%` }} /></span>
              <b>{t.median ? short(t.median) : '–'}</b>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="li-foot">Typical (median) prices from HM Land Registry. Sales appear a month or two after completion.</p>
    </article>
  )
}

function ValuationCard({ rent }: { rent: boolean }) {
  return (
    <article className="li-card li-val">
      <h3>{rent ? 'What would your property let for?' : 'What’s your home worth now?'}</h3>
      <img src="/img/founder.jpg" alt="" className="li-face" />
      <p className="li-who"><b>Jamil Ahmed</b><span>Founder, Preston Hill Estates</span></p>
      <p className="li-pitch">{rent ? 'A free, honest rental valuation, from the people who’d find and look after your tenants.' : 'A free, honest valuation from someone who’s sold homes here since 2004.'}</p>
      <a className="li-btn" href={rent ? '/valuation?intent=letting' : '/valuation'}>{rent ? 'Get a rental valuation' : 'Get a valuation'}</a>
    </article>
  )
}

/** "HA3 at a glance": people looking (when enough have been in touch), the market, and a valuation. */
export async function LocalIntel({ districts, place, rent = false, title, boxed = false }: { districts: string[]; place: string; rent?: boolean; title?: string; boxed?: boolean }) {
  const [market, demand] = await Promise.all([marketFor(districts).catch(() => null), demandFor(districts, rent).catch(() => null)])
  const showDemand = !!demand && demand.total >= DEMAND_MIN
  if (!market && !showDemand) return null
  return (
    <section className={`li${boxed ? ' boxed' : ''}`} aria-labelledby={`li-${districts.join('-')}`}>
      <div className="li-inner">
        <p className="li-label">Local insight</p>
        <h2 id={`li-${districts.join('-')}`}>{title ?? `${place} at a glance`}</h2>
        <p className="li-sub">What’s happening in the {districts.map((d) => (DISTRICT_NAMES[d] ? `${d} (${DISTRICT_NAMES[d]})` : d)).join(' and ')} property market{rent ? ', and who’s looking to rent' : ''}, from the agent on Preston Road since 2004.</p>
        <div className={`li-cards n${1 + (market ? 1 : 0) + (showDemand ? 1 : 0)}`}>
          {showDemand ? <DemandCard demand={demand!} place={place} rent={rent} /> : null}
          {market ? <MarketCard market={market} place={place} /> : null}
          <ValuationCard rent={rent} />
        </div>
        {market ? <p className="li-credit">{LR_CREDIT}</p> : null}
      </div>
    </section>
  )
}

/** The full-width "Has your home gone up in value?" band. */
export function ValueBanner({ rent = false, boxed = false }: { rent?: boolean; boxed?: boolean }) {
  return (
    <section className={`li-banner${boxed ? ' boxed' : ''}`}>
      <div className="li-inner">
        <h2>{rent ? <>Own a home to let? Find out what it <em>could earn.</em></> : <>Has your home gone up in <em>value?</em></>}</h2>
        <p>Call <a href="tel:+442089049005">020 8904 9005</a> to find out what {rent ? 'rent your property could achieve' : 'your home is worth today'}. It’s free, with no obligation.</p>
        <a className="li-btn" href={rent ? '/valuation?intent=letting' : '/valuation'}>Book a free valuation</a>
      </div>
    </section>
  )
}
