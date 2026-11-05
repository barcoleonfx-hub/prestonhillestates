import type { Metadata } from 'next'
import { GuideCards } from '../GuideCards'
import { PageChrome } from '../PageChrome'
import '../valuation/valuation.css'

export const metadata: Metadata = {
  title: 'Guides for sellers and landlords · Preston Hill Estates',
  description: 'Plain-English guides from Preston Hill Estates on preparing for a valuation, deciding whether to sell or let, and what affects property prices in Harrow.',
}

export default function GuidesPage() {
  return (
    <PageChrome>
      <main className="vx" id="top">
        <section className="wide gx-index">
          <div className="label"><b>Guides</b> · From the Preston Road branch</div>
          <h1 className="display gx-h1">Helpful guides for <em>sellers and landlords</em></h1>
          <p className="gx-lead">Straightforward advice from the team that has valued, sold and let homes across Harrow, Kenton and Wembley since 2004.</p>
          <GuideCards />
        </section>
        <section className="vx-final">
          <div className="wide vx-final-inner">
            <div>
              <h2>Want a figure for <em>your home?</em></h2>
              <p>Book a free, no-obligation valuation, or call the branch on <a href="tel:+442089049005">020 8904 9005</a>.</p>
            </div>
            <a className="btn gold" href="/valuation">Book my free valuation</a>
          </div>
        </section>
      </main>
    </PageChrome>
  )
}
