import type { Metadata } from 'next'
import { PageChrome } from '../../PageChrome'
import { ThankYouCard } from '../ValuationDone'
import '../valuation.css'

// Where the valuation form goes once it's sent: a page of its own, so an advert can count finished requests. It isn't
// for search engines (it only makes sense straight after sending the form).
export const metadata: Metadata = {
  title: 'Thank you · Free valuation · Preston Hill Estates',
  robots: { index: false, follow: false },
}

export default function ValuationThankYouPage() {
  return (
    <PageChrome reviews={false}>
      <main className="vx" id="top">
        <section className="vx-hero">
          <div className="wide vx-hero-grid">
            <div className="vx-copy">
              <div className="label"><b>Free valuation</b> · Harrow &amp; North West London</div>
              <h1 className="display">Your request is <em>with us.</em></h1>
              <p className="sub">Thank you for choosing Preston Hill Estates, on Preston Road since 2004. Someone from the branch will be in touch within one working day.</p>
            </div>
            <ThankYouCard />
          </div>
        </section>
      </main>
    </PageChrome>
  )
}
