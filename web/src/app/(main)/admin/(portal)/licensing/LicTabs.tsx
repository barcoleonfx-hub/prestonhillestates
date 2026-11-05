import Link from 'next/link'

/** Licensing (where each property stands) and All properties (the full list from Rentman). */
export function LicTabs({ on, tracked, all }: { on: 'licensing' | 'properties'; tracked?: number; all?: number }) {
  return (
    <nav className="lic-tabs" aria-label="Licensing sections">
      <Link href="/admin/licensing" className={on === 'licensing' ? 'on' : undefined} aria-current={on === 'licensing' ? 'page' : undefined}>Selective licensing{tracked != null ? <b>{tracked}</b> : null}</Link>
      <Link href="/admin/licensing/properties" className={on === 'properties' ? 'on' : undefined} aria-current={on === 'properties' ? 'page' : undefined}>All properties{all != null ? <b>{all}</b> : null}</Link>
    </nav>
  )
}
