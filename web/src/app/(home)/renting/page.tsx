import type { Metadata } from 'next'
import { displayAddressFor, headlineFor, listPublished, priceLabel, slugFor } from '@/lib/properties'
import { TENANT_AREAS } from '@/lib/tenants'
import { PageChrome } from '../PageChrome'
import { TenantSignup } from './TenantSignup'
import { Reviews } from '../Reviews'
import '../valuation/valuation.css'
import '../landlords/landlords.css'
import './renting.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Homes to rent in Harrow, Kenton and Wembley · Preston Hill Estates',
  description: 'Register with Preston Hill Estates and hear about new homes to rent in Harrow, Kenton, Wembley and Kingsbury first. How renting with us works, what you’ll pay and your rights.',
}

const STEPS: [string, string][] = [
  ['Register or browse', 'Tell us what you’re after and we’ll email you new homes that fit, often before they reach the portals. Or browse what’s on now.'],
  ['View it', 'We show every home ourselves, so you can ask about the area, the bills and the landlord.'],
  ['Reserve it', 'Like it? A refundable holding deposit of no more than 1 week’s rent takes it off the market while we reference you.'],
  ['Referencing', 'We check identity and Right to Rent, income, your previous landlord and credit. It usually takes a few days.'],
  ['Move in', 'Sign the tenancy, pay the first month’s rent and the deposit (no more than 5 weeks’ rent, protected with myDeposits), and collect the keys.'],
]

const FAQS: [string, string][] = [
  ['What will I pay to rent through you?', 'The rent, a refundable holding deposit (up to 1 week’s rent) and a refundable tenancy deposit (up to 5 weeks’ rent). We don’t charge for viewings, referencing or the tenancy agreement. Our fees page lists the few other payments the law allows.'],
  ['How long is the tenancy?', 'Since 1 May 2026, new tenancies in England roll on month to month with no fixed end date. You can leave by giving two months’ notice.'],
  ['Can I rent with a pet?', 'You can ask, and a landlord can’t unreasonably refuse. Tick “I have a pet” when you register and we’ll tell you which homes suit.'],
  ['Can the rent go up?', 'Only once a year, with a formal notice that gives you at least two months’ warning.'],
  ['How does referencing work?', 'We confirm your identity and Right to Rent, your income or a guarantor, your previous landlord and your credit history. Have payslips, bank statements and ID ready to speed it up.'],
  ['How quickly do homes go?', 'Good homes to rent in Harrow, Kenton and Wembley often go within days. Registering means you hear about new ones as soon as they come on.'],
]

export default async function RentingPage() {
  const lets = (await listPublished({ channel: 'let' }).catch(() => [])).filter((p) => p.status === 'available').slice(0, 6)
  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQS.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }
  return (
    <PageChrome reviews={false}>
      <main className="vx lx tx" id="top">
        <section className="vx-hero">
          <div className="wide vx-hero-grid">
            <div className="vx-copy">
              <div className="label"><b>Renting</b> · Harrow &amp; North West London</div>
              <h1 className="display">Hear about new homes <em>to rent first.</em></h1>
              <p className="sub">Good homes in Harrow, Kenton and Wembley often go within days. Tell us what you’re looking for and we’ll email you the ones that fit as soon as they come on, from the independent branch on Preston Road.</p>
            </div>
            <TenantSignup areas={Object.keys(TENANT_AREAS)} />
            <div className="vx-extra">
              <ul className="vx-ticks">
                <li>No fees for viewings, referencing or the tenancy agreement</li>
                <li>Deposits protected with myDeposits</li>
                <li>Every home shown by the branch, not a call centre</li>
                <li>Unsubscribe from the emails any time</li>
              </ul>
              <p className="vx-call">Rather talk? <a href="tel:+442089049005">020 8904 9005</a></p>
            </div>
          </div>
        </section>

        {lets.length ? (
          <section className="wide lx-lets" aria-labelledby="lets-h">
            <div className="vx-guides-head rv">
              <div>
                <div className="label"><b>Available now</b></div>
                <h2 className="sect" id="lets-h">Homes <em>to rent</em></h2>
              </div>
              <a className="btn ghost" href="/properties?channel=let">See them all</a>
            </div>
            <div className="lx-let-grid">
              {lets.map((p) => (
                <a key={p.id} className="lx-let rv" href={`/properties/${slugFor(p)}`}>
                  <span className="lx-let-img">{p.cover ? <img src={p.cover.url} alt="" loading="lazy" /> : null}</span>
                  <span className="lx-let-body"><b>{priceLabel(p)}</b><span>{headlineFor(p)}</span><small>{displayAddressFor(p)}</small></span>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        <section className="wide vx-how" aria-labelledby="how-h">
          <div className="rv">
            <div className="label"><b>How it works</b></div>
            <h2 className="sect" id="how-h">From first viewing to <em>your keys</em></h2>
          </div>
          <ol className="vx-how-grid lx-steps">
            {STEPS.map(([t, d], i) => (
              <li key={t} className={`vx-how-step rv d${i % 4}`}>
                <span className="vx-num serif">{i + 1}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="wide vx-reasons" aria-labelledby="rights-h">
          <div className="vx-reasons-card rv">
            <div>
              <div className="label"><b>Your rights</b></div>
              <h2 className="sect" id="rights-h">Renting under <em>the new rules</em></h2>
            </div>
            <ul className="vx-reason-list">
              <li><b>No fixed end date.</b> Since 1 May 2026, tenancies roll on month to month, and you can leave with two months’ notice.</li>
              <li><b>No “no-fault” evictions.</b> Section 21 has gone: a landlord needs a legal reason to end your tenancy.</li>
              <li><b>Rent rises once a year.</b> With formal notice, and no bidding wars when you apply.</li>
              <li><b>Pets.</b> You can ask to keep one, and a landlord can’t unreasonably say no.</li>
            </ul>
            <a className="btn dark" href="/fees">What you can be charged</a>
          </div>
        </section>

        <Reviews category="lettings" title={<>What tenants and landlords <em>say</em></>} />

        <section className="wide vx-faq" aria-labelledby="faq-h">
          <div className="rv">
            <div className="label"><b>Questions</b></div>
            <h2 className="sect" id="faq-h">Renting <em>questions</em></h2>
            <p className="vx-faq-sub">Can’t see your question? Call the branch on <a href="tel:+442089049005">020 8904 9005</a>.</p>
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
              <h2>Don’t miss the next one. <em>Register now.</em></h2>
              <p>It takes a minute, or call the branch on <a href="tel:+442089049005">020 8904 9005</a>.</p>
            </div>
            <a className="btn gold" href="#register">Send me matching homes</a>
          </div>
        </section>
      </main>

      <nav className="vx-mobilebar" aria-label="Quick actions">
        <a className="btn gold" href="#register">Get alerts</a>
        <a className="btn ghost" href="/properties?channel=let">Homes to rent</a>
      </nav>
    </PageChrome>
  )
}
