import { desc, ne } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { properties, windowCards } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { displayAddressFor, priceLabel } from '@/lib/properties'
import { labelFor, STATUSES } from '@/lib/options'
import { scanStats } from '@/lib/qr-links'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Window display sheets' }

/** Pick a property, get a shop window display sheet for it. */
export default async function WindowCardsPage() {
  await requireAdmin()
  await ready()
  const [rows, cards] = await Promise.all([
    db.select().from(properties).where(ne(properties.status, 'withdrawn')).orderBy(desc(properties.published), desc(properties.updatedAt)).limit(300),
    db.select({ id: windowCards.propertyId, at: windowCards.updatedAt }).from(windowCards),
  ])
  const made = new Map(cards.map((c) => [c.id, c.at]))
  const bf = await scanStats('landlord-500').catch(() => null)
  const group = (ch: 'sale' | 'let') => rows.filter((p) => p.channel === ch)
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Window display sheets</h1>
          <p className="sub">Choose a property: the sheet fills itself in from the listing (photos, price, headline, key details and highlights). Adjust anything you like, then download it as a PDF or print it on A4.</p>
        </div>
      </div>
      <section className="card fu-list" style={{ marginBottom: 18 }}>
        <div className="fu-head"><h2>Posters</h2></div>
        <div className="fu-row">
          <span className="fu-main"><b>Black Friday: £500 for introducing a landlord</b><small>Until 31 December 2026 · a QR code that opens WhatsApp to the office with the details we need{bf ? ` · scanned ${bf.scans} ${bf.scans === 1 ? 'time' : 'times'} in the last 30 days${bf.today ? `, ${bf.today} today` : ''}` : ''}</small></span>
          <span className="fu-acts"><a className="btn btn-gold btn-sm" href="/admin/posters/black-friday">Open the poster</a></span>
        </div>
      </section>
      {(['sale', 'let'] as const).map((ch) => group(ch).length ? (
        <section key={ch} className="card fu-list" style={{ marginBottom: 18 }}>
          <div className="fu-head"><h2>{ch === 'sale' ? 'For sale' : 'To let'} <span>{group(ch).length}</span></h2></div>
          {group(ch).map((p) => (
            <div key={p.id} className="fu-row">
              <span className="fu-main"><b>{displayAddressFor(p) || 'Untitled'}</b><small>{priceLabel(p)} · {p.ref} · {labelFor(STATUSES, p.status)}{p.published ? '' : ' · not on the website yet'}{made.has(p.id) ? ' · sheet adjusted' : ''}</small></span>
              <span className="fu-acts"><a className="btn btn-gold btn-sm" href={`/admin/window/${p.id}`}>{made.has(p.id) ? 'Open the sheet' : 'Make a sheet'}</a></span>
            </div>
          ))}
        </section>
      ) : null)}
      {!rows.length ? <p className="card card-pad">Add a property first.</p> : null}
    </>
  )
}
