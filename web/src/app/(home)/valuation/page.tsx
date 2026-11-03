import type { Metadata } from 'next'
import Script from 'next/script'
import { ACCREDITATIONS, PORTALS } from '@/lib/site'
import { FOOTER, HEADER, SPRITE } from '../home-content'
import { ValuationWizard } from './ValuationWizard'
import './valuation.css'

export const metadata: Metadata = {
  title: 'Free property valuation in Harrow · Preston Hill Estates',
  description: 'Book a free, no-obligation sales or rental valuation with Preston Hill Estates, independent estate agents on Preston Road since 2004. Harrow, Kenton, Wembley and North West London.',
}

// Logos we hold; the rest show their names until the files arrive.
const LOGOS: Record<string, string> = { safeagent: '/accreditations/safeagent.png', mydeposits: '/accreditations/mydeposits.jpg' }

const FAQS: [string, string][] = [
  ['Is the valuation really free?', 'Yes. There’s no charge and no obligation to sell or let with us afterwards.'],
  ['What happens after I send the form?', 'Someone from the branch calls you within one working day to arrange a time that suits you, then visits the property.'],
  ['Do you value homes to let as well as to sell?', 'Yes. Choose “I want to let” and we’ll give you a realistic monthly rent and explain how our lettings and management service works.'],
  ['Which areas do you cover?', 'Harrow, Kenton, Wembley, Pinner, Stanmore, Edgware, Wealdstone, Kingsbury and the streets around them. If you’re just outside, ask us anyway.'],
  ['Why not just use an online estimate?', 'Online estimates can’t see your extension, your garden or the condition inside. A visit from people who know your street gives you a figure you can actually plan around.'],
  ['What should I have ready?', 'Nothing special. If you have them to hand, details of any works you’ve done, and for flats the lease length and service charge, help us be more precise.'],
]

const CHROME_JS = `(function(){
  var h=document.getElementById('siteHeader'); if(h){var f=function(){h.classList.toggle('scrolled',window.scrollY>30)};addEventListener('scroll',f,{passive:true});f();}
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:0.12});
  document.querySelectorAll('.rv').forEach(function(el){io.observe(el)});
  var c=document.getElementById('copyright'); if(c) c.textContent='© '+new Date().getFullYear()+' Preston Hill Estates · Company No. 05058532';
})();`

export default async function ValuationPage({ searchParams }: { searchParams: Promise<{ intent?: string; postcode?: string }> }) {
  const sp = await searchParams
  const intent = sp.intent === 'letting' ? 'letting' : 'selling'
  const postcode = (sp.postcode ?? '').toUpperCase().slice(0, 10)

  return (
    <>
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: SPRITE + HEADER }} />
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

        <section className="vx-why">
          <div className="wide vx-why-grid">
            <div className="rv">
              <div className="label"><b>Why Preston Hill</b></div>
              <h2 className="sect">An independent agent <em>that stays put</em></h2>
              <p className="vx-why-sub">Agencies have opened, rebranded and disappeared along Preston Road. We’ve been at number 271 since 2004, and the people who value your home are the same people who sell or let it.</p>
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
                  <li>Rent-guarantee options available</li>
                  <li>Full management handled by the branch, not a call centre</li>
                </ul>
                <a className="link" href="/valuation?intent=letting#val-start">Book a rental valuation <span className="ar">⟶</span></a>
              </div>
            </div>
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

        <section className="quote">
          <div className="wide">
            <blockquote className="rv"><span className="mk">“</span>I’ve worked with several agents in the past, but none as knowledgeable and helpful as the team at Preston Hill Estates. Buying, selling or renting, they are the best in the business.<span className="mk">”</span></blockquote>
            <div className="attr label rv d1">Client review</div>
          </div>
        </section>

        <section className="wide vx-faq">
          <div className="rv">
            <div className="label"><b>Questions</b></div>
            <h2 className="sect">Before you <em>book</em></h2>
          </div>
          <div className="vx-faq-list">
            {FAQS.map(([q, a]) => (
              <details key={q} className="rv">
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
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
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: FOOTER }} />
      <Script id="valuation-chrome" strategy="afterInteractive">{CHROME_JS}</Script>
    </>
  )
}
