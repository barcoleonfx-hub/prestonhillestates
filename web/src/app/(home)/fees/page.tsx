import type { Metadata } from 'next'
import { ACCREDITATIONS, LETTINGS, feeText } from '@/lib/site'
import { PageChrome } from '../PageChrome'
import '../valuation/valuation.css'
import '../landlords/landlords.css'
import './fees.css'

export const metadata: Metadata = {
  title: 'Fees and legal information · Preston Hill Estates',
  description: 'Our lettings fees for landlords, what tenants can be charged, and our client money protection, redress and deposit schemes.',
}

// What a tenant can be asked to pay in England (Tenant Fees Act 2019). Anything else is banned.
const TENANT: [string, string][] = [
  ['Rent', 'As agreed in the tenancy.'],
  ['Holding deposit', 'Refundable. No more than 1 week’s rent, to reserve the property while referencing is done.'],
  ['Tenancy deposit', 'Refundable. No more than 5 weeks’ rent where the annual rent is under £50,000 (6 weeks if £50,000 or more). Protected with myDeposits.'],
  ['Changes to the tenancy', '£50 including VAT (or reasonable costs if higher) when you ask for a change, such as a change of sharer.'],
  ['Late rent', 'Interest at 3% above the Bank of England base rate, only once rent is more than 14 days late.'],
  ['Lost keys or security devices', 'The reasonable cost of replacing them, with evidence of the cost.'],
  ['Bills during the tenancy', 'Council tax, utilities, TV licence and phone and broadband, where the tenancy makes you responsible.'],
]

const byKey = (k: string) => ACCREDITATIONS.find((a) => a.key === k)

export default function FeesPage() {
  const tpo = byKey('tpo'), prs = byKey('prs'), safe = byKey('safeagent'), md = byKey('mydeposits')
  return (
    <PageChrome>
      <main className="vx fx" id="top">
        <section className="fx-hero">
          <div className="wide">
            <div className="label"><b>Fees &amp; legal</b></div>
            <h1 className="display">Our fees, <em>in plain English</em></h1>
            <p className="sub">Everything we charge landlords, what tenants can and can’t be asked to pay, and the schemes that protect you. All fees are shown including VAT.</p>
          </div>
        </section>

        <section className="wide fx-sect" aria-labelledby="ll-h">
          <h2 className="sect" id="ll-h">For <em>landlords</em></h2>
          <div className="fx-table">
            <div className="fx-row head"><span>Service</span><span>Fee</span></div>
            <div className="fx-row">
              <span><b>{LETTINGS.name}</b><small>{LETTINGS.includes.map(([t]) => t).join(' · ')}</small></span>
              <span><b>{feeText()}</b><small>Taken from the rent we collect. Nothing to pay up front.</small></span>
            </div>
          </div>
          <p className="fx-note">If you ask us for anything outside this service, we’ll tell you what it costs and agree it with you in writing before any work is done. <a href="/landlords">More about letting with us</a>.</p>
        </section>

        <section className="wide fx-sect" aria-labelledby="tn-h">
          <h2 className="sect" id="tn-h">For <em>tenants</em></h2>
          <p className="fx-note">Under the Tenant Fees Act 2019, these are the only payments a tenant can be asked for. We don’t charge tenants for viewings, referencing, tenancy agreements or check-in.</p>
          <div className="fx-table">
            <div className="fx-row head"><span>Payment</span><span>What it is</span></div>
            {TENANT.map(([t, d]) => <div key={t} className="fx-row"><span><b>{t}</b></span><span>{d}</span></div>)}
          </div>
        </section>

        <section className="wide fx-sect" aria-labelledby="pr-h">
          <h2 className="sect" id="pr-h">How you’re <em>protected</em></h2>
          <div className="lx-cards">
            <div className="lx-card"><h3>Client money protection</h3><p>Rent and other money we hold for clients is protected through {safe ? <a href={safe.url} target="_blank" rel="noopener noreferrer">safeagent</a> : 'safeagent'}. A copy of our certificate is available on request.</p></div>
            <div className="lx-card"><h3>Independent redress</h3><p>If you’re unhappy with our service and our complaints process hasn’t put it right, you can refer it to {tpo ? <a href={tpo.url} target="_blank" rel="noopener noreferrer">{tpo.name}</a> : 'The Property Ombudsman'}{prs ? <> or the <a href={prs.url} target="_blank" rel="noopener noreferrer">{prs.name}</a></> : null}.</p></div>
            <div className="lx-card"><h3>Deposit protection</h3><p>Tenancy deposits are registered with {md ? <a href={md.url} target="_blank" rel="noopener noreferrer">myDeposits</a> : 'myDeposits'}, a government-approved scheme, within 30 days of being paid.</p></div>
          </div>
          <p className="fx-note">Questions about any of this? Call the branch on <a href="tel:+442081277001">020 8127 7001</a> or email <a href="mailto:info@prestonhillestates.com">info@prestonhillestates.com</a>.</p>
        </section>
      </main>
    </PageChrome>
  )
}
