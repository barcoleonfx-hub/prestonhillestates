import type { AreaStats, PublicSale } from '@/lib/sold-prices'

// Recent sold prices from HM Land Registry, shown on the valuation page, property pages and the sold prices page.

export const LR_CREDIT_TEXT = 'Contains HM Land Registry data © Crown copyright and database right. Licensed under the Open Government Licence v3.0.'
export const money = (n: number | null | undefined) => (n == null ? '–' : `£${n.toLocaleString('en-GB')}`)
const month = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

export function SoldStats({ stats, note }: { stats: AreaStats; note?: string }) {
  return (
    <div className="sp-stats">
      <div className="sp-big"><b>{stats.count12.toLocaleString()}</b><span>homes sold in {stats.label} in the last 12 months</span></div>
      <div className="sp-big"><b>{money(stats.median12)}</b><span>typical price{note ? ` ${note}` : ''}</span></div>
      {stats.byType.length ? (
        <ul className="sp-types">{stats.byType.map((t) => <li key={t.type}><span>{t.label}</span><b>{money(t.median)}</b><small>{t.count} sold</small></li>)}</ul>
      ) : null}
    </div>
  )
}

export function SoldList({ sales, highlight }: { sales: PublicSale[]; highlight?: string | null }) {
  if (!sales.length) return null
  return (
    <ul className="sp-list">
      {sales.map((s, i) => (
        <li key={`${s.postcode}-${s.soldOn}-${s.price}-${i}`} className={highlight && s.street === highlight ? 'same' : undefined}>
          <div className="sp-where"><b>{s.street ?? s.postcode}</b><span>{s.postcode} · {s.typeLabel}{s.tenure === 'L' ? ', leasehold' : s.tenure === 'F' ? ', freehold' : ''}{s.newBuild ? ', new build' : ''}</span></div>
          <div className="sp-price"><b>{money(s.price)}</b><span>{month(s.soldOn)}</span></div>
        </li>
      ))}
    </ul>
  )
}

export function SoldCredit() {
  return <p className="sp-credit">Sold prices from HM Land Registry, which publishes sales about 1 to 2 months after they complete. House numbers are left out. {LR_CREDIT_TEXT}</p>
}
