import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { GUIDES, guideBySlug, guideDate } from '@/lib/guides'
import { GuideCards } from '../../GuideCards'
import { PageChrome } from '../../PageChrome'
import '../../valuation/valuation.css'

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const g = guideBySlug((await params).slug)
  return g ? { title: `${g.title} · Preston Hill Estates`, description: g.summary } : {}
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const g = guideBySlug((await params).slug)
  if (!g) notFound()
  const others = GUIDES.filter((x) => x.slug !== g.slug)
  const ld = {
    '@context': 'https://schema.org', '@type': 'Article', headline: g.title, description: g.summary, datePublished: g.date,
    author: { '@type': 'Organization', name: 'Preston Hill Estates' }, publisher: { '@type': 'Organization', name: 'Preston Hill Estates' },
  }
  return (
    <PageChrome>
      <main className="vx" id="top">
        <article className="wide gx-article">
          <p className="gx-crumb"><a href="/guides">Guides</a></p>
          <h1 className="display gx-h1">{g.title}</h1>
          <p className="gx-lead">{g.summary}</p>
          <p className="gx-meta">Preston Hill Estates · {guideDate(g.date)}</p>
          <div className="gx-art gx-art-hero" aria-hidden="true"><svg viewBox="0 0 400 240"><use href={`#${g.art}`} /></svg></div>
          <div className="gx-content">
            {g.sections.map((s) => (
              <section key={s.heading}>
                <h2>{s.heading}</h2>
                {s.paragraphs?.map((p) => <p key={p}>{p}</p>)}
                {s.points ? <ul>{s.points.map((p) => <li key={p}>{p}</li>)}</ul> : null}
              </section>
            ))}
            <aside className="gx-cta">
              <h2>Want to know what your home is worth?</h2>
              <p>Book a free, no-obligation valuation with the Preston Road branch. Sales or lettings.</p>
              <a className="btn gold" href="/valuation">Book my free valuation</a>
            </aside>
            <p className="gx-small">This guide is general information, not legal, tax or financial advice. Rules change, so check your own situation with a qualified adviser.</p>
          </div>
        </article>
        <section className="wide vx-guides">
          <div className="vx-guides-head"><h2 className="sect">More <em>guides</em></h2></div>
          <GuideCards guides={others} />
        </section>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      </main>
    </PageChrome>
  )
}
