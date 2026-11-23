import { gbp, type BookletComp, type BookletGuide } from '@/lib/booklet'
import { guidePoints, lrTypeOf, TYPE_PLURAL, typeWords, type OtmGuide } from '@/lib/otm-guide'

// The two pages made from the OnTheMarket Market Appraisal Guide: "Your home, in detail" (the official facts and
// what they mean for the sale) and "Our valuation" (the guide price, the like-for-like sales behind it, the street
// and the district). The price is always shown as a guide, to be confirmed when we've seen inside at the visit.

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const longDate = (iso: string | null) => { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTH[m - 1]} ${y}` }
const monthYear = (iso: string) => { const [y, m] = iso.split('-').map(Number); return `${MONTH[m - 1]} ${y}` }
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const inWords = (n: number) => WORDS[n] ?? String(n)
const priceText = (n: number, rent: boolean) => `${gbp(n)}${rent ? ' pcm' : ''}`

/** "37, Gordon Road, Harrow, HA3 5RY" → "37 Gordon Road". */
export function shortAddress(a: string | null): string | null {
  if (!a) return null
  const parts = a.split(',').map((x) => x.trim()).filter(Boolean)
  if (!parts.length) return null
  return /^\d+[a-z]?$/i.test(parts[0]) && parts[1] ? `${parts[0]} ${parts[1]}` : parts[0]
}
/** "37, Gordon Road, Harrow, HA3 5RY" → "Gordon Road". */
function streetName(a: string | null): string | null {
  if (!a) return null
  const parts = a.split(',').map((x) => x.trim())
  const s = /^\d+[a-z]?$/i.test(parts[0]) ? parts[1] : parts[0]?.replace(/^\d+[a-z]?\s+/i, '')
  return s || null
}

function Foot({ n }: { n: number }) {
  return <div className="bk-foot"><span>Preston Hill Estates</span><span>{n}</span></div>
}

const BANDS: [string, string, string][] = [['A', '#0c8a4a', '#fff'], ['B', '#1aae5c', '#fff'], ['C', '#8cc63f', '#fff'], ['D', '#f4cb1a', '#23211a'], ['E', '#f2a25c', '#fff'], ['F', '#ec7c2a', '#fff'], ['G', '#e3243b', '#fff']]

function Epc({ g, today, rent }: { g: OtmGuide; today: string; rent: boolean }) {
  const e = g.epc
  const expired = !!(e?.validUntil && e.validUntil < today)
  return (
    <>
      {e?.current ? (
        <div className="g-epc">
          {BANDS.map(([b, bg, fg], i) => (
            <div className="g-row" key={b}>
              <div className="g-bar" style={{ width: `${24 + i * 6}mm`, background: bg, color: fg }}>{b}</div>
              {e.potential?.band === b && e.potential.score !== e.current!.score ? <span className="g-tag">Potential {e.potential.score} · {b}</span> : null}
              {e.current!.band === b ? <span className="g-tag now">Now {e.current!.score} · {b}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {!e?.current ? (
        <div className="g-alert"><b>No energy certificate was found for this address.</b> A valid EPC is a legal requirement before {rent ? 'a tenancy can start' : 'your home can be marketed'}, so we’ll arrange one.</div>
      ) : expired ? (
        <div className="g-alert"><b>The certificate expired on {longDate(e.validUntil)}.</b> A valid EPC is a legal requirement before {rent ? 'a tenancy can start' : 'your home can be marketed'}, so we’ll arrange a new one.{e.potential && e.potential.score > e.current.score ? ` Its potential rating of ${e.potential.band} means there’s room to improve, and we’ll go through its recommendations with you.` : ''}</div>
      ) : (
        <p className="g-note">Valid until {longDate(e.validUntil) ?? 'the date on the certificate'}.{e.potential && e.potential.score > e.current.score ? ` It could reach ${e.potential.band} with the improvements the certificate suggests.` : ''}{rent && 'FG'.includes(e.current.band) ? ' Homes need at least an E to be let.' : ''}</p>
      )}
    </>
  )
}

export function DetailPage({ guide, today, rent, n }: { guide: BookletGuide; today: string; rent: boolean; n: number }) {
  const g = guide.data
  const addr = shortAddress(g.address) ?? (rent ? 'your property' : 'your home')
  const type = typeWords(g.type)
  const typeFirst = type ? (type === 'flat or maisonette' ? 'Flat' : type.split(' ')[0].replace(/^./, (c) => c.toUpperCase())) : null
  const typeRest = type ? (type === 'flat or maisonette' ? 'or maisonette' : type.split(' ').slice(1).join(' ') || 'home') : null
  const stats = [
    typeFirst ? { b: typeFirst, s: typeRest! } : null,
    g.beds != null ? { b: String(g.beds), s: g.beds === 1 ? 'bedroom' : 'bedrooms' } : null,
    g.baths != null ? { b: String(g.baths), s: g.baths === 1 ? 'bathroom' : 'bathrooms' } : null,
    g.sqft ? { b: g.sqft.toLocaleString('en-GB'), s: `sq ft${g.sqm ? ` · ${g.sqm} m²` : ''}` } : null,
    g.tenure ? { b: g.tenure, s: g.title ? `title ${g.title}` : 'tenure' } : null,
  ].filter((x): x is { b: string; s: string } => !!x)
  const fast = g.broadband.ultrafast ?? g.broadband.superfast ?? g.broadband.basic
  const fastWord = g.broadband.ultrafast ? 'Ultrafast' : g.broadband.superfast ? 'Superfast' : 'Basic'
  const low = (s: string | null) => !!s && /low/i.test(s)
  const rows: { k: string; v: string; small?: string; ok?: boolean; warn?: boolean }[] = [
    g.tenure ? { k: 'Tenure', v: g.tenure } : null,
    g.title ? { k: 'Land Registry title', v: g.title } : null,
    g.councilBand ? { k: 'Council tax', v: `Band ${g.councilBand}`, small: [g.councilTax ? `${gbp(g.councilTax)} a year` : null, g.authority ? `${g.authority} Council` : null].filter(Boolean).join(' · ') || undefined } : null,
    g.plotAcres ? { k: 'Plot', v: `${g.plotAcres} acres` } : null,
    g.flood ? { k: 'Flood risk', v: `${g.flood}${low(g.flood) ? ' ✓' : ''}`, ok: low(g.flood), warn: !low(g.flood) } : null,
    g.conservation != null ? { k: 'Conservation area', v: g.conservation ? 'Yes' : 'No ✓', small: g.conservation ? 'Some outside changes need permission' : undefined, ok: !g.conservation } : null,
    { k: 'Planning applications', v: g.planning.length ? `${g.planning.length} on record` : 'None on record', small: g.planning.slice(0, 2).join(' · ') || undefined },
    fast ? { k: 'Broadband', v: `${fastWord}, up to ${fast.toLocaleString('en-GB')} Mbps${fast >= 300 ? ' ✓' : ''}`, ok: fast >= 300, small: g.broadband.ultrafast && g.broadband.superfast ? `Superfast ${g.broadband.superfast} Mbps also available` : undefined } : null,
    g.outside ? { k: 'Outside space', v: g.outside } : null,
    g.parking ? { k: 'Parking', v: g.parking } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x).slice(0, 9)
  const points = guidePoints(g, today, rent)
  return (
    <section className="bk-page">
      <div className="bk-in bk-tight g">
        <div className="bk-kicker">{rent ? 'Your property, in detail' : 'Your home, in detail'}</div>
        <h2>The facts {rent ? 'tenants' : 'buyers'}<br /><em>will ask about.</em></h2>
        <p className="g-lede">{rent
          ? `Everything a tenant will want to know about ${addr}, and what has to be in place before a tenancy starts, checked against the official records.`
          : `Everything a buyer, their mortgage lender and their solicitor will want to know about ${addr}, checked against the official records before we put a price on it.`}</p>
        {stats.length ? (
          <div className="g-stats" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}>
            {stats.map((x) => <div key={x.s}><b>{x.b}</b><span>{x.s}</span></div>)}
          </div>
        ) : null}
        <div className="g-cols">
          <div>
            <h3 className="g-h">The paperwork</h3>
            <table className="g-kv"><tbody>
              {rows.map((r) => <tr key={r.k}><td>{r.k}</td><td className={r.ok ? 'ok' : r.warn ? 'no' : ''}>{r.v}{r.small ? <small>{r.small}</small> : null}</td></tr>)}
            </tbody></table>
          </div>
          <div>
            <h3 className="g-h">Energy performance</h3>
            <Epc g={g} today={today} rent={rent} />
          </div>
        </div>
        {points.length ? (
          <div className="g-means">
            <h3>What this means <em>for your {rent ? 'letting' : 'sale'}</em></h3>
            <ol>{points.map((p, i) => <li key={p.title} data-n={i + 1}><b>{p.title}</b> {p.text}</li>)}</ol>
          </div>
        ) : null}
        <p className="g-src">Sources: OnTheMarket Market Appraisal Guide (Sprift){g.made ? ` of ${longDate(g.made)}` : ''}, drawing on HM Land Registry, the EPC register, the Environment Agency, Ofcom and the Valuation Office Agency. Contains public sector information licensed under the Open Government Licence v3.0.</p>
      </div>
      <Foot n={n} />
    </section>
  )
}

const STEPS_SALE = [5000, 10000, 20000, 25000, 50000, 100000, 250000]
const STEPS_RENT = [25, 50, 100, 250, 500]

function Plot({ prices, asking, low, high, rent }: { prices: number[]; asking: number | null; low: number | null; high: number | null; rent: boolean }) {
  const all = [...prices, ...(asking ? [asking] : []), ...(low ? [low] : []), ...(high ? [high] : [])]
  if (prices.length < 2) return null
  const lo = Math.min(...all), hi = Math.max(...all)
  const step = (rent ? STEPS_RENT : STEPS_SALE).find((s) => (hi - lo) / s <= 6) ?? (rent ? 1000 : 500000)
  const min = Math.floor(lo / step) * step - (lo % step === 0 ? step : 0), max = Math.ceil(hi / step) * step + (hi % step === 0 ? step : 0)
  const at = (p: number) => `${(((p - min) / (max - min)) * 100).toFixed(1)}%`
  const ticks: number[] = []
  for (let t = min; t <= max; t += step) ticks.push(t)
  const label = (t: number) => (rent ? `£${t.toLocaleString('en-GB')}` : `£${Math.round(t / 1000)}k`)
  return (
    <div className="g-plot" aria-hidden="true">
      <div className="g-axis">
        <div className="g-line" />
        {low && high ? <div className="g-band" style={{ left: at(low), width: `${(((high - low) / (max - min)) * 100).toFixed(1)}%` }} /> : null}
        {prices.map((p, i) => <div key={i} className="g-dot" style={{ left: at(p) }} />)}
        {asking ? <div className="g-you" style={{ left: at(asking) }}><span>{rent ? 'Your property' : 'Your home'}: {priceText(asking, rent)}</span></div> : null}
      </div>
      <div className="g-ticks">{ticks.map((t) => <span key={t} style={{ left: at(t) }}>{label(t)}</span>)}</div>
    </div>
  )
}

export function ValuationPage({ guide, evidence, compsWhere, rent, n }: { guide: BookletGuide; evidence: BookletComp[]; compsWhere: string | null; rent: boolean; n: number }) {
  const g = guide.data
  const { asking, low, high } = guide
  const lr = lrTypeOf(g.type)
  const plural = lr ? TYPE_PLURAL[lr] : rent ? 'homes' : 'homes'
  const street = streetName(g.address)
  const district = g.postcode?.split(' ')[0] ?? null
  // The latest sale on the street of the same kind of home (or else any), for "On Gordon Road".
  const sameKind = g.street.filter((h) => h.sales.length && (!lr || lrTypeOf(h.type) === lr))
  const pick = (sameKind.length ? sameKind : g.street.filter((h) => h.sales.length))
    .map((h) => ({ h, s: h.sales[0] })).sort((a, b) => (a.s.date < b.s.date ? 1 : -1))[0]
  const salesOnRoad = g.street.reduce((t, h) => t + h.sales.length, 0)
  const growth = [
    { k: 'T', label: 'Terraced', v: g.growth.terraced },
    { k: 'S', label: 'Semi', v: g.growth.semi },
    { k: 'D', label: 'Detached', v: g.growth.detached },
    { k: 'F', label: 'Flats', v: g.growth.flat },
  ].filter((x) => x.v != null)
  const year = Number((g.made ?? '').slice(0, 4)) || new Date().getFullYear()
  const sold = (c: BookletComp) => /sold (.+)$/.exec(c.what)?.[1] ?? c.what
  const near = compsWhere?.replace(new RegExp(`^${plural}\\s+`), '') ?? 'nearby'
  const size = [g.sqft ? `size (${g.sqft.toLocaleString('en-GB')} sq ft)` : null, g.beds != null ? `${inWords(g.beds)} bedroom${g.beds === 1 ? '' : 's'}` : null].filter(Boolean)
  const basis = evidence.length
    ? <>Based on <b>{evidence.length} {evidence.length === 1 ? 'similar home' : plural} {rent ? 'let' : 'sold'} {near}{rent ? '' : ' in the last two years'}</b>{size.length ? <>, set against your {rent ? 'property' : 'home'}’s {size.join(' and its ')}</> : null}.</>
    : <>Based on your {rent ? 'property' : 'home'}’s official records{size.length ? <>, its {size.join(' and ')}</> : null}, and our knowledge of the streets around it.</>
  return (
    <section className="bk-page">
      <div className="bk-in bk-tight g g-tight">
        <div className="bk-kicker">{rent ? 'Our rental valuation' : 'Our valuation'}</div>
        <h2>{rent ? <>What your property<br /><em>should let for.</em></> : <>What your home<br /><em>is worth today.</em></>}</h2>
        <div className="g-hero">
          <div>
            <div className="g-k">{rent ? 'Our guide rent' : 'Our guide asking price'}</div>
            <div className="g-price">{asking ? priceText(asking, rent) : 'To follow'}</div>
            {low && high ? <div className="g-range">Expected to {rent ? 'let' : 'sell'} for <b>{priceText(low, rent)} – {priceText(high, rent)}</b></div> : null}
            <div className="g-final">Final {rent ? 'rent' : 'price'} confirmed at our visit</div>
          </div>
          <p>{basis} <b>This is a guide until we’ve been inside:</b> condition, the kitchen and bathroom, the garden and any improvements all count, so we’ll confirm the final figure at our visit.</p>
        </div>
        <Plot prices={evidence.map((c) => c.price)} asking={asking} low={low} high={high} rent={rent} />
        {evidence.length ? (
          <table className="g-comps"><thead><tr><th>{rent ? 'Rents nearby' : `${plural.replace(/^./, (c) => c.toUpperCase())} sold nearby`}</th><th>{rent ? '' : 'Sold'}</th><th className="p">{rent ? 'Rent' : 'Price'}</th></tr></thead><tbody>
            {evidence.map((c, i) => (
              <tr key={c.key}><td><span className="g-n">{i + 1}</span>{c.where}{c.metres != null ? <small> · {c.metres < 1000 ? `${c.metres} m away` : `${(c.metres / 1000).toFixed(1)} km away`}</small> : null}</td><td>{rent ? c.what : sold(c)}</td><td className="p">{priceText(c.price, c.rent)}</td></tr>
            ))}
          </tbody></table>
        ) : <p className="g-empty">We’ll bring the latest {rent ? 'lets' : 'sales'} of homes like yours to the visit.</p>}
        <div className="g-trio">
          {!rent && street ? (
            <div className="g-card">
              <h3 className="g-h">On {street}</h3>
              {pick ? (
                <p>The last {lr ? (typeWords(g.type) ?? 'home') : 'home'} sold on your road went for <b>{gbp(pick.s.price)} in {monthYear(pick.s.date)}</b>{salesOnRoad > 1 ? <>, one of {salesOnRoad} sales recorded on the road since 1995</> : null}. The recent sales above show where homes like yours sit today.</p>
              ) : <p>No sales are recorded on your road since 1995, which makes the sales nearby above all the more useful.</p>}
            </div>
          ) : null}
          {growth.length ? (
            <div className="g-card">
              <h3 className="g-h">{district ?? 'Your area'} over ten years</h3>
              <p>Average prices, {year - 10} to {year}:</p>
              <div className="g-grow">{growth.map((x) => <div key={x.k} className={x.k === lr || (lr === 'H' && x.k === 'S') ? 'on' : ''}><b>{x.v! >= 0 ? '+' : ''}{x.v!.toFixed(1)}%</b><span>{x.label}</span></div>)}</div>
            </div>
          ) : null}
        </div>
        <div className="g-how">
          {rent ? (
            <>
              <div><b>1 · Like for like</b><p>Homes with the same number of bedrooms, let nearby. What tenants pay, not what landlords hope for.</p></div>
              <div><b>2 · Your property, not an average</b><p>Its size, layout, furnishing and what we see on the day: kitchen, bathroom, outside space and condition.</p></div>
              <div><b>3 · Let quickly, to the right tenant</b><p>A rent that brings good applicants in the first week, with full referencing before anyone moves in.</p></div>
            </>
          ) : (
            <>
              <div><b>1 · Like for like</b><p>Only {plural}, sold nearby in the last two years. New builds and unusual sales are left out because they sell for different reasons.</p></div>
              <div><b>2 · Your home, not an average</b><p>Its size, bedrooms, {g.tenure ? `${g.tenure.toLowerCase()} title` : 'tenure'} and what we see at the visit: kitchen, bathroom, garden and condition.</p></div>
              <div><b>3 · Priced to sell well</b><p>An asking price that brings buyers in the first two weeks, when interest is highest, with room to negotiate.</p></div>
            </>
          )}
        </div>
        <p className="g-fine">This is our guide to the {rent ? 'rent your property could achieve' : 'price your home could achieve'} in today’s market, to help you decide how to {rent ? 'let' : 'sell'}; we confirm the final figure after our visit. It is not a RICS valuation, a survey or a mortgage valuation. {rent ? '' : 'Sold prices: HM Land Registry. Contains HM Land Registry data © Crown copyright and database right, licensed under the Open Government Licence v3.0. '}Street sales and ten-year averages: OnTheMarket Market Appraisal Guide (Sprift).</p>
      </div>
      <Foot n={n} />
    </section>
  )
}
