import { REVIEWS } from '@/lib/reviews'

/** Real reviews only. With fewer than three, shows them as large quotes rather than a thin row of cards. */
export function Reviews() {
  if (REVIEWS.length < 3) {
    return (
      <section className="quote" aria-label="Client reviews">
        <div className="wide">
          {REVIEWS.map((r) => (
            <figure key={r.text} style={{ margin: 0 }}>
              <blockquote className="rv"><span className="mk">“</span>{r.text}<span className="mk">”</span></blockquote>
              <figcaption className="attr label rv d1">{r.name}{r.date ? ` · ${r.date}` : ''}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    )
  }
  return (
    <section className="rx" aria-labelledby="rx-h">
      <div className="wide">
        <div className="rv"><div className="label"><b>Reviews</b></div><h2 className="sect" id="rx-h">What our clients <em>say</em></h2></div>
        <div className="rx-cards">
          {REVIEWS.map((r, i) => (
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
