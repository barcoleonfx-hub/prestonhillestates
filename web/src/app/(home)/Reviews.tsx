import { connection } from 'next/server'
import { googleSummary, reviewsFor } from '@/lib/reviews-data'
import './reviews.css'

/**
 * Real reviews only (4 and 5 stars, chosen in the portal), always with the overall Google rating and a link to
 * every review. With fewer than three, shows them as large quotes rather than a thin row of cards.
 */
export type ReviewCategory = 'sales' | 'lettings' | 'any'

/** `site`: on the property pages, which have their own layout (always cards, in their page width). */
export async function Reviews({ category = 'any', title, site = false }: { category?: ReviewCategory; title?: React.ReactNode; site?: boolean }) {
  // Read when the page is visited (never baked in at build time), so new reviews show straight away.
  await connection()
  const [list, g] = await Promise.all([reviewsFor(category).catch(() => []), googleSummary().catch(() => ({ rating: null, count: null, url: null }))])
  if (!list.length) return null
  const summary = g.rating && g.count ? (
    <p className="rx-summary">
      <span className="rx-stars" aria-hidden="true">{'★'.repeat(Math.round(g.rating))}<span className="rx-star-off">{'★'.repeat(5 - Math.round(g.rating))}</span></span> <b>{g.rating.toFixed(1)}</b> out of 5 from <b>{g.count.toLocaleString('en-GB')}</b> Google reviews
      {g.url ? <> · <a href={g.url} target="_blank" rel="noopener noreferrer">Read them all on Google ↗</a></> : null}
    </p>
  ) : g.url ? <p className="rx-summary"><a href={g.url} target="_blank" rel="noopener noreferrer">Read all our reviews on Google ↗</a></p> : null

  if (list.length < 3 && !site) {
    return (
      <section className="quote" aria-label="Client reviews">
        <div className="wide">
          {list.map((r) => (
            <figure key={r.text} style={{ margin: 0 }}>
              <blockquote className="rv"><span className="mk">“</span>{r.text}<span className="mk">”</span></blockquote>
              <figcaption className="attr label rv d1">{r.name}{r.date ? ` · ${r.date}` : ''}{r.source === 'Google review' ? ' · Google review' : ''}</figcaption>
            </figure>
          ))}
          {summary}
        </div>
      </section>
    )
  }
  return (
    <section className={site ? 'rx rx-site' : 'rx'} aria-labelledby="rx-h">
      <div className={site ? 'wrap' : 'wide'}>
        <div className="rv">
          <div className="label"><b>Reviews</b>{g.rating ? ' · from Google' : ''}</div>
          <h2 className="sect" id="rx-h">{title ?? <>What our clients <em>say</em></>}</h2>
          {summary}
        </div>
        <div className="rx-cards">
          {list.map((r, i) => (
            <figure key={r.text} className={`rx-card rv${i ? ` d${Math.min(i, 3)}` : ''}`}>
              <div className="rx-top">
                <span className="rx-avatar" aria-hidden="true">{r.name[0]}</span>
                <span><b>{r.name}</b>{r.date ? <small>{r.date}</small> : null}</span>
              </div>
              {r.rating ? <div className="rx-stars" aria-label={`${r.rating} out of 5 stars`}>{'★★★★★'.slice(0, r.rating)}</div> : null}
              <blockquote>{r.text}</blockquote>
              <figcaption>{r.source}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
