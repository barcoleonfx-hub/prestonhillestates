import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { siteStats, type Range } from '@/lib/site-stats'
import { AutoRefresh } from '../AutoRefresh'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Website stats' }

const RANGES: [Range, string][] = [['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days']]
const n = (x: number) => x.toLocaleString('en-GB')
const dayLabel = (d: string, long = false) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' })

/** Who's on the website now, how many visit each day, what they look at, where they come from, and what came of it. */
export default async function WebsiteStatsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireAdmin()
  const sp = await searchParams
  const range: Range = sp.range === 'today' || sp.range === '7' ? sp.range : '30'
  const s = await siteStats(range)
  const r = s.range
  const max = Math.max(1, ...s.daily.map((d) => d.visitors))
  const rangeName = RANGES.find(([k]) => k === range)![1].toLowerCase()
  const table = (rows: [string, number][], unit: string, total: number) => rows.length ? (
    <ul className="ws-list">{rows.map(([k, v]) => (
      <li key={k}><span className="ws-name">{k}</span><span className="ws-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (v / Math.max(1, rows[0][1])) * 100)}%` }} /></span><b>{n(v)}</b><small>{total ? `${Math.round((v / total) * 100)}%` : ''}</small></li>
    ))}</ul>
  ) : <p className="ws-empty">No {unit} yet.</p>
  const srcTotal = r.sources.reduce((a, [, v]) => a + v, 0), devTotal = r.devices.reduce((a, [, v]) => a + v, 0)
  return (
    <>
      <AutoRefresh seconds={30} />
      <div className="page-head">
        <div>
          <h1>Website stats</h1>
          <p className="sub">Visitors to www.prestonhillestates.com, updating every 30 seconds. Each phone or computer counts once a day; staff signed in to the portal, search engine robots and link previews aren’t counted. No cookies are used and nothing that identifies anyone is kept.</p>
        </div>
      </div>

      <section className="ws-tiles">
        <div className="ws-tile ws-live">
          <span className="ws-k"><i className="ws-dot" aria-hidden="true" />On the site now</span>
          <b>{n(s.live.count)}</b>
          <small>{s.live.count ? s.live.pages.slice(0, 3).map(([p, c]) => `${p}${c > 1 ? ` (${c})` : ''}`).join(' · ') : 'Nobody in the last 5 minutes'}</small>
        </div>
        {([['Today', s.tiles.today], ['Yesterday', s.tiles.yesterday], ['Last 7 days', s.tiles.week], ['Last 30 days', s.tiles.month]] as const).map(([k, v]) => (
          <div key={k} className="ws-tile"><span className="ws-k">{k}</span><b>{n(v.visitors)}</b><small>{v.visitors === 1 ? 'visitor' : 'visitors'} · {n(v.views)} {v.views === 1 ? 'page' : 'pages'} viewed</small></div>
        ))}
      </section>

      <section className="card card-pad ws-chart-card">
        <div className="ws-chart-head"><h2>Visitors each day</h2><span className="ws-k">Last 30 days · most {n(max)}</span></div>
        <div className="ws-chart" role="img" aria-label={`Visitors each day for the last 30 days. Most in a day: ${max}.`}>
          {s.daily.map((d) => (
            <div key={d.day} className="ws-col" tabIndex={0} aria-label={`${dayLabel(d.day, true)}: ${d.visitors} visitors, ${d.views} pages`}>
              <i style={{ height: `${(d.visitors / max) * 100}%` }} />
              <span className="ws-tip"><b>{dayLabel(d.day, true)}</b>{n(d.visitors)} {d.visitors === 1 ? 'visitor' : 'visitors'} · {n(d.views)} pages</span>
            </div>
          ))}
        </div>
        <div className="ws-axis">{s.daily.map((d, i) => <span key={d.day}>{(i % 7 === 0 && i <= 21) || i === 29 ? dayLabel(d.day) : ''}</span>)}</div>
        <details className="ws-table"><summary>See as a table</summary>
          <table><thead><tr><th>Day</th><th>Visitors</th><th>Pages viewed</th></tr></thead><tbody>{[...s.daily].reverse().map((d) => <tr key={d.day}><td>{dayLabel(d.day, true)}</td><td>{n(d.visitors)}</td><td>{n(d.views)}</td></tr>)}</tbody></table>
        </details>
      </section>

      <nav className="ws-range" aria-label="Period">{RANGES.map(([k, l]) => <Link key={k} href={`/admin/website-stats?range=${k}`} className={k === range ? 'on' : undefined}>{l}</Link>)}</nav>

      <section className="card card-pad ws-results">
        <h2>What came of it, {rangeName}</h2>
        {s.countingFrom ? <p className="ws-note" style={{ margin: '-4px 0 12px' }}>Visitors have been counted since {new Date(s.countingFrom).toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}, so these are the leads since then.</p> : null}
        <div className="ws-res">
          <div><b>{n(r.leads.valuation)}</b><span>Valuation requests</span></div>
          <div><b>{n(r.leads.viewing)}</b><span>Viewing requests and enquiries</span></div>
          <div><b>{n(r.leads.registrations)}</b><span>Buyer and tenant sign-ups</span></div>
          <div><b>{n(r.leads.whatsapp)}</b><span>WhatsApp taps</span></div>
        </div>
        <p className="ws-note">{r.visitors ? (r.leads.total ? `${n(r.visitors)} visitors and ${n(r.leads.total)} leads: ${r.visitors >= r.leads.total ? `about one lead for every ${n(Math.round(r.visitors / r.leads.total))} visitors.` : 'more leads than visitors counted (some come from people who visited earlier).'}` : `${n(r.visitors)} visitors, no leads yet.`) : 'No visitors yet in this period.'}</p>
      </section>

      <div className="ws-grid">
        <section className="card card-pad"><h2>Most viewed pages</h2>{table(r.pages, 'pages viewed', r.views)}</section>
        <section className="card card-pad"><h2>Where visitors came from</h2>{table(r.sources, 'visits', srcTotal)}<p className="ws-note">“Direct” is someone typing the address, a bookmark, or an app (like WhatsApp) that doesn’t say where the link was.</p></section>
        <section className="card card-pad">
          <h2>Most viewed properties</h2>
          {r.homes.length ? <ul className="ws-homes">{r.homes.map((h) => (
            <li key={h.ref}>{h.id ? <Link href={`/admin/properties/${h.id}`}><b>{h.address}</b></Link> : <b>{h.address}</b>}<small>{[h.price, h.ref].filter(Boolean).join(' · ')}</small><span><b>{n(h.views)}</b> {h.views === 1 ? 'view' : 'views'} · {n(h.people)} {h.people === 1 ? 'person' : 'people'}</span></li>
          ))}</ul> : <p className="ws-empty">No property pages viewed yet.</p>}
        </section>
        <section className="card card-pad"><h2>Phones and computers</h2>{table(r.devices, 'visitors', devTotal)}</section>
      </div>
      {s.counting ? null : <p className="ws-note" style={{ marginTop: 14 }}>Counting starts now: visits before today weren’t recorded.</p>}
    </>
  )
}
