import Link from 'next/link'
import { Fragment } from 'react'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { batchView } from '@/lib/postal-letters'
import { LogoMark } from '@/components/Logo'
import { markPostedAction } from '../../postal-actions'
import { PrintButton } from './PrintButton'
import { LR_CREDIT } from '@/lib/sold-prices'
import './letters.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Valuation letters to print' }

// The back of each letter: how we'll sell (or let) their home, the same steps as their property report.
const SALE_STEPS: [string, string, string, string][] = [
  ['price', 'Agree the price and the plan', 'The asking price, the best time to launch, and anything worth doing first.', 'Your free visit'],
  ['camera', 'Prepare your home', 'Photographs and floorplans, a description written by us, the EPC and paperwork in order.', 'Week 1'],
  ['launch', 'Launch everywhere at once', 'Zoopla, OnTheMarket, our website, our window on Preston Road, and buyers already registered with us.', 'Week 1 to 2'],
  ['people', 'Viewings by our own team', 'We show every buyer round and tell you what they thought.', 'From launch'],
  ['shield', 'Offers, properly checked', 'We check each buyer’s mortgage, deposit and chain before an offer reaches you, and negotiate the best price.', 'When it’s right'],
  ['key', 'Through to completion', 'We keep the solicitors, the buyer and the chain moving, and keep you updated until the keys change hands.', 'Completion'],
]
const LET_STEPS: [string, string, string, string][] = [
  ['price', 'Agree the rent and the plan', 'What rent to expect, anything that needs doing first, and when it can be ready.', 'Your free visit'],
  ['camera', 'Get it ready to let', 'Photographs and a description written by us, and the EPC, gas safety and electrical reports in order.', 'Week 1'],
  ['launch', 'Marketed everywhere at once', 'Zoopla, OnTheMarket, our website, our window on Preston Road, and tenants already registered with us.', 'Week 1 to 2'],
  ['people', 'Viewings by our own team', 'We show every applicant round ourselves and tell you what they thought.', 'From launch'],
  ['shield', 'Tenant found and referenced', 'Identity, Right to Rent, income, previous landlords and credit, before anyone moves in.', 'When it’s right'],
  ['key', 'Fully managed from then on', 'Deposit registered, rent collected and paid to you, repairs arranged and the rules kept right.', 'Every month'],
]
const ICONS: Record<string, string> = {
  price: '<path d="M4 12l8-8h7v7l-8 8z"/><circle cx="15.5" cy="8.5" r="1.4"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7l1.6-2.5h3.8L15.5 7"/><circle cx="12" cy="13.5" r="3.6"/>',
  launch: '<path d="M12 3c3.5 2.2 5 6 5 10l-2.5 3h-5L7 13c0-4 1.5-7.8 5-10z"/><circle cx="12" cy="10" r="1.8"/><path d="M9.5 16l-2 4M14.5 16l2 4"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.6 3-5.6 6-5.6s5.4 2 6 5.6"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.5c2.5.2 4 1.9 4.5 4.6"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.4 2.4 4.6-4.8"/>',
  key: '<circle cx="8" cy="15" r="4.2"/><path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>',
}

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })

/** A batch of valuation letters, one A4 sheet each (printed double-sided): outside the portal's frame so it prints cleanly. */
export default async function LettersPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ posted?: string }> }) {
  await requireAdmin()
  const { id } = await params
  const sp = await searchParams
  const b = await batchView(id)
  if (!b) notFound()
  const date = today()
  return (
    <div className="pl-page">
      <div className="pl-bar">
        <Link href="/admin/valuation-letters">← Valuation letters</Link>
        <span><b>{b.letters.length} letter{b.letters.length === 1 ? '' : 's'}</b> · signed by {b.sender}{b.postedAt ? ' · posted' : ''}</span>
        <PrintButton />
        {b.postedAt
          ? <span className="pl-done">{sp.posted ? `Noted on ${sp.posted} lead${sp.posted === '1' ? '' : 's'}.` : 'Marked as posted.'}</span>
          : <form action={markPostedAction}><input type="hidden" name="batch" value={b.id} /><button className="pl-btn ghost" type="submit">They’re in the post</button></form>}
        <p>Print <b>double-sided</b> (flip on the long edge) on plain A4, with “Background graphics” on and margins set to none. Fold in three, address side out, into a DL window envelope.</p>
        {(() => {
          // Each letter's QR code opens their report and prints its guide price: flag any that aren't ready.
          const why = (st: (typeof b.letters)[number]['reportState']) => st.state === 'none' ? 'no OnTheMarket guide uploaded' : st.state === 'draft' ? 'report not finalised' : st.stale ? `OnTheMarket guide from ${st.madeOn!.split('-').reverse().join('/')}, over 3 months old` : null
          const bad = b.letters.map((l) => ({ l, why: why(l.reportState) })).filter((x) => x.why)
          return bad.length ? (
            <div className="pl-flags">
              <b>Check before printing: {bad.length} of {b.letters.length} {b.letters.length === 1 ? 'letter has' : 'letters have'} a property report that isn’t ready.</b> Its QR code would open a report without our guide price, or one from an old guide.
              <ul>{bad.map(({ l, why }) => <li key={l.id}><Link href={`/admin/booklet/${l.enquiryId}`} target="_blank">{l.name}</Link>: {why}</li>)}</ul>
              <small>Finalise the report (upload the latest OnTheMarket guide, set the guide price) and reload this page: the letter picks up the price.</small>
            </div>
          ) : <p className="pl-ok">✓ Every letter’s property report is finalised from an up-to-date OnTheMarket guide.</p>
        })()}
      </div>
      {b.letters.map((l) => {
        const f = l.facts
        const gbp = (n: number) => `£${n.toLocaleString('en-GB')}`
        const pcm = f.guide?.rent ? ' pcm' : ''
        const what = l.letting ? 'let' : 'sell'
        // Longer words than the starting ones are set a little smaller, so the letter always fits its page.
        const chars = [...l.before, ...l.after].join(' ').length
        const fit = chars > 1050 ? ' pl-fit3' : chars > 900 ? ' pl-fit2' : chars > 760 ? ' pl-fit1' : ''
        return (
          <Fragment key={l.id}>
            {/* Front: the letter, their guide price and the QR code to their report */}
            <article className={`pl-letter${fit}`}>
              <header className="pl-head">
                <div className="pl-brand"><LogoMark /><span><b>PRESTON HILL</b><i>ESTATES</i></span></div>
                <div className="pl-office">271 Preston Road, Harrow HA3 0PS<br />020 8904 9005 · WhatsApp 07745 203146<br />info@prestonhillestates.com · prestonhillestates.com</div>
              </header>
              <div className="pl-return">Preston Hill Estates, 271 Preston Road, Harrow HA3 0PS</div>
              <address className="pl-to">{[l.name, ...l.lines].map((x, i) => <span key={i}>{x}</span>)}</address>
              <div className="pl-date">{date}</div>
              <div className="pl-body">
                <p className="pl-dear">Dear {l.first || 'Sir or Madam'},</p>
                {b.id.startsWith('follow-') ? <h2>Here whenever <em>you’re ready.</em></h2> : <h2>Thank you for <em>getting in touch.</em></h2>}
                {l.before.map((p, i) => <p key={`b${i}`}>{p}</p>)}
                <div className="pl-offer">
                  {f.guide ? (
                    <div className="pl-price">
                      <div className="k">Our guide {f.guide.rent ? 'rent' : 'price'} for your home</div>
                      <div className="v">{gbp(f.guide.asking)}{pcm}</div>
                      {f.guide.low && f.guide.high ? <div className="r">Expected to {f.guide.rent ? 'let' : 'sell'} for <b>{gbp(f.guide.low)} – {gbp(f.guide.high)}{pcm}</b></div> : null}
                      <span className="tag">Final figure confirmed at our free visit</span>
                    </div>
                  ) : (
                    <div className="pl-facts">
                      <b className="pl-facts-h">{f.salesWhere === 'street' && f.street ? `On ${f.street}` : f.street ? `Around ${f.street}` : 'Near you'}</b>
                      {f.sales.length ? <ul>{f.sales.map((x, i) => <li key={i}><span>{x.where}<small>{x.when}</small></span><b>{gbp(x.price)}</b></li>)}</ul> : null}
                      {f.typical ? <p>Typical price of {f.typical.kind} {f.typical.where}, over the last 12 months: <b>{gbp(f.typical.price)}</b> ({f.typical.count} sales)</p> : null}
                      {f.wanting ? <p className="pl-want"><b>{f.wanting.count} {f.wanting.who}</b> have registered with us in the last year looking in {f.area ?? 'your area'}.</p> : null}
                      {!f.sales.length && !f.typical && !f.wanting ? <p>Your report has the latest prices around your road, and what {l.letting ? 'tenants' : 'buyers'} will love about where you live.</p> : null}
                    </div>
                  )}
                  <div className="pl-qr">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.qr} alt="" />
                    <b>Scan to open your report</b>
                    <span>Point your phone camera at the code</span>
                    <small>or type: {l.reportShort}</small>
                  </div>
                </div>
                <div className="pl-inside">
                  <div><b>Your home in detail</b>Size, tenure, energy rating and the checks {l.letting ? 'tenants' : 'buyers'} will ask about.</div>
                  <div><b>What it’s worth</b>{l.letting ? 'Our guide rent, and similar homes let close by.' : 'Our guide price, and similar homes sold close by.'}</div>
                  <div><b>How we’d {what} it</b>Our step-by-step plan, from valuation to {l.letting ? 'rent day' : 'keys'} (overleaf too).</div>
                </div>
                {l.after.map((p, i) => <p key={`a${i}`}>{p}</p>)}
                <p className="pl-sign">With warm regards,</p>
                <p className="pl-sig">{b.sender}</p>
                <p className="pl-who"><b>{b.sender}</b>, {/^jamil\b/i.test(b.sender) ? 'Founder, ' : ''}Preston Hill Estates</p>
              </div>
              <div className="pl-pto">How we’ll {what} your home <span>→</span></div>
              <footer className="pl-foot">You’re receiving this because you asked us about a valuation. If you’d rather we didn’t write again, just let us know.{f.sales.length || f.typical ? ` Sold prices: ${LR_CREDIT}` : ''}</footer>
            </article>
            {/* Back: how we'll sell (or let) their home */}
            <article className="pl-letter pl-back">
              <div className="pl-hero">
                <LogoMark className="pl-hero-mark" />
                <div className="k">{l.letting ? 'Letting with Preston Hill Estates' : 'Selling with Preston Hill Estates'}</div>
                <h2>How we’ll {what} <em>your home.</em></h2>
                <p>{l.letting
                  ? 'From the first visit to rent day and every month after, the same local team looks after you. We’ve been letting homes from Preston Road since 2004, and we’d love to look after yours.'
                  : 'From the first visit to the day the keys change hands, the same local team looks after you. We’ve been selling homes from Preston Road since 2004, and we’d love to sell yours.'}</p>
              </div>
              <div className="pl-steps">
                {(l.letting ? LET_STEPS : SALE_STEPS).map(([k, h, p, w], i) => (
                  <div key={h} className="pl-step"><div className="ic"><svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[k] }} /><span className="n">{i + 1}</span></div><div><h3>{h}</h3><p>{p}</p><small>{w}</small></div></div>
                ))}
              </div>
              <div className="pl-seen"><h4>Where {l.letting ? 'tenants' : 'buyers'} will see your home</h4>
                <div className="chips"><div><b>Zoopla</b>Listed in full</div><div><b>OnTheMarket</b>Listed in full</div><div><b>Our window</b>271 Preston Road</div><div><b>Our {l.letting ? 'tenants' : 'buyers'}</b>Emailed the day it launches</div></div>
              </div>
              <div className="pl-row2">
                <div className="pl-why"><h4>Why homeowners choose us</h4><ul>
                  <li><span><b>Local since 2004.</b> The same independent branch on Preston Road for over twenty years.</span></li>
                  <li><span><b>One team, start to finish.</b> The people who value your home are the people who {what} it.</span></li>
                  <li><span><b>Every viewing done by us.</b> Never left to you, and feedback after every one.</span></li>
                  <li><span><b>Regulated and protected.</b> The Property Ombudsman and client money protection through safeagent.</span></li>
                </ul></div>
                {l.review ? (
                  <div className="pl-review"><div className="q">“</div><div className="stars">★★★★★</div>
                    <blockquote>{l.review.text}</blockquote>
                    <cite><b>{l.review.name}</b> · Google review{l.review.date ? `, ${l.review.date}` : ''}</cite></div>
                ) : <div className="pl-review"><div className="q">“</div><blockquote>Read what our clients say: search “Preston Hill Estates Harrow” on Google.</blockquote></div>}
              </div>
              <div className="pl-cta"><div><h3>Book your free valuation</h3><p>About 30 minutes, at a time that suits you. No cost and no obligation.</p></div><div className="call">Call us on<b>020 8904 9005</b>or WhatsApp 07745 203146</div></div>
              <div className="pl-schemes"><span>Preston Hill Estates, 271 Preston Road, Harrow HA3 0PS. Members of The Property Ombudsman and safeagent.</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div><img src="/accreditations/tpo.png" alt="The Property Ombudsman" /><img src="/accreditations/safeagent.png" alt="safeagent" /><img src="/accreditations/prs.png" alt="Property Redress Scheme" /></div>
              </div>
            </article>
          </Fragment>
        )
      })}
    </div>
  )
}
