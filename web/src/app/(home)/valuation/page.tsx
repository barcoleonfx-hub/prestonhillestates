import type { Metadata } from 'next'
import { ACCREDITATIONS, PORTALS } from '@/lib/site'
import { GuideCards } from '../GuideCards'
import { PageChrome } from '../PageChrome'
import { Reviews } from '../Reviews'
import { ValuationWizard } from './ValuationWizard'
import './valuation.css'

export const metadata: Metadata = {
  title: 'Free property valuation in Harrow · Preston Hill Estates',
  description: 'Book a free, no-obligation sales or rental valuation with Preston Hill Estates, independent estate agents on Preston Road since 2004. Harrow, Kenton, Wembley and North West London.',
}

// Logos we hold; the rest show their names until the files arrive.
const LOGOS: Record<string, string> = { safeagent: '/accreditations/safeagent.png', mydeposits: '/accreditations/mydeposits.jpg' }

const FAQS: [string, string][] = [
  ['Is the valuation really free?', 'Yes. There’s no charge, and no obligation to sell or let with us afterwards.'],
  ['Can I get an online valuation?', 'Online estimates are a useful starting point, but they can’t see your extension, your garden or the condition inside, and they average out streets that can differ a lot. For a figure you can plan around, book a free in-person valuation with us.'],
  ['How is an estate agent’s valuation different from a survey?', 'Our valuation tells you what we expect your home to sell or let for in today’s market. A survey is carried out by a surveyor, usually for a buyer, and reports on the condition of the building. A mortgage valuation is done for the buyer’s lender. They answer different questions.'],
  ['How do I choose an agent to value my home?', 'Look for local knowledge, honesty about price and a clear plan for marketing. Be wary of the highest figure if it isn’t backed by evidence: an overpriced home often sits on the market and ends up selling for less. Ask each agent which comparable sales they used.'],
  ['What is the process?', 'Book online or call us. We call you back within one working day to arrange a time, visit and walk round the property with you, then give you our figure and how we would market it. If you’re happy, we take it from there.'],
  ['What information do you need?', 'The address and the best way to reach you is enough to book. At the visit it helps to know about any works you’ve done, and for flats the lease length, ground rent and service charge.'],
  ['How should I prepare for the valuation?', 'There’s no need to redecorate. Open the curtains, clear surfaces, make sure we can get into every room and the garden, and have any certificates for works to hand. Our guide below has more tips.'],
  ['How long does a valuation take?', 'It depends on the size of the home and how many questions you have. We’ll give you an idea when we arrange the visit, and there’s never any rush.'],
  ['What affects the value of homes in Harrow?', 'Mainly location and transport links, local schools, space and layout, condition, outside space and parking, and for flats the lease. Two similar homes a few streets apart can be worth noticeably different amounts.'],
  ['Can I increase my property’s value before the valuation?', 'Small things help a home show well, like fixing minor faults and tidying the front. Bigger projects only make sense if they add more than they cost; ask us before you start and we’ll tell you honestly.'],
  ['What if I don’t agree with your figure?', 'Tell us. We’ll show you the sales and lettings we based it on and talk it through. You’re free to get other opinions, and we’d rather you choose us with a realistic price than a hopeful one.'],
  ['Am I tied in after the valuation?', 'No. The valuation is free and you’re under no obligation to instruct us.'],
  ['Do you value homes to let as well as to sell?', 'Yes. Choose “I want to let” and we’ll give you a realistic monthly rent and explain our lettings and management service. Not sure yet? We can give you both figures at the same visit.'],
  ['What if my property is outside your area?', 'We cover Harrow, Kenton, Wembley, Pinner, Stanmore, Edgware, Wealdstone, Kingsbury and the streets around them. If you’re just outside, call us anyway and we’ll tell you honestly whether we’re the right agent.'],
]

export default async function ValuationPage({ searchParams }: { searchParams: Promise<{ intent?: string; postcode?: string }> }) {
  const sp = await searchParams
  const intent = sp.intent === 'letting' ? 'letting' : 'selling'
  const postcode = (sp.postcode ?? '').toUpperCase().slice(0, 10)
  // Helps Google show the questions directly in search results.
  const faqLd = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: FAQS.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  }

  return (
    <PageChrome>
      <main className="vx" id="top">
        <section className="vx-hero">
          <div className="wide vx-hero-grid">
            <div className="vx-copy">
              <div className="label"><b>Free valuation</b> · Harrow &amp; North West London</div>
              <h1 className="display">What’s your home <em>worth today?</em></h1>
              <p className="sub">Get a considered figure from people who have valued homes on your street since 2004, not a guess from a computer. Sales or lettings, it takes two minutes to book.</p>
            </div>
            <ValuationWizard initialIntent={intent} initialPostcode={postcode} />
            <div className="vx-extra">
              <ul className="vx-ticks">
                <li>Free and without obligation</li>
                <li>A call back within one working day</li>
                <li>Valued in person by the Preston Road branch</li>
                <li>Sales and rental valuations</li>
              </ul>
              <p className="vx-call">Prefer to talk? <a href="tel:+442081277001">020 8127 7001</a></p>
            </div>
          </div>
        </section>

        <div className="accredband" aria-label="Accreditations">
          <div className="wide row">
            <span className="grp">
              <span className="lead">Regulated &amp; accredited</span>
              {ACCREDITATIONS.map((a) => (
                <a key={a.key} className="t acc" href={a.url} target="_blank" rel="noopener noreferrer" aria-label={`${a.name} (opens in a new tab)`}>
                  {LOGOS[a.key] ? <img src={LOGOS[a.key]} alt={a.name} /> : a.name}
                </a>
              ))}
            </span>
            <span className="grp">
              <span className="lead">Marketed on</span>
              {PORTALS.map((p) => (
                <a key={p.key} className="portal" href={p.url} target="_blank" rel="noopener noreferrer" aria-label={`Preston Hill Estates on ${p.name} (opens in a new tab)`}>{p.name} <span className="go" aria-hidden="true">↗</span></a>
              ))}
            </span>
          </div>
        </div>

        <section className="wide vx-how">
          <div className="rv">
            <div className="label"><b>How it works</b></div>
            <h2 className="sect">From first call to <em>on the market</em></h2>
          </div>
          <ol className="vx-how-grid">
            {[
              ['Book in two minutes', 'Tell us where the property is and when suits you. No obligation.'],
              ['We call you back', 'Within one working day, to arrange a visit at a time that works for you.'],
              ['We visit and value', 'We walk round with you and give you an honest figure, backed by what has sold and let nearby.'],
              ['Your plan to market', 'If you go ahead, we prepare photos and floorplans and list you on Zoopla, OnTheMarket and our own website.'],
            ].map(([t, d], i) => (
              <li key={t} className={`vx-how-step rv d${i}`}>
                <span className="vx-num serif">{i + 1}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="vx-why" aria-labelledby="why-h">
          <div className="wide vx-why-grid">
            <div className="rv">
              <div className="label"><b>Why Preston Hill</b></div>
              <h2 className="sect" id="why-h">Why choose us to value your home <em>in Harrow?</em></h2>
              <p className="vx-why-sub">We’ve been an independent agent at 271 Preston Road since 2004. The people who value your home know the local streets, what buyers and tenants are looking for right now, and what has actually sold and let nearby.</p>
              <ul className="vx-why-ticks">
                <li>Valued in person by the local Preston Road branch</li>
                <li>Led by our founder, Jamil Ahmed, with more than 35 years in property</li>
                <li>Free, with no obligation to instruct us</li>
                <li>Regulated by The Property Ombudsman and the Property Redress Scheme, and safeagent accredited</li>
                <li>Happy to answer your questions about the process, the market and your next steps</li>
              </ul>
              <a className="btn gold" href="#val-start">Book your free valuation</a>
            </div>
            <div className="vx-why-cards">
              <div className="vx-why-card rv">
                <h3>Selling with us</h3>
                <ul>
                  <li>Honest appraisals, not inflated figures to win the instruction</li>
                  <li>Full coverage on Zoopla, OnTheMarket and our website</li>
                  <li>A negotiator who actually knows the street you’re selling on</li>
                </ul>
                <a className="link" href="#val-start">Book a sales valuation <span className="ar">⟶</span></a>
              </div>
              <div className="vx-why-card rv d1">
                <h3>Letting with us</h3>
                <ul>
                  <li>Vetted tenants and deposits protected with myDeposits</li>
                  <li>Rent guarantee included in our fully managed service</li>
                  <li>Full management handled by the branch, not a call centre</li>
                </ul>
                <a className="link" href="/valuation?intent=letting#val-start">Book a rental valuation <span className="ar">⟶</span></a>
              </div>
            </div>
          </div>
        </section>

        <section className="wide vx-reasons" aria-labelledby="reasons-h">
          <div className="vx-reasons-card rv">
            <div>
              <div className="label"><b>Why get a valuation</b></div>
              <h2 className="sect" id="reasons-h">Know where you stand <em>before you move</em></h2>
            </div>
            <ul className="vx-reason-list">
              <li><b>Price it right from day one.</b> Homes priced realistically from the start attract more interest and tend to sell sooner. Overpriced homes often sit, then sell for less.</li>
              <li><b>Plan your next move.</b> Knowing what your home is worth tells you what you could put towards your next one, before you start viewing.</li>
              <li><b>Compare selling and letting.</b> Ask for both figures at the same visit and see which suits you better.</li>
              <li><b>Make decisions with evidence.</b> We show you the nearby sales and lettings behind our figure, so you’re not relying on a guess.</li>
            </ul>
            <a className="btn dark" href="#val-start">Book your free valuation</a>
          </div>
        </section>

        <section className="vx-founder wide">
          <figure className="vx-founder-card rv">
            <img src="/img/founder.jpg" alt="Jamil Ahmed, founder of Preston Hill Estates" />
            <blockquote>
              <p>“Never back away from a challenge. Whatever it takes, every client leaves this office with a smile.”</p>
              <cite>Jamil Ahmed, Founder · 35+ years in property</cite>
            </blockquote>
          </figure>
        </section>

        <Reviews category="sales" title={<>What sellers and landlords <em>say</em></>} />

        <section className="wide vx-guides" aria-labelledby="guides-h">
          <div className="vx-guides-head rv">
            <div>
              <div className="label"><b>Guides</b></div>
              <h2 className="sect" id="guides-h">Helpful guides before you <em>sell or let</em></h2>
            </div>
            <a className="btn ghost" href="/guides">All guides</a>
          </div>
          <GuideCards />
        </section>

        <section className="wide vx-faq" aria-labelledby="faq-h">
          <div className="rv">
            <div className="label"><b>Questions</b></div>
            <h2 className="sect" id="faq-h">Property valuation <em>questions</em></h2>
            <p className="vx-faq-sub">Can’t see your question? Call the branch on <a href="tel:+442081277001">020 8127 7001</a>.</p>
          </div>
          <div className="vx-faq-list">
            {FAQS.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
        </section>

        <section className="vx-final">
          <div className="wide vx-final-inner">
            <div>
              <h2>Ready to find out what it’s <em>worth?</em></h2>
              <p>Two minutes online, or call the branch on <a href="tel:+442081277001">020 8127 7001</a>.</p>
            </div>
            <a className="btn gold" href="#val-start">Book my free valuation</a>
          </div>
        </section>
      </main>

      <nav className="vx-mobilebar" aria-label="Quick actions">
        <a className="btn gold" href="#val-start">Free valuation</a>
        <a className="btn ghost" href="tel:+442081277001">Call us</a>
      </nav>
    </PageChrome>
  )
}
