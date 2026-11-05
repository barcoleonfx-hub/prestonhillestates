import { desc } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { reviews } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { googleSummary } from '@/lib/reviews-data'
import { saveGoogleSummary, updateReview } from '../../review-actions'
import { AddReview } from './AddReview'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reviews' }

const CAT: Record<string, string> = { general: 'Sales and lettings', sales: 'Sales', lettings: 'Lettings' }

export default async function ReviewsPage() {
  await requireAdmin()
  await ready()
  const [rows, g] = await Promise.all([db.select().from(reviews).orderBy(desc(reviews.reviewedOn), desc(reviews.createdAt)), googleSummary()])
  const live = rows.filter((r) => r.shown && r.rating >= 4)
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reviews</h1>
          <p className="sub">Your Google reviews for the website. Copy them in word for word; only 4 and 5 star reviews are shown, on the valuation page (sales) and the Landlords and Renting pages (lettings), always next to your overall Google rating and a link to all of them.</p>
        </div>
      </div>

      <section className="card card-pad" style={{ marginBottom: 18 }}>
        <h2>Your Google rating</h2>
        <p className="card-sub">From your Google Business Profile. Shown above the reviews, so visitors can see the full picture.</p>
        <form action={saveGoogleSummary} className="rv-grid" style={{ marginTop: 12 }}>
          <label className="field"><span>Average rating</span><input className="input" name="rating" inputMode="decimal" defaultValue={g.rating ?? ''} placeholder="e.g. 4.8" /></label>
          <label className="field"><span>Number of reviews</span><input className="input" name="count" inputMode="numeric" defaultValue={g.count ?? ''} placeholder="e.g. 112" /></label>
          <label className="field wide"><span>Link to your reviews on Google</span><input className="input" name="url" defaultValue={g.url ?? ''} placeholder="https://g.page/r/… or your Google Maps link" /></label>
          <div className="actions"><button className="btn btn-dark btn-sm" type="submit">Save</button></div>
        </form>
      </section>

      <section className="card card-pad" style={{ marginBottom: 18 }}>
        <h2>Add a review</h2>
        <p className="card-sub">Open your Google Business Profile, copy a review and paste it here exactly as written. Reviews of 3 stars or fewer can be kept here for your records but are never shown.</p>
        <AddReview />
      </section>

      <section className="card">
        <div className="card-pad" style={{ paddingBottom: 0 }}><h2>{rows.length} reviews · {live.length} on the website</h2></div>
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Review</th><th>Stars</th><th>Shown on</th><th>On the website</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.author}</b>{r.reviewedOn ? <span className="addr-sub"> · {new Date(`${r.reviewedOn}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span> : null}<div className="addr-sub" style={{ maxWidth: 560 }}>{r.text.length > 220 ? `${r.text.slice(0, 220)}…` : r.text}</div></td>
                  <td className="addr-sub" style={{ whiteSpace: 'nowrap', color: '#B7791F' }}>{'★'.repeat(r.rating)}<span style={{ color: '#D9D5C6' }}>{'★'.repeat(5 - r.rating)}</span></td>
                  <td>
                    <form action={updateReview} style={{ display: 'flex', gap: 6 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <select className="select" name="category" defaultValue={r.category}>{Object.entries(CAT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                      <button className="btn btn-ghost btn-sm" type="submit">Save</button>
                    </form>
                  </td>
                  <td>
                    {r.rating < 4 ? <span className="addr-sub">Not shown (under 4 stars)</span> : (
                      <form action={updateReview}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="shown" value={r.shown ? '0' : '1'} /><button className="btn btn-ghost btn-sm" type="submit">{r.shown ? 'Showing: hide' : 'Hidden: show'}</button></form>
                    )}
                  </td>
                  <td><form action={updateReview}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="delete" value="1" /><button className="btn btn-danger btn-sm" type="submit">Delete</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length ? <p className="card-sub" style={{ padding: '6px 20px 20px' }}>No reviews yet. Until you add some, the website shows the one review from your previous website.</p> : null}
      </section>
    </>
  )
}
