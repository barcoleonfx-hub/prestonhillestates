import type { Metadata } from 'next'
import { PageChrome } from '../PageChrome'
import { BorrowCalculator } from './BorrowCalculator'
import '../valuation/valuation.css'
import './calculator.css'

export const metadata: Metadata = {
  title: 'How much can I borrow? Mortgage calculator · Preston Hill Estates',
  description: 'A quick guide to how much you could borrow for a mortgage, the price range that puts within reach, and the monthly repayment. From Preston Hill Estates, Harrow.',
}

const FAQS: [string, string][] = [
  ['How do lenders work out how much I can borrow?', 'Most start from a multiple of your income, often around four to four and a half times, then check affordability: your outgoings, debts, credit history, dependants and how secure your income is. That’s why two people on the same salary can be offered different amounts.'],
  ['Does buying with someone else mean I can borrow more?', 'Usually, because lenders look at your combined income. Both of you will be named on the mortgage and both are responsible for the repayments.'],
  ['How big a deposit do I need?', 'Most lenders need at least 5% of the price. A bigger deposit usually gets you a better interest rate and lower monthly payments.'],
  ['Is this the amount I will be offered?', 'No. It’s a rough guide to help you plan. The amount you’re offered depends on the lender and your full circumstances. A mortgage adviser can tell you what you’re likely to get and help you get an agreement in principle.'],
  ['What is an agreement in principle?', 'A statement from a lender saying how much they would probably lend you, based on a quick check. Having one shows sellers you’re serious, and we’ll ask about it when you make an offer.'],
  ['I need to sell to buy. Where do I start?', 'Find out what your current home is worth first. It tells you how much equity you have for your next deposit. Book a free valuation with us and we’ll help you plan both sides of the move.'],
]

export default function MortgageCalculatorPage() {
  const faqLd = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: FAQS.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  }
  return (
    <PageChrome reviews="sales">
      <main className="vx" id="top">
        <section className="wide mc-hero">
          <div className="label"><b>Buying</b> · Mortgage calculator</div>
          <h1 className="display gx-h1">How much could you <em>borrow?</em></h1>
          <p className="gx-lead">A quick guide to what lenders might offer, the price range that puts within reach, and what the monthly repayments could look like.</p>
          <BorrowCalculator />
        </section>

        <section className="wide vx-faq" aria-labelledby="mc-faq-h">
          <div className="rv">
            <div className="label"><b>Questions</b></div>
            <h2 className="sect" id="mc-faq-h">Borrowing <em>explained</em></h2>
          </div>
          <div className="vx-faq-list">
            {FAQS.map(([q, a]) => (
              <details key={q}><summary>{q}</summary><p>{a}</p></details>
            ))}
          </div>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
        </section>

        <section className="vx-final">
          <div className="wide vx-final-inner">
            <div>
              <h2>Selling to buy? Find out what yours is <em>worth.</em></h2>
              <p>Your equity is your next deposit. Book a free valuation, or call the branch on <a href="tel:+442089049005">020 8904 9005</a>.</p>
            </div>
            <a className="btn gold" href="/valuation">Book my free valuation</a>
          </div>
        </section>
      </main>
    </PageChrome>
  )
}
