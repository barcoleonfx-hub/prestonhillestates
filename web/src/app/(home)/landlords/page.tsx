import type { Metadata } from 'next'
import { ACCREDITATIONS, LETTINGS, PORTALS, feeIncVat, feeText } from '@/lib/site'
import { tenantDemand } from '@/lib/lettings'
import { displayAddressFor, headlineFor, listPublished, priceLabel, slugFor } from '@/lib/properties'
import { PageChrome } from '../PageChrome'
import { Reviews } from '../Reviews'
import { RentEstimate } from './RentEstimate'
import '../valuation/valuation.css'
import './landlords.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Letting agents in Harrow · fully managed for 6% · Preston Hill Estates',
  description: `Let your property with Preston Hill Estates: full management, maintenance, tenant referencing and a rent guarantee for ${LETTINGS.percent}% + VAT of the rent. Independent letting agents on Preston Road, Harrow, since 2004.`,
}

const LOGOS: Record<string, string> = { safeagent: '/accreditations/safeagent.png', mydeposits: '/accreditations/mydeposits.jpg' }

const STEPS: [string, string][] = [
  ['Rental valuation', 'We visit, tell you what rent to expect and what (if anything) needs doing before it’s let. Free, no obligation.'],
  ['Marketing', 'Photos and a listing on Zoopla, OnTheMarket and our website, and straight to the tenants already registered with us.'],
  ['Tenant found and referenced', 'We do the viewings, then reference the tenant you choose: identity, Right to Rent, income, previous landlords and credit.'],
  ['Move-in', 'Tenancy agreement signed, deposit registered with myDeposits, first rent collected and keys handed over.'],
  ['Fully managed from then on', 'Rent collected and paid to you every month, repairs arranged and overseen, the rent guaranteed and the paperwork kept right.'],
]

const FAQS: [string, string][] = [
  ['How much do you charge?', `Our fully managed service is ${feeText()}. It’s taken from the rent we collect, so there’s nothing to pay up front. Our full list of fees is on our fees page.`],
  ['What’s included in the fee?', 'Full management, maintenance, tenant referencing and a rent guarantee, plus finding the tenant, collecting the rent and protecting the deposit. The list above has the details.'],
  ['What does the rent guarantee mean?', 'If a tenant falls behind with the rent, you’re still paid. Ask us for the terms when we visit and we’ll take you through them.'],
  ['How are tenants checked?', 'Every tenant is referenced before they move in: identity and Right to Rent, income and affordability, previous landlords and credit history.'],
  ['Who looks after repairs?', 'We do. Tenants report repairs to the branch, we arrange the work with tradespeople we trust and see it through, and keep you informed.'],
  ['What changed with the Renters’ Rights Act?', 'Since 1 May 2026, “no-fault” Section 21 notices have gone and tenancies roll on month to month. To get a property back you need one of the Section 8 grounds, rent can go up once a year with formal notice, and you can’t unreasonably refuse a pet. We keep your tenancy and notices right under the new rules.'],
  ['How quickly can you find a tenant?', 'Demand in Harrow, Kenton and Wembley is strong, and we already hold a list of tenants looking. How long it takes depends on the property and the rent; we’ll give you an honest view at the valuation.'],
  ['Can I switch to you from another agent?', 'Yes. Tell us about your tenancy and when your current agreement allows you to move, and we’ll take care of the handover with your tenant.'],
  ['Which areas do you cover?', 'Harrow, Kenton, Wembley, Pinner, Stanmore, Edgware, Wealdstone, Kingsbury and the streets around them, from our branch at 271 Preston Road.'],
]

export default async function LandlordsPage() {
  const [demand, lets] = await Promise.all([tenantDemand().catch(() => 0), listPublished({ channel: 'let' }).catch(() => [])])
  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQS.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }
  const shown = lets.filter((p) => p.status === 'available').slice(0, 3)

  return (
    <PageChrome reviews={false}>
      <main className="vx lx" id="top">
        <section className="vx-hero">
          <div className="wide vx-hero-grid">
            <div className="vx-copy">
              <div className="label"><b>Lettings &amp; management</b> · Harrow &amp; North West London</div>
              <h1 className="display">Let it. We’ll <em>look after the rest.</em></h1>
              <p className="sub">Full management, maintenance, tenant referencing and a rent guarantee, all for {LETTINGS.percent}%{LETTINGS.vat === 'plus' ? ' + VAT' : ''} of the rent. From the independent branch that has let homes on Preston Road since 2004.</p>
            </div>
            <RentEstimate feePct={feeIncVat()} />
            <div className="vx-extra">
              <div className="lx-price">
                <span className="lx-price-pct serif">{LETTINGS.percent}%</span>
                <span className="lx-price-txt"><b>{LETTINGS.name}</b>{LETTINGS.vat === 'plus' ? ` + VAT (${feeIncVat()}% inc. VAT)` : ' inc. VAT'} of the monthly rent. Nothing to pay up front.</span>
              </div>
              <ul className="vx-ticks">
                {LETTINGS.includes.slice(0, 4).map(([t]) => <li key={t}>{t}</li>)}
              </ul>
              <p className="vx-call">Prefer to talk? <a href="tel:+442089049005">020 8904 9005</a></p>
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

        <section className="wide lx-included" id="included" aria-labelledby="inc-h">
          <div className="rv">
            <div className="label"><b>What’s included</b></div>
            <h2 className="sect" id="inc-h">One service, <em>everything covered</em></h2>
            <p className="lx-sub">No menu of add-ons to decode. One fully managed service at {feeText()}.</p>
          </div>
          <div className="lx-cards">
            {LETTINGS.includes.map(([t, d], i) => (
              <div key={t} className={`lx-card rv d${i % 3}`}>
                <span className="lx-card-n serif">{String(i + 1).padStart(2, '0')}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
          <p className="lx-feesline">See all our fees, and what tenants can and can’t be charged, on our <a href="/fees">fees page</a>.</p>
        </section>

        {demand >= 10 ? (
          <section className="lx-demand" aria-label="Tenant demand">
            <div className="wide lx-demand-in rv">
              <span className="lx-demand-n serif">{demand}</span>
              <p><b>people asked us about homes to rent in the last 30 days.</b> Demand in Harrow, Kenton and Wembley outstrips supply, and they’re the first to hear about a new let.</p>
              <a className="btn gold" href="#estimate">Value my rental</a>
            </div>
          </section>
        ) : null}

        <section className="wide vx-how" aria-labelledby="how-h">
          <div className="rv">
            <div className="label"><b>How it works</b></div>
            <h2 className="sect" id="how-h">From valuation to <em>rent in your account</em></h2>
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

        <section className="wide vx-reasons" aria-labelledby="rra-h">
          <div className="vx-reasons-card rv">
            <div>
              <div className="label"><b>The new rules</b></div>
              <h2 className="sect" id="rra-h">The Renters’ Rights Act, <em>handled</em></h2>
            </div>
            <ul className="vx-reason-list">
              <li><b>No more Section 21.</b> Since 1 May 2026 tenancies roll on month to month, and getting a property back needs a Section 8 ground. We make sure your paperwork stands up.</li>
              <li><b>Rent reviews done properly.</b> Rent can go up once a year with the formal Section 13 notice. We advise on the figure and serve it correctly.</li>
              <li><b>Pets and bidding.</b> Tenants can ask to keep a pet, and rental bidding is banned. We handle the requests and the marketing the right way.</li>
              <li><b>The landlord database.</b> Every landlord will need to register, region by region. We’ll tell you when London opens and help you get ready.</li>
            </ul>
            <a className="btn dark" href="#estimate">Talk to us about your property</a>
          </div>
        </section>

        {shown.length ? (
          <section className="wide lx-lets" aria-labelledby="lets-h">
            <div className="vx-guides-head rv">
              <div>
                <div className="label"><b>On the market now</b></div>
                <h2 className="sect" id="lets-h">Homes we’re <em>letting</em></h2>
              </div>
              <a className="btn ghost" href="/properties?channel=let">All homes to rent</a>
            </div>
            <div className="lx-let-grid">
              {shown.map((p) => (
                <a key={p.id} className="lx-let rv" href={`/properties/${slugFor(p)}`}>
                  <span className="lx-let-img">{p.cover ? <img src={p.cover.url} alt="" loading="lazy" /> : null}</span>
                  <span className="lx-let-body"><b>{priceLabel(p)}</b><span>{headlineFor(p)}</span><small>{displayAddressFor(p)}</small></span>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        <section className="vx-founder wide">
          <figure className="vx-founder-card rv">
            <img src="/img/founder.jpg" alt="Jamil Ahmed, founder of Preston Hill Estates" />
            <blockquote>
              <p>“Never back away from a challenge. Whatever it takes, every client leaves this office with a smile.”</p>
              <cite>Jamil Ahmed, Founder · 35+ years in property</cite>
            </blockquote>
          </figure>
        </section>

        <Reviews category="lettings" title={<>What landlords and tenants <em>say</em></>} />

        <section className="wide vx-faq" aria-labelledby="faq-h">
          <div className="rv">
            <div className="label"><b>Questions</b></div>
            <h2 className="sect" id="faq-h">Letting <em>questions</em></h2>
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
              <h2>Ready to let? <em>Start with a free valuation.</em></h2>
              <p>Two minutes online, or call the branch on <a href="tel:+442089049005">020 8904 9005</a>.</p>
            </div>
            <a className="btn gold" href="#estimate">Value my rental</a>
          </div>
        </section>
      </main>

      <nav className="vx-mobilebar" aria-label="Quick actions">
        <a className="btn gold" href="#estimate">Rent estimate</a>
        <a className="btn ghost" href="tel:+442089049005">Call us</a>
      </nav>
    </PageChrome>
  )
}
