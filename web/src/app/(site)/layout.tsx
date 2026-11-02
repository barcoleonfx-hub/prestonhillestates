import Link from 'next/link'
import { LogoMark } from '@/components/Logo'
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
            <a className="l" href="tel:+442081277001">020 8127 7001</a>
            <Link className="btn btn-gold" href="/properties">Search homes</Link>
          </nav>
        </div>
      </header>
      <main className="site-main">{children}</main>
      <footer className="site-footer">
        <div className="wrap">
          <div className="cols">
            <div>
              <h4>The branch</h4>
              <p>271 Preston Road, Harrow HA3 0PS<br />Monday to Friday 9.00 to 17.30 · Saturday 10.00 to 13.00</p>
              <p style={{ marginTop: 8 }}><a href="tel:+442081277001">020 8127 7001</a> · <a href="mailto:info@prestonhillestates.com">info@prestonhillestates.com</a></p>
            </div>
            <div>
              <h4>Property</h4>
              <p><Link href="/properties?channel=sale">For sale</Link><br /><Link href="/properties?channel=let">To let</Link></p>
            </div>
            <div>
              <h4>Accredited</h4>
              <p>The Property Ombudsman · PRS · safeagent · myDeposits</p>
            </div>
          </div>
          <div className="legal">
            <span>© {new Date().getFullYear()} Preston Hill Estates · Company No. 05058532</span>
            <span>Independent estate agents since 2004</span>
          </div>
        </div>
      </footer>
    </>
  )
}
