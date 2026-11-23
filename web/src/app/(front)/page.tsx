import type { CSSProperties } from 'react'
import { BusinessLd } from '@/components/BusinessLd'
import { AttributionField } from '@/components/LeadCapture'
import { LogoMark } from '@/components/Logo'
import { portalUrl } from '@/lib/mailer'
import { labelFor, PROPERTY_TYPES } from '@/lib/options'
import { displayAddressFor, listPublished, priceLabel, slugFor } from '@/lib/properties'
import { googleSummary, reviewsFor } from '@/lib/reviews-data'
import { ACCREDITATIONS, LETTINGS } from '@/lib/site'
import { LR_CREDIT, patchSummary } from '@/lib/sold-prices'
import { ValuationHandoff } from './ValuationHandoff'

export const dynamic = 'force-dynamic'

/*
  type: service (an estate agent: people hire it to sell, let and manage homes)
  deal: hero photo (words in a solid box on the calm side), nav nav-centre, close close-type (redealt: every client photograph is already in use above), footer footer-dark,
        rhythm dark-band, buttons solid, mark: the client's own logo; palette: the client's own colours (gold, cream,
        charcoal from the shopfront and logo), type Fraunces + Figtree (Fraunces is the client's own face on its
        print, booklets and emails)
  moments: picture-develops on Preston Road in 1960 (#story)
  voice: facts only (copy-registers 1): names, dates and counts; "we" for the work, "you" for what the owner gets
*/

const PHONE = '020 8904 9005'
const TEL = 'tel:+442089049005'
const AREA_NAMES: Record<string, string> = { HA0: 'Wembley and Alperton', HA1: 'Harrow', HA2: 'South and North Harrow', HA3: 'Kenton and Harrow Weald', HA7: 'Stanmore', HA8: 'Edgware', HA9: 'Wembley', NW9: 'Kingsbury and Colindale' }
const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
const h = (n: number) => ({ '--h': n }) as CSSProperties

function Arrow() {
  return <svg className="m-arrow" viewBox="0 0 12 12" aria-hidden="true"><path className="m-arrow__stem" d="M1 6h8" /><path className="m-arrow__head" d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
}

function Logo() {
  return <a className="nav__logo" href="#top"><LogoMark className="front-mark" />Preston Hill Estates</a>
}

export default async function FrontPage() {
  const [listings, reviewList, google, market] = await Promise.all([
    listPublished({}).catch(() => []),
    reviewsFor('any', 12).catch(() => []),
    googleSummary().catch(() => ({ rating: null, count: null, url: null })),
    patchSummary().catch(() => null),
  ])
  // Homes with a photograph, newest first: three tiles, one row.
  const homes = listings.filter((p) => p.cover).slice(0, 3)
  // Real Google reviews, complete ones (not cut short by Google) first.
  const reviews = reviewList.filter((r) => r.source === 'Google review' && (r.rating ?? 5) >= 4)
    .sort((a, b) => Number(/…$/.test(a.text)) - Number(/…$/.test(b.text)) || a.text.length - b.text.length)
    .filter((r) => !/…$/.test(r.text) && r.text.length <= 260)
  const review = [...reviews].sort((a, b) => b.text.length - a.text.length)[0] ?? null
  const rated = google.rating && google.count ? `${google.rating.toFixed(1)} out of 5 from ${google.count.toLocaleString('en-GB')} Google reviews` : null
  const areas = (market?.byArea ?? []).filter((a) => a.median).slice(0, 8)
  const lettingFee = `${LETTINGS.percent}%${LETTINGS.vat === 'plus' ? ' + VAT' : ''} of the rent`

  return (
    <>
      <BusinessLd base={portalUrl()} />
      <header className="nav nav--centre">
        <div className="wrap nav__bar">
          <a className="skip-link" href="#top">Skip to content</a>
          <Logo />
          <nav className="nav__links" aria-label="Main">
            <div className="nav__item"><a className="nav__link" href="/properties">Homes</a></div>
            <div className="nav__item"><a className="nav__link" href="/sell">Selling</a></div>
            <div className="nav__item"><a className="nav__link" href="/landlords">Letting</a></div>
            <div className="nav__item"><a className="nav__link" href="#prices">Prices</a></div>
            <div className="nav__item"><a className="nav__link" href="#story">History</a></div>
          </nav>
          <div className="nav__actions">
            <a className="btn btn--primary" href="#valuation">Book a free valuation</a>
          </div>
          <button className="nav__toggle" type="button" aria-expanded="false" aria-label="Menu">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 5h14M2 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
      </header>

      <main id="top">
        <section className="hero hero--photo" data-enter="" data-calm="left" aria-labelledby="hero-h">
          <img className="hero__bg" src="/img/wembley-night.jpg" alt="Wembley Stadium and the streets of homes around it at dusk, seen from the air" style={{ '--ly-pos': '50% 70%', '--ly-pos-phone': '50% 75%' } as CSSProperties} fetchPriority="high" data-source="client" data-subject="the area we cover" />
          <div className="wrap"><div className="hero-text">
            <div className="hero__text">
              <h1 id="hero-h">Estate agents on Preston Road</h1>
              <p className="hero__lead">Sales, lettings and management from one branch in Harrow, open since 2004. Free valuations across Kenton, Wembley, Kingsbury and Harrow.</p>
              <div className="btn-row">
                <a className="btn btn--primary" href="#valuation">Book a free valuation<Arrow /></a>
                <a className="btn btn--secondary" href="/properties">See homes for sale</a>
              </div>
            </div>
          </div></div>
        </section>

        <section className="section g2m" id="services" aria-labelledby="services-h">
          <div className="wrap grid grid--top">
            <div className="span-6">
              <div className="section-head">
                <h2 id="services-h">Sales, lettings and management. <span className="muted">One branch does all three.</span></h2>
                <p>The people who value your home are the ones who show buyers round and see the sale through to the keys.</p>
              </div>
              <ul className="rows">
                <li><span className="rows__name"><a className="link" href="/sell">Selling your home</a></span><p>Valuation, photographs, Zoopla and OnTheMarket, and every viewing done by us.</p><span className="rows__value">Free valuation</span></li>
                <li><span className="rows__name"><a className="link" href="/landlords">Letting, fully managed</a></span><p>Tenants referenced before they move in, rent collected and repairs arranged.</p><span className="rows__value">{lettingFee}</span></li>
                <li><span className="rows__name">Rent guarantee</span><p>Your rent is paid even if a tenant falls behind.</p><span className="rows__value">Included</span></li>
              </ul>
              <p className="front-more"><a className="link" href="/fees">See our fees</a></p>
            </div>
            <div className="frame frame--photo span-6 start-7 front-shop">
              <img className="frame__img" src="/img/shopfront.jpg" alt="The Preston Hill Estates branch at 271 Preston Road, its window full of homes for sale and to let" loading="lazy" data-source="client" data-subject="the branch" />
            </div>
          </div>
        </section>

        {homes.length >= 3 ? (
          <section className="section" id="homes" aria-labelledby="homes-h">
            <div className="wrap">
              <div className="section-head">
                <h2 id="homes-h">Homes on the market now</h2>
                <p>Our newest homes for sale and to let, each one handled from the branch.</p>
              </div>
              <div className="grid">
                {homes.map((p) => (
                  <a key={p.id} className="tile span-4" href={`/properties/${slugFor(p)}`}>
                    <div className="tile__media"><img src={p.cover!.url} alt={`${displayAddressFor(p)}, from outside`} loading="lazy" data-source="client" data-subject="a home we are selling or letting" /></div>
                    <div className="tile__head"><h3>{displayAddressFor(p)}</h3><span className="tile__price">{priceLabel(p)}</span></div>
                    <p className="tile__facts">{[p.bedrooms ? `${p.bedrooms} bed` : null, labelFor(PROPERTY_TYPES, p.propertyType), p.channel === 'let' ? 'To let' : 'For sale'].filter(Boolean).join(' · ')}</p>
                  </a>
                ))}
              </div>
              <p className="front-more"><a className="link" href="/properties">See homes for sale</a></p>
            </div>
          </section>
        ) : null}

        <section className="section g2m" id="story" aria-labelledby="story-h">
          <div className="wrap grid grid--top">
            <div className="span-6">
              <div className="section-head">
                <h2 id="story-h">On Preston Road since 2004</h2>
                <p>Agencies have opened, rebranded and closed along Preston Road. We have kept the same door and the same owner.</p>
              </div>
              <ul className="rows">
                <li><span className="rows__name">2004</span><p>Jamil Ahmed opens the branch on Preston Road, independent and locally owned.</p></li>
                <li><span className="rows__name">2010s</span><p>Sales, lettings and full management brought under one roof.</p></li>
                <li><span className="rows__name">2024</span><p>Twenty years in business on the same parade.</p></li>
                <li><span className="rows__name">Today</span><p>Still independent, still at the same address, open six days a week.</p></li>
              </ul>
            </div>
            <figure className="develop span-6 start-7" data-moment="picture-develops">
              <img src="/video/preston-road-poster.jpg" alt="The shops on Preston Road beside the Metropolitan Railway station entrance in about 1960, with cars and shoppers" width={1280} height={720} loading="lazy" data-source="client" data-subject="Preston Road in about 1960" />
            </figure>
          </div>
        </section>

        <section className="section ground-inverse" id="people" style={{ '--hm': 2 } as CSSProperties} aria-labelledby="people-h">
          <div className="wrap grid grid--top">
            <div className="span-6">
              <div className="section-head">
                <h2 id="people-h">Jamil Ahmed runs the branch</h2>
                <p>Jamil worked in London property for years before opening Preston Hill Estates in 2004. He takes on the difficult sales and the awkward lets himself, and is in the branch most working days.</p>
              </div>
              <figure className="quote">
                <blockquote>Never back away from a challenge. Whatever it takes, every client leaves this office with a smile.</blockquote>
                <figcaption className="person"><span><span className="person__name">Jamil Ahmed</span><span className="person__role">Founder, Preston Hill Estates</span></span></figcaption>
              </figure>
              {review ? (
                <figure className="quote front-review">
                  <blockquote>{review.text}</blockquote>
                  <figcaption className="person"><span className="front-initial" aria-hidden="true">{review.name[0]?.toUpperCase()}</span><span><span className="person__name">{review.name}</span><span className="person__role">{[rated ?? 'Google review', review.date].filter(Boolean).join(' · ')}</span></span></figcaption>
                </figure>
              ) : null}
            </div>
            <div className="frame frame--photo span-6 start-7 front-portrait">
              <img className="frame__img" src="/img/founder.jpg" alt="Jamil Ahmed, founder of Preston Hill Estates" loading="lazy" data-source="client" data-subject="the founder" />
            </div>
          </div>
        </section>

        {areas.length ? (
          <section className="section" id="prices" style={{ '--hm': 2 } as CSSProperties} aria-labelledby="prices-h">
            <div className="wrap">
              <div className="section-head">
                <h2 id="prices-h">House prices near you</h2>
                <p>{market!.count.toLocaleString('en-GB')} homes sold in the districts we cover in the last 12 months. The typical price in each:</p>
              </div>
              <div className="grid grid--top">
                {[areas.slice(0, Math.ceil(areas.length / 2)), areas.slice(Math.ceil(areas.length / 2))].map((col, i) => (
                  <ul key={i} className={`rows span-6${i ? ' start-7' : ''}`}>
                    {col.map((a) => (
                      <li key={a.outward}><span className="rows__name"><a className="link" href={`/sold-prices?postcode=${a.outward}`}>{a.outward}, {AREA_NAMES[a.outward] ?? ''}</a></span><p>{a.count.toLocaleString('en-GB')} sales</p><span className="rows__value">{gbp(a.median!)}</span></li>
                    ))}
                  </ul>
                ))}
              </div>
              <form className="front-search" action="/sold-prices" method="get">
                <div className="field"><label htmlFor="q-postcode">Your postcode</label><input id="q-postcode" name="postcode" type="text" autoComplete="postal-code" inputMode="text" /></div>
                <button className="btn btn--secondary" type="submit">See sold prices</button>
                <p className="form__status" role="status" data-form-status></p>
              </form>
              <p className="front-note">{LR_CREDIT}</p>
            </div>
          </section>
        ) : null}

        <section className="section" id="valuation" style={{ '--hm': 2 } as CSSProperties} aria-labelledby="valuation-h">
          <div className="wrap grid grid--top">
            <div className="span-6 front-form">
              <div className="section-head">
                <h2 id="valuation-h">Book a free valuation</h2>
                <p>Tell us where the home is and we call you within one working day to arrange a time. The valuation is free, with no obligation.</p>
              </div>
              <form id="valuation-form" className="form" action="/api/public/valuation" method="post" data-endpoint="/api/public/valuation" data-sent="Your valuation request is in. We call you within one working day." data-failed="Not sent: the connection failed. Your details are still here; try again, or call us on 020 8904 9005." noValidate>
                <div className="field"><label htmlFor="f-name">Your name</label>
                  <input id="f-name" name="name" type="text" autoComplete="name" required maxLength={120} aria-describedby="f-name-err" />
                  <p className="field__error" id="f-name-err" hidden>Write your name.</p></div>
                <div className="field"><label htmlFor="f-phone">Phone</label>
                  <input id="f-phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" required pattern="[0-9+() \-]{7,20}" aria-describedby="f-phone-err" />
                  <p className="field__error" id="f-phone-err" hidden>Write a phone number we can call, like 07700 900123.</p></div>
                <div className="field"><label htmlFor="f-postcode">Postcode of the home</label>
                  <input id="f-postcode" name="postcode" type="text" autoComplete="postal-code" required pattern="[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}" aria-describedby="f-postcode-err" />
                  <p className="field__error" id="f-postcode-err" hidden>Write the full postcode, like HA3 0PS.</p></div>
                <div className="field"><label htmlFor="f-intent">Selling or letting</label>
                  <select id="f-intent" name="intent" defaultValue="selling"><option value="selling">Selling</option><option value="letting">Letting</option><option value="unsure">Not sure yet</option></select></div>
                <div className="field front-check"><label htmlFor="f-consent-email"><span>Email me new homes and local prices (unsubscribe any time).</span><input id="f-consent-email" name="consent_email" type="checkbox" /></label></div>
                <div className="field front-check"><label htmlFor="f-consent-wa"><span>WhatsApp me about my enquiry (reply STOP to stop).</span><input id="f-consent-wa" name="consent_whatsapp" type="checkbox" /></label></div>
                <input type="hidden" name="magnet" value="home-valuation" />
                <input type="text" name="hp_check" tabIndex={-1} autoComplete="off" aria-hidden="true" className="front-hp" />
                <AttributionField />
                <div className="btn-row"><button className="btn btn--primary" type="submit">Book a free valuation</button></div>
                <p className="form__status" role="status" data-form-status></p>
                <p className="t-small muted">We use your details to arrange the valuation. <a className="link" href="/privacy">Privacy policy</a></p>
              </form>
              <ValuationHandoff />
            </div>
            <div className="span-6 start-7" id="visit">
              <figure className="front-arch">
                <img src="/video/wembley-first.jpg" alt="The Wembley arch at sunset over the roofs of north-west London" loading="lazy" data-source="client" data-subject="the area we cover" />
              </figure>
              <div className="visit front-visit">
                <div className="visit__cols">
                  <div className="visit__col stack-4">
                    <address className="visit__address">271 Preston Road<br />Harrow, Middlesex</address>
                    <p><a className="link" href="https://www.openstreetmap.org/search?query=271%20Preston%20Road%2C%20Harrow" target="_blank" rel="noopener noreferrer">Get directions</a></p>
                    <p><a className="link" href={TEL}>Call {PHONE}</a></p>
                  </div>
                  <div className="visit__col">
                    <dl className="hours" data-tz="Europe/London"><dt data-days="mon-fri">Mon to Fri</dt><dd>9.00 to 17.30</dd><dt data-days="sat">Sat</dt><dd>10.00 to 13.00</dd><dt data-days="sun">Sun</dt><dd>Closed</dd></dl>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer closing footer--dark ground-inverse" id="contact" aria-labelledby="close-h">
        <div className="wrap">
          <div className="closing__cta close--type">
            <div className="section-head">
              <h2 id="close-h">Book a free valuation</h2>
              <p>Monday to Friday 9.00 to 17.30, Saturday 10.00 to 13.00. Free, with no obligation.</p>
            </div>
            <a className="btn btn--primary btn--xl btn--wide" href="#valuation">Book a free valuation<Arrow /></a>
          </div>
          <div className="closing__links">
            <div className="grid">
              <div className="span-4 stack-4">
                <Logo />
                <p className="footer__lede">Independent estate agents at 271 Preston Road, Harrow, since 2004. <a href={TEL}>{PHONE}</a> · <a href="mailto:info@prestonhillestates.com">info@prestonhillestates.com</a></p>
              </div>
              <div className="span-2 footer__col"><h3>Homes</h3><ul><li><a href="/properties">For sale and to let</a></li><li><a href="/sold-prices">Sold prices</a></li><li><a href="/renting">Renting with us</a></li><li><a href="/mortgage-calculator">Mortgage calculator</a></li></ul></div>
              <div className="span-2 footer__col"><h3>Owners</h3><ul><li><a href="/sell">Selling</a></li><li><a href="/landlords">Letting</a></li><li><a href="/fees">Fees</a></li><li><a href="/valuation">Online valuation</a></li></ul></div>
              <div className="span-2 footer__col"><h3>Areas</h3><ul><li><a href="/areas">Areas we cover</a></li><li><a href="/guides">Guides</a></li></ul></div>
              <div className="span-2 footer__col"><h3>Schemes</h3><ul>{ACCREDITATIONS.map((a) => <li key={a.key}><a href={a.cert} download>{a.name}</a></li>)}</ul></div>
            </div>
            <div className="footer__legal">
              <span>&copy; 2026 Preston Hill Estates · Company No. 05058532 &nbsp; <a href="/privacy">Privacy</a></span>
            </div>
          </div>
        </div>
      </footer>
      <nav className="actionbar" aria-label="Quick actions">
        <a className="btn btn--primary" href="#valuation">Book a free valuation</a>
      </nav>
    </>
  )
}
