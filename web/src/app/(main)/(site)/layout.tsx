import Link from 'next/link'
import { LogoMark } from '@/components/Logo'
import { AccreditationLinks, PortalLinks } from '@/components/PortalLinks'
import { ValuationPopup } from '@/components/ValuationPopup'
import './site.css'

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="site-nav">
          <Link href="/" className="site-brand" aria-label="Preston Hill Estates home">
            <LogoMark />
            <span>
              <span className="w1">PRESTON HILL</span>
              <br />
              <span className="w2">ESTATES</span>
            </span>
          </Link>
          <nav className="site-links" aria-label="Main">
            <Link className="l" href="/properties?channel=sale">Buy</Link>
            <Link className="l" href="/properties?channel=let">Rent</Link>
            <a className="l" href="/renting">Tenants</a>
            <a className="l" href="/landlords">Landlords</a>
            <a className="l" href="/valuation">Free valuation</a>
            <a className="l" href="tel:+442089049005">020 8904 9005</a>
            <Link className="btn btn-gold" href="/properties">Search homes</Link>
          </nav>
          {/* Phones and tablets: the links fold into a Menu button. */}
          <details className="mnav">
            <summary aria-label="Menu"><span className="mnav-bars" aria-hidden="true" /><span className="mnav-open">Menu</span><span className="mnav-close">Close</span></summary>
            <div className="mnav-panel">
              <div className="mnav-group"><b>Buying</b><a href="/properties?channel=sale">Homes for sale</a><a href="/mortgage-calculator">How much can I borrow?</a><a href="/sold-prices">Sold prices</a></div>
              <div className="mnav-group"><b>Renting</b><a href="/properties?channel=let">Homes to rent</a><a href="/renting">Register for new homes to rent</a></div>
              <div className="mnav-group"><b>Landlords</b><a href="/landlords">Letting &amp; management</a><a href="/landlords#estimate">Rent estimate</a><a href="/fees">Fees &amp; legal</a></div>
              <div className="mnav-group"><b>Selling</b><a href="/valuation">Free valuation</a><a href="/guides">Guides</a></div>
              <div className="mnav-cta"><a className="btn btn-gold" href="/valuation">Free valuation</a><a className="btn btn-ghost" href="tel:+442089049005">Call 020 8904 9005</a></div>
            </div>
          </details>
        </div>
      </header>
      <main className="site-main">{children}</main>
      <section className="portals-band" aria-labelledby="portals-heading">
        <div className="wrap portals-inner">
          <div>
            <h2 id="portals-heading">Find all our homes on Zoopla and OnTheMarket</h2>
            <p>Every Preston Hill listing also appears on the major property portals.</p>
          </div>
          <PortalLinks />
        </div>
      </section>
      <footer className="site-footer">
        <div className="wrap">
          <div className="cols">
            <div>
              <h4>The branch</h4>
              <p>271 Preston Road, Harrow HA3 0PS<br />Monday to Friday 9.00 to 17.30 · Saturday 10.00 to 13.00</p>
              <p style={{ marginTop: 8 }}><a href="tel:+442089049005">020 8904 9005</a> · <a href="mailto:info@prestonhillestates.com">info@prestonhillestates.com</a></p>
            </div>
            <div>
              <h4>Property</h4>
              <p><Link href="/properties?channel=sale">For sale</Link><br /><Link href="/properties?channel=let">To let</Link><br /><a href="/renting">Register as a tenant</a><br /><a href="/landlords">Landlords</a></p>
            </div>
            <div>
              <h4>Accredited</h4>
              <AccreditationLinks />
            </div>
          </div>
          <div className="legal">
            <span>© {new Date().getFullYear()} Preston Hill Estates · Company No. 05058532</span>
            <span>Independent estate agents since 2004</span>
          </div>
        </div>
      </footer>
      <ValuationPopup />
    </>
  )
}
