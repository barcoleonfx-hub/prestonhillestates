import { GUIDES, guideDate, type Guide } from '@/lib/guides'

export function GuideCards({ guides = GUIDES }: { guides?: Guide[] }) {
  return (
    <div className="gx-cards">
      {guides.map((g, i) => (
        <a key={g.slug} className={`gx-card rv${i ? ` d${Math.min(i, 3)}` : ''}`} href={`/guides/${g.slug}`}>
          <div className="gx-art" aria-hidden="true"><svg viewBox="0 0 400 240"><use href={`#${g.art}`} /></svg></div>
          <div className="gx-body">
            <h3>{g.title}</h3>
            <p>{g.summary}</p>
            <span className="gx-date">{guideDate(g.date)}</span>
          </div>
        </a>
      ))}
    </div>
  )
}
