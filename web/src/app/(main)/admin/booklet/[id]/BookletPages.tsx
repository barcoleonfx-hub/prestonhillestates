import { LETTINGS } from '@/lib/site'
import { gbp, type BookletComp, type BookletFields, type BookletInput } from '@/lib/booklet'

// The printed booklet: eight A4 pages. Shared by the live preview and the printout, so what staff see is what prints.

const YEARS = new Date().getFullYear() - 2004
const paras = (t: string) => t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
const price = (c: BookletComp) => `${gbp(c.price)}${c.rent ? ' pcm' : ''}`

function Foot({ n }: { n: number }) {
  return <div className="bk-foot"><span>Preston Hill Estates</span><span>{n}</span></div>
}

function Strip({ prices, rent }: { prices: number[]; rent: boolean }) {
  if (prices.length < 3) return null
  const s = [...prices].sort((a, b) => a - b)
  const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  const step = rent ? 250 : 50000
  const min = Math.floor((s[0] - step * 0.6) / step) * step, max = Math.ceil((s[s.length - 1] + step * 0.6) / step) * step
  const X = (p: number) => 30 + ((p - min) / (max - min || 1)) * 600
  const ticks: number[] = []
  for (let t = min; t <= max; t += step) ticks.push(t)
  const every = Math.ceil(ticks.length / 9)
  const q1 = s[Math.floor((s.length - 1) * 0.25)], q3 = s[Math.ceil((s.length - 1) * 0.75)]
  const label = (n: number) => (rent ? `£${n.toLocaleString('en-GB')}` : `£${Math.round(n / 1000)}k`)
  const midText = rent ? `£${Math.round(mid / 25) * 25} pcm` : gbp(Math.round(mid / 1000) * 1000)
  return (
    <svg viewBox="0 0 660 104" width="100%" className="bk-strip" aria-hidden="true">
      <line x1="30" y1="70" x2="630" y2="70" stroke="#D9D2BD" strokeWidth="2" />
      {ticks.map((t, i) => (
        <g key={t}><line x1={X(t)} y1="64" x2={X(t)} y2="76" stroke="#CFC7AE" />{i % every === 0 ? <text x={X(t)} y="96" textAnchor="middle" fontSize="11" fill="#98937F">{label(t)}</text> : null}</g>
      ))}
      <rect x={X(q1)} y="58" width={Math.max(X(q3) - X(q1), 6)} height="24" rx="12" fill="#C4972F" opacity=".18" />
      {s.map((p, i) => <circle key={i} cx={X(p)} cy="70" r="7" fill="#23211A" stroke="#fff" strokeWidth="2" />)}
      <line x1={X(mid)} y1="34" x2={X(mid)} y2="62" stroke="#A47B1D" strokeWidth="2" />
      <text x={Math.min(Math.max(X(mid), 120), 540)} y="26" textAnchor="middle" fontSize="12" fontWeight="700" fill="#A47B1D">Middle of the market: {midText}</text>
    </svg>
  )
}

export function BookletPages({ data, f }: { data: BookletInput; f: BookletFields }) {
  const rent = f.kind === 'lettings'
  const hidden = new Set(f.hide)
  const evidence = data.comps.filter((c) => c.group === 'evidence' && !hidden.has(c.key)).slice(0, 6)
  const market = data.comps.filter((c) => c.group === 'market' && !hidden.has(c.key)).slice(0, 4)
  const [big, ...small] = data.reviews
  const feature = big && big.text.length >= 80 ? big : null
  const shorts = (feature ? small : data.reviews).slice(0, 3)

  return (
    <div className="bk">
      {/* 1. Cover */}
      <section className="bk-page bk-cover">
        <div className="bk-cover-photo" />
        <div className="bk-band">
          <div className="bk-kicker gold2">{rent ? 'Your rental valuation' : 'Your valuation'} · Preston Hill Estates · Est. 2004</div>
          <h1>{rent ? <>Your property,<br /><em>let properly.</em></> : <>Your home,<br /><em>valued properly.</em></>}</h1>
          <div className="bk-for">
            <div><b>Prepared for</b><span>{f.forName || ' '}</span></div>
            <div><b>{rent ? 'Your property' : 'Your home'}</b><span>{f.home || ' '}</span></div>
            <div><b>{f.visit ? 'Visit' : 'Prepared'}</b><span>{f.visit || data.prepared}</span></div>
          </div>
        </div>
      </section>

      {/* 2. Welcome */}
      <section className="bk-page bk-welcome">
        <div className="bk-portrait" />
        <div className="bk-in">
          <div className="bk-letter">
            <div className="bk-kicker">A welcome from our founder</div>
            <h2>Thank you for<br />inviting us <em>in.</em></h2>
            <p className="bk-dear">{f.greeting}</p>
            {paras(f.letter).map((p, i) => <p key={i}>{p}</p>)}
            <div className="bk-sig">Jamil Ahmed</div>
            <p className="bk-sig-sub">Founder · 35+ years in property</p>
          </div>
        </div>
        <div className="bk-pull">“Never back away from a challenge. Whatever it takes, every client leaves this office with a smile.”<small>JAMIL AHMED, FOUNDER</small></div>
        <div className="bk-stats">
          <div><b>{YEARS}</b><span>years on Preston Road</span></div>
          <div><b>35+</b><span>years’ experience,<br />led by our founder</span></div>
          {data.google.rating && data.google.count
            ? <div><b>{data.google.rating.toFixed(1)}★</b><span>from {data.google.count}<br />Google reviews</span></div>
            : <div><b>3</b><span>places {rent ? 'tenants' : 'buyers'} look: Zoopla,<br />OnTheMarket and our website</span></div>}
        </div>
        <Foot n={2} />
      </section>

      {/* 3. Who we are */}
      <section className="bk-page">
        <div className="bk-in">
          <div className="bk-kicker">Who we are</div>
          <h2>Part of Preston Road,<br /><em>not just on it.</em></h2>
          <div className="bk-tn">
            <figure><img src="/img/preston-road-then.jpg" alt="" /><figcaption>Preston Road, then</figcaption></figure>
            <figure><img src="/img/preston-road-today.jpg" alt="" /><figcaption>And today</figcaption></figure>
          </div>
          <p className="bk-intro">Our branch is on the parade by Preston Road station. We work here every day, so we know which roads {rent ? 'tenants' : 'buyers'} ask for, what {rent ? 'rents homes like yours achieve' : 'homes like yours really sell for'}, and who is ready to move now.</p>
          <div className="bk-pillars">
            <div><i>1</i><h3>Local since 2004</h3><p>{YEARS} years selling and letting homes in HA3 and HA9: we know what {rent ? 'lets' : 'sells'}, street by street.</p></div>
            <div><i>2</i><h3>Founder-led, start to finish</h3><p>The person who values your {rent ? 'property' : 'home'} stays with you. No call centre, no being passed around.</p></div>
            <div><i>3</i><h3>Honest figures</h3><p>{rent ? 'A rent backed by what similar homes actually let for' : 'A price backed by real sold prices from HM Land Registry'}, not a number to win your instruction.</p></div>
            {rent
              ? <div><i>4</i><h3>We look after it</h3><p>Rent collected, repairs arranged, and the paperwork and the new rules kept right.</p></div>
              : <div><i>4</i><h3>We do the viewings</h3><p>Every buyer is shown round by our own team, and you hear what they thought.</p></div>}
          </div>
        </div>
        <Foot n={3} />
      </section>

      {/* 4. Their home in today's market */}
      <section className="bk-page">
        <div className="bk-in bk-tight">
          <div className="bk-kicker">{rent ? 'Your property in today’s market' : 'Your home in today’s market'}</div>
          <h2>{rent ? <>What similar homes<br /><em>are letting for.</em></> : <>What similar homes<br /><em>are selling for.</em></>}</h2>
          <div className="bk-prep">
            <div><b>{rent ? 'Your property' : 'Your home'}</b><span>{f.home || '—'}</span></div>
            {data.compsWhere ? <div><b>Compared with</b><span>{data.compsWhere}</span></div> : null}
            <div><b>Prepared</b><span>{data.prepared}</span></div>
          </div>
          <div className="bk-h3">{rent ? 'Rents nearby' : 'Recently sold nearby'}<small>{[...new Set(evidence.map((c) => c.source))].join(' · ').toUpperCase()}</small></div>
          {evidence.length ? (
            <>
              <Strip prices={evidence.map((c) => c.price)} rent={rent} />
              <table className="bk-sold"><tbody>
                {evidence.map((c) => (
                  <tr key={c.key}><td>{c.where}</td><td>{c.what}</td><td>{c.metres != null ? (c.metres < 1000 ? `${c.metres} m away` : `${(c.metres / 1000).toFixed(1)} km away`) : ''}</td><td className="p">{price(c)}</td></tr>
                ))}
              </tbody></table>
            </>
          ) : data.estimate ? null : <p className="bk-empty">We’ll bring the latest {rent ? 'rents' : 'sales'} for your street to the visit.</p>}
          {data.estimate ? (
            <div className="bk-est"><b>Typical {data.estimate.rent ? 'rent' : 'price'} nearby</b><span>{gbp(data.estimate.low)} to {gbp(data.estimate.high)}{data.estimate.rent ? ' a month' : ''}</span><small>{data.estimate.basis}</small></div>
          ) : null}
          {market.length ? (
            <>
              <div className="bk-h3">On the market now<small>{rent ? 'SIMILAR HOMES TO RENT' : 'SIMILAR HOMES FOR SALE'} · {[...new Set(market.map((c) => c.source))].join(' · ').toUpperCase()}</small></div>
              <table className="bk-sold bk-market"><tbody>
                {market.map((c) => <tr key={c.key}><td>{c.where}</td><td>{c.what}</td><td /><td className="p">{price(c)}</td></tr>)}
              </tbody></table>
              <p className="bk-src">{rent ? 'Asking rents' : 'Asking prices'}: what owners hope for, not what has been agreed.</p>
            </>
          ) : null}
          <div className="bk-figure">
            <div><b>{rent ? 'Expected rent' : 'Our valuation'}</b><div className="bk-write">{f.figure}</div></div>
            <div><b>{rent ? 'Suggested asking rent' : 'Suggested asking price'}</b><div className="bk-write">{f.asking}</div></div>
            <p>Size, condition, any extensions and the exact street all make a difference: that’s what today’s visit is for. We’ll confirm our figure by email, with the evidence.</p>
          </div>
        </div>
      </section>

      {/* 5. The plan */}
      <section className="bk-page">
        <div className="bk-in">
          <div className="bk-kicker">{rent ? 'How letting with us works' : 'How we’ll sell your home'}</div>
          <h2>{rent ? <>From valuation<br /><em>to rent day.</em></> : <>From valuation<br /><em>to keys.</em></>}</h2>
          <div className="bk-tl">
            {(rent ? [
              ['Agree the rent and the plan', 'What rent to expect, what (if anything) needs doing first, and when it can be ready.', 'Today'],
              ['Get it ready to let', 'Photos and a description written by us, and the EPC, gas safety certificate and electrical report in order.', 'Week 1'],
              ['Marketed everywhere at once', 'Live on Zoopla, OnTheMarket and our own website, in our window on Preston Road, and straight to tenants already registered with us.', 'Week 1–2'],
              ['Viewings by our own team', 'We show every applicant round ourselves and tell you what they thought.', 'From launch'],
              ['Tenant found and referenced', 'Identity, Right to Rent, income, previous landlords and credit, before anyone moves in.', 'When it’s right'],
              ['Fully managed from then on', 'Deposit registered with myDeposits, rent collected and paid to you, repairs arranged and the new rules kept right.', 'Every month'],
            ] : [
              ['Agree the price and the plan', 'The asking price, the right time to launch, and what (if anything) is worth doing first.', 'Today'],
              ['Prepare your home', 'Photos and floorplans, a description written by us, and the EPC and paperwork put in order.', 'Week 1'],
              ['Launch everywhere at once', 'Live on Zoopla, OnTheMarket and our own website, in our window on Preston Road, and emailed to buyers already registered with us.', 'Week 1–2'],
              ['Viewings by our own team', 'We show every buyer round and tell you what they thought, so you always know where you stand.', 'From launch'],
              ['Offers, properly checked', 'We check each buyer’s position (mortgage, deposit, any home to sell) before we put an offer to you, and negotiate the best price.', 'When it’s right'],
              ['Through to completion', 'We keep the solicitors, the buyer and the chain moving, and keep you updated until the keys change hands.', 'Completion'],
            ]).map(([h, p, w], i) => (
              <div className="bk-step" key={h}><div className="n">{i + 1}</div><div><h3>{h}</h3><p>{p}</p></div><div className="when">{w}</div></div>
            ))}
          </div>
        </div>
        <div className="bk-where">
          <div><b>Zoopla</b><span>Listed</span></div><div><b>OnTheMarket</b><span>Listed</span></div><div><b>Our website</b><span>prestonhillestates.com</span></div><div><b>Our window</b><span>271 Preston Road</span></div>
        </div>
        <Foot n={5} />
      </section>

      {/* 6. Reviews */}
      <section className="bk-page">
        <div className="bk-in">
          <div className="bk-kicker">What our clients say</div>
          <h2>Don’t just take<br /><em>our word for it.</em></h2>
          {feature ? (
            <div className="bk-big"><div className="bk-stars">{'★'.repeat(feature.rating)}</div><q>{feature.text}</q><div className="who"><b>{feature.name}</b>{feature.date ? ` · ${feature.date}` : ''} · Google review</div></div>
          ) : null}
          {shorts.length ? (
            <div className="bk-small">
              {shorts.map((r) => <div key={r.name + r.text.slice(0, 10)}><div className="bk-stars sm">{'★'.repeat(r.rating)}</div><q>{r.text}</q><div className="who"><b>{r.name}</b>{r.date ? ` · ${r.date}` : ''}</div></div>)}
            </div>
          ) : null}
          <div className="bk-google"><div className="bk-stars">★</div><p>{data.google.rating && data.google.count ? <><b>Rated {data.google.rating.toFixed(1)} out of 5 from {data.google.count} reviews on Google.</b> </> : <b>Read every review on Google. </b>}Search “Preston Hill Estates Harrow”. We only ever show real reviews, word for word.</p></div>
        </div>
        <Foot n={6} />
      </section>

      {/* 7. Peace of mind */}
      <section className="bk-page">
        <div className="bk-in">
          <div className="bk-kicker">Peace of mind</div>
          <h2>Regulated, protected<br /><em>and straightforward.</em></h2>
          <div className="bk-logos"><div>The Property<br />Ombudsman</div><div><img src="/accreditations/safeagent.png" alt="safeagent" /></div><div>Property Redress<br />Scheme</div><div><img src="/accreditations/mydeposits.jpg" alt="myDeposits" /></div></div>
          <div className="bk-cols">
            {rent ? (
              <>
                <div><div className="bk-h3 top">Fully managed, all included</div><ul className="bk-ticks">{LETTINGS.includes.map(([t, d]) => <li key={t}><b>{t}</b>: {d.split('. ')[0].replace(/\.$/, '').replace(/^./, (x) => x.toLowerCase())}</li>)}</ul></div>
                <div><div className="bk-h3 top">The Renters’ Rights Act, handled</div><ul className="bk-ticks">
                  <li><b>No more Section 21</b>: tenancies roll on month to month; we make sure your paperwork stands up</li>
                  <li><b>Rent reviews</b> once a year, with the formal notice served correctly</li>
                  <li><b>Pets, bidding and the landlord database</b>: we handle the requests and the new rules</li>
                </ul>
                <div className="bk-h3">Good to have ready</div><ul className="bk-ticks">
                  <li>Gas safety certificate and EPC</li><li>Electrical safety report (EICR)</li><li>Keys for every door</li><li>Mortgage lender or freeholder consent to let</li>
                </ul></div>
              </>
            ) : (
              <>
                <div><div className="bk-h3 top">What’s included</div><ul className="bk-ticks">
                  <li><b>Free valuation</b>, with the evidence</li><li><b>Photos and floorplans</b></li><li><b>Zoopla, OnTheMarket</b> and our website</li><li><b>Every viewing</b> done by us</li><li><b>Offers checked</b> and negotiated</li><li><b>Your sale progressed</b> to completion</li>
                </ul></div>
                <div><div className="bk-h3 top">Good to have to hand</div><ul className="bk-ticks">
                  <li>Photo ID and proof of address</li><li>Your solicitor’s details, if you have one</li><li>Your EPC, if you have one</li><li>The lease, for a flat or maisonette</li><li>Planning or building control papers</li><li>Details of recent work: boiler, windows, rewiring, extensions</li>
                </ul></div>
              </>
            )}
          </div>
          <div className="bk-fee"><div><div className="bk-kicker">Our fee</div><p>{rent ? 'Fully managed. Confirmed in writing before we start.' : 'Agreed with you today and confirmed in writing before we start.'}</p></div><div>{f.fee ? <div className="bk-fee-text">{f.fee}</div> : <><div className="bk-write dark" /><p className="bk-src">Written in at the visit</p></>}</div></div>
        </div>
        <div className="bk-next">
          <div><i>1</i><h3>Today</h3><p>We look round, talk it through and answer your questions.</p></div>
          <div><i>2</i><h3>Straight after</h3><p>{rent ? 'Our rent figure by email, with the homes we compared it with.' : 'Our valuation by email, with the homes we compared it with.'}</p></div>
          <div><i>3</i><h3>When you’re ready</h3><p>{rent ? 'Say the word and we’ll start finding your tenant.' : 'Say the word and we’ll book your photos.'}</p></div>
        </div>
        <Foot n={7} />
      </section>

      {/* 8. Back cover */}
      <section className="bk-page bk-back">
        <div className="c">
          <div className="bk-kicker gold2">{rent ? 'Let’s get it let' : 'Let’s get you moving'}</div>
          <h2>Your local agent,<br /><em>since 2004.</em></h2>
          <div className="grid">
            <div><b>Visit us</b><span>271 Preston Road<br />Harrow HA3 0PS</span></div>
            <div><b>Call</b><span>020 8904 9005</span></div>
            <div><b>Online</b><span>prestonhillestates.com<br />info@prestonhillestates.com</span></div>
          </div>
          <div className="bk-mark">PRESTON HILL<span>ESTATES</span></div>
        </div>
      </section>
    </div>
  )
}
