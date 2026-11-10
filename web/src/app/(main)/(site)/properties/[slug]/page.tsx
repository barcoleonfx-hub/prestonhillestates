import { Reviews } from '@/app/(home)/Reviews'
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { LogoMark } from '@/components/Logo'
import { FURNISHING, LET_TYPES, PROPERTY_TYPES, TENURES, labelFor } from '@/lib/options'
import {
  displayAddressFor, getPublishedByRef, headlineFor, priceLabel, refFromSlug, slugFor, statusLabel,
} from '@/lib/properties'
import { formatGBP } from '@/lib/util'
import { embedUrl } from '@/lib/video'
import { Gallery } from './Gallery'
import { EnquiryForm } from './EnquiryForm'
import { MortgageBox, PropertyNote } from './MoreTools'
import { LocalIntel, ValueBanner } from '@/components/LocalIntel'
import { districtOf } from '@/lib/areas'
import { listingArea } from '@/lib/listing-area'
import { distanceText } from '@/lib/geo'
import type { PlaceKind } from '@/lib/area-facts'
import { lrTypeFor, salesOnStreet } from '@/lib/sold-prices'
import { SoldCredit, SoldList, SoldStats } from '@/components/SoldList'
import '@/components/sold-prices.css'

export const dynamic = 'force-dynamic'

type Params = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await getPublishedByRef(refFromSlug((await params).slug))
  if (!p) return { title: 'Property not found' }
  const cover = p.media.find((m) => m.kind === 'photo' && m.isCover) ?? p.media.find((m) => m.kind === 'photo')
  const title = `${headlineFor(p)}, ${displayAddressFor(p)}`
  return {
    title,
    description: p.summary ?? undefined,
    openGraph: { title, description: p.summary ?? undefined, images: cover ? [cover.url] : undefined },
  }
}

/** The monthly repayment shown beside "Mortgage" before it's opened: 10% deposit, 4.5% over 25 years. */
const exampleMonthly = (price: number) => { const loan = price * 0.9, i = 0.045 / 12, n = 25 * 12; return (loan * i) / (1 - Math.pow(1 + i, -n)) }

const LOCAL_KIND: Record<PlaceKind, string> = { station: 'Stations', school: 'Schools', shop: 'Supermarkets', park: 'Parks', health: 'GP and pharmacy', gym: 'Gym' }

const icon = (d: string) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
const ICONS: Record<PlaceKind, React.ReactNode> = {
  station: icon('M7 3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM4 11h16M8 21l2-4M16 21l-2-4M8.5 14h.01M15.5 14h.01'),
  school: icon('M2 9l10-5 10 5-10 5L2 9zM6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6'),
  shop: icon('M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6M10 21h.01M17 21h.01'),
  park: icon('M12 22v-6M12 16c-3.9 0-7-2.7-7-6.5S8.1 2 12 2s7 3.7 7 7.5S15.9 16 12 16zM9 22h6'),
  health: icon('M12 21s-7-4.4-9.3-9A5.3 5.3 0 0 1 12 6.6 5.3 5.3 0 0 1 21.3 12C19 16.6 12 21 12 21zM12 10v5M9.5 12.5h5'),
  gym: icon('M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11'),
}

const EPC_BANDS: [string, string, string][] = [['A', '92+', '#008054'], ['B', '81–91', '#19B459'], ['C', '69–80', '#8DCE46'], ['D', '55–68', '#FFD500'], ['E', '39–54', '#FCAA65'], ['F', '21–38', '#EF8023'], ['G', '1–20', '#E9153B']]

/** The familiar A to G energy chart, with this home's current and potential ratings marked. */
function EpcChart({ current, potential }: { current: string; potential: string | null }) {
  const cur = current.toUpperCase(), pot = potential?.toUpperCase() ?? null
  return (
    <div className="epc" role="img" aria-label={`Energy rating ${cur}${pot ? `, potential ${pot}` : ''}`}>
      <div className="epc-head"><span /><b>Current</b><b>Potential</b></div>
      {EPC_BANDS.map(([band, range, colour], i) => (
        <div className="epc-row" key={band}>
          <span className="epc-bar" style={{ width: `${44 + i * 8}%`, background: colour, color: i >= 3 && i <= 4 ? '#23211A' : '#fff' }}><small>{range}</small><b>{band}</b></span>
          <span className="epc-mark">{cur === band ? <i style={{ background: colour, color: i >= 3 && i <= 4 ? '#23211A' : '#fff' }}>{band}</i> : null}</span>
          <span className="epc-mark">{pot === band ? <i style={{ background: colour, color: i >= 3 && i <= 4 ? '#23211A' : '#fff' }}>{band}</i> : null}</span>
        </div>
      ))}
    </div>
  )
}

export default async function PropertyPage({ params }: { params: Params }) {
  const { slug } = await params
  const p = await getPublishedByRef(refFromSlug(slug))
  if (!p) notFound()
  const canonical = slugFor(p)
  if (slug !== canonical) permanentRedirect(`/properties/${canonical}`)

  const address = displayAddressFor(p)
  const photos = p.media.filter((m) => m.kind === 'photo')
  // Land Registry sold prices for sales listings: the same street first, then the postcode sector.
  const [sold, area] = await Promise.all([
    p.channel !== 'let' && p.postcode ? salesOnStreet(p.street ?? p.addressLine1 ?? null, p.postcode, lrTypeFor(p.propertyType)).catch(() => null) : Promise.resolve(null),
    listingArea(p).catch(() => ({ home: null, stations: [], places: [], fromOsm: false })),
  ])
  const plans = p.media.filter((m) => m.kind === 'floorplan')
  const videos = p.media.filter((m) => m.kind === 'video')
  const epc = p.media.find((m) => m.kind === 'epc')
  const brochure = p.media.find((m) => m.kind === 'brochure')
  const embed = embedUrl(p.videoUrl)
  const isLet = p.channel === 'let'
  const paragraphs = (p.description || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)

  // Homes to rent: the weekly figure and the most a holding deposit can be (1 week's rent), as tenants compare them.
  const monthly = isLet && p.price ? (p.rentFrequency === 'pw' ? (p.price * 52) / 12 : p.rentFrequency === 'pa' ? p.price / 12 : p.price) : null
  const weekly = monthly ? `£${(Math.floor(((monthly * 12) / 52) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null
  const material: [string, string | null | undefined][] = [
    [isLet ? 'Rent' : 'Price', priceLabel(p)],
    ['Rent per week', weekly && (p.rentFrequency ?? 'pcm') !== 'pw' ? weekly : null],
    ['Holding deposit', weekly ? `Up to 1 week’s rent (${weekly}), refundable` : null],
    ['Tenure', labelFor(TENURES, p.tenure)],
    ['Lease remaining', p.leaseYearsRemaining != null ? `${p.leaseYearsRemaining} years` : null],
    ['Ground rent', p.groundRent != null ? `${formatGBP(p.groundRent)} a year` : null],
    ['Service charge', p.serviceCharge != null ? `${formatGBP(p.serviceCharge)} a year` : null],
    ['Council tax', p.councilTaxBand ? (p.councilTaxBand.length === 1 ? `Band ${p.councilTaxBand}` : p.councilTaxBand === 'exempt' ? 'Exempt' : 'To be confirmed') : null],
    ['EPC rating', p.epcCurrent ? `${p.epcCurrent}${p.epcPotential ? ` (potential ${p.epcPotential})` : ''}` : null],
    ['Deposit', isLet && p.deposit != null ? formatGBP(p.deposit) : null],
    ['Available from', isLet && p.availableFrom ? new Date(p.availableFrom).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null],
    ['Furnishing', isLet ? labelFor(FURNISHING, p.furnishing) : null],
    ['Let type', isLet ? labelFor(LET_TYPES, p.letType) : null],
    ['Minimum tenancy', isLet && p.minTenancyMonths ? `${p.minTenancyMonths} months` : null],
    ['Parking', p.parking], ['Outside space', p.outsideSpace], ['Heating', p.heating],
    ['Electricity', p.electricity], ['Water', p.water], ['Sewerage', p.sewerage],
    ['Broadband', p.broadband], ['Mobile signal', p.mobileSignal], ['Construction', p.construction],
    ['Building safety', p.buildingSafety], ['Restrictions', p.restrictions], ['Rights and easements', p.rightsEasements],
    ['Flood risk', p.floodRisk], ['Planning', p.planning], ['Accessibility', p.accessibility],
  ]
  const shownMaterial = material.filter(([, v]) => v)

  const facts: [string | number, string][] = []
  if (p.bedrooms != null) facts.push(p.bedrooms === 0 ? ['Studio', ''] : [p.bedrooms, p.bedrooms === 1 ? 'Bedroom' : 'Bedrooms'])
  if (p.bathrooms != null) facts.push([p.bathrooms, p.bathrooms === 1 ? 'Bathroom' : 'Bathrooms'])
  if (p.receptions != null) facts.push([p.receptions, p.receptions === 1 ? 'Reception' : 'Receptions'])
  if (p.propertyType) facts.push([labelFor(PROPERTY_TYPES, p.propertyType), ''])
  if (p.floorAreaSqft) facts.push([p.floorAreaSqft.toLocaleString('en-GB'), 'Sq ft'])
  if (p.tenure && !isLet) facts.push([labelFor(TENURES, p.tenure), ''])
  if (p.newBuild) facts.push(['New build', ''])

  const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.latitude != null && p.longitude != null ? `${p.latitude},${p.longitude}` : address)}`

  return (
    <div className="wrap">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/properties">Property search</Link><span>/</span>
        <Link href={`/properties?channel=${p.channel}`}>{isLet ? 'To let' : 'For sale'}</Link><span>/</span>
        <span>{address}</span>
      </nav>

      <div className="dtitle">
        <div>
          <span className="status">{p.status === 'available' ? (isLet ? 'To let' : 'For sale') : statusLabel(p.status)}</span>
          <h1>{address}</h1>
          <p className="sub">{headlineFor(p)}</p>
        </div>
        <div className="price">
          <div className="p">{priceLabel(p)}</div>
          <div className="n">{isLet ? labelFor(FURNISHING, p.furnishing) || 'Rent' : labelFor(TENURES, p.tenure) || 'Asking price'}</div>
          {!isLet ? <a className="borrow-link" href="/mortgage-calculator">Could you afford this? <b>See how much you could borrow →</b></a> : null}
        </div>
      </div>

      <Gallery photos={photos.map((m) => ({ id: m.id, url: m.url, caption: m.caption }))} alt={address} />

      <div className="dlayout">
        <div>
          {facts.length ? (
            <div className="chips">
              {facts.map(([v, k], i) => <span className="chip" key={i}><span className="v">{v}</span>{k ? <span className="k">{k}</span> : null}</span>)}
            </div>
          ) : null}

          {p.summary || paragraphs.length ? (
            <section className="dsec">
              <h2>About this home</h2>
              <div className="prose">
                {p.summary ? <p style={{ color: 'var(--ink)', fontSize: '1.05rem' }}>{p.summary}</p> : null}
                {paragraphs.map((t, i) => <p key={i}>{t}</p>)}
              </div>
            </section>
          ) : null}

          {p.keyFeatures?.length ? (
            <section className="dsec">
              <h2>Key features</h2>
              <ul className="feat">{p.keyFeatures.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </section>
          ) : null}

          {videos.length || embed ? (
            <section className="dsec">
              <h2>Video tour</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {videos.map((v) => (
                  <div className="vid" key={v.id}><video src={v.url} controls preload="metadata" playsInline /></div>
                ))}
                {embed ? (
                  <div className="vid">
                    <iframe src={embed} title={`Video tour of ${address}`} allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" loading="lazy" />
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {p.rooms.length ? (
            <section className="dsec">
              <h2>Rooms</h2>
              <div className="kv rooms">
                {p.rooms.map((r) => (
                  <div className="row" key={r.id}><span style={{ fontWeight: 600 }}>{r.name}</span><span className="k">{r.dimensions}</span><span>{r.description}</span></div>
                ))}
              </div>
            </section>
          ) : null}

          {plans.length ? (
            <section className="dsec">
              <h2>Floorplan</h2>
              <div className="plans">
                {plans.map((m) => (
                  <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
                    {m.contentType.startsWith('image/') ? <img src={m.url} alt={m.caption || 'Floorplan'} loading="lazy" /> : <span style={{ display: 'block', padding: 24 }}>Open floorplan (PDF)</span>}
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <div className="more" aria-label="More about this home">
            <details className="acc" id="note">
              <summary><h2>Add a note</h2><span className="acc-ic" aria-hidden="true" /></summary>
              <div className="acc-body"><PropertyNote propertyRef={p.ref} /></div>
            </details>

            <details className="acc" id="details">
              <summary><h2>Further details</h2><span className="acc-ic" aria-hidden="true" /></summary>
              <div className="acc-body">
                {shownMaterial.length ? (
                  <div className="kv">
                    {shownMaterial.map(([k, v]) => <div className="row" key={k}><span className="k">{k}</span><span>{v}</span></div>)}
                  </div>
                ) : <p className="acc-p">Ask us for anything you’d like to know about this home: <a href="tel:+442089049005">020 8904 9005</a>.</p>}
                {brochure || p.virtualTourUrl ? (
                  <div className="docs" style={{ marginTop: 16 }}>
                    {p.virtualTourUrl ? <a className="btn btn-dark" href={p.virtualTourUrl} target="_blank" rel="noreferrer">Take the virtual tour</a> : null}
                    {brochure ? <a className="btn btn-ghost" href={brochure.url} target="_blank" rel="noreferrer">Download brochure</a> : null}
                  </div>
                ) : null}
                <p className="acc-small">Reference {p.ref}</p>
              </div>
            </details>

            {!isLet && p.price ? (
              <details className="acc" id="mortgage">
                <summary><h2>Mortgage</h2><span className="acc-sum">about {formatGBP(Math.round(exampleMonthly(p.price)))} a month</span><span className="acc-ic" aria-hidden="true" /></summary>
                <div className="acc-body"><MortgageBox price={p.price} /></div>
              </details>
            ) : null}

            <details className="acc" id="stations">
              <summary><h2>Nearest stations</h2>{area.stations[0] ? <span className="acc-sum">{area.stations[0].name} · {distanceText(area.stations[0].metres)}</span> : null}<span className="acc-ic" aria-hidden="true" /></summary>
              <div className="acc-body">
                {area.stations.length ? (
                  <ul className="near">
                    {area.stations.map((st) => (
                      <li key={st.name}>
                        <span className="near-ic st" aria-hidden="true">{ICONS.station}</span>
                        <span className="near-what"><b>{st.name}</b><small>{st.lines.join(' · ')}</small></span>
                        <span className="near-far"><b>{distanceText(st.metres)}</b><small>about {st.minutes} min walk</small></span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {area.stations.length
                  ? <p className="acc-small">Distances are as the crow flies; walking times are a guide. <a href={mapsLink} target="_blank" rel="noreferrer">See it on Google Maps</a></p>
                  : <p className="acc-p">Ask us about the nearest stations and how long the walk is: <a href="tel:+442089049005">020 8904 9005</a>. <a href={mapsLink} target="_blank" rel="noreferrer">See it on Google Maps</a></p>}
              </div>
            </details>

            <details className="acc" id="epc">
              <summary><h2>Energy Performance Certificates</h2>{p.epcCurrent ? <span className="acc-sum">Rating {p.epcCurrent}</span> : null}<span className="acc-ic" aria-hidden="true" /></summary>
              <div className="acc-body">
                {p.epcCurrent ? <EpcChart current={p.epcCurrent} potential={p.epcPotential} /> : <p className="acc-p">{epc ? 'The certificate for this home is below.' : 'The certificate for this home is on its way. Ask us and we’ll send it to you.'}</p>}
                <div className="docs" style={{ marginTop: 16 }}>
                  {epc ? <a className="btn btn-dark" href={epc.url} target="_blank" rel="noreferrer">View the certificate</a> : null}
                  {p.postcode ? <a className="btn btn-ghost" href={`https://find-energy-certificate.service.gov.uk/find-a-certificate/search-by-postcode?postcode=${encodeURIComponent(p.postcode)}`} target="_blank" rel="noreferrer">Find it on GOV.UK</a> : null}
                </div>
              </div>
            </details>

            <details className="acc" id="local">
              <summary><h2>Local life</h2>{area.places.length ? <span className="acc-sum">{[...new Set(area.places.map((x) => LOCAL_KIND[x.kind]))].slice(0, 3).join(', ')}</span> : null}<span className="acc-ic" aria-hidden="true" /></summary>
              <div className="acc-body">
                {area.places.length ? (
                  <>
                    <ul className="near">
                      {area.places.map((x) => (
                        <li key={x.key}>
                          <span className={`near-ic ${x.kind}`} aria-hidden="true">{ICONS[x.kind]}</span>
                          <span className="near-what"><b>{x.name}</b><small>{x.detail}</small></span>
                          <span className="near-far"><b>{distanceText(x.metres)}</b><small>about {x.minutes} min walk</small></span>
                        </li>
                      ))}
                    </ul>
                    <p className="acc-small">Schools, shops and parks from OpenStreetMap (© OpenStreetMap contributors). Check school catchments with the council.</p>
                  </>
                ) : <p className="acc-p">We’ve been on Preston Road since 2004, so ask us anything about the schools, shops and parks around here: <a href="tel:+442089049005">020 8904 9005</a>.</p>}
              </div>
            </details>

            {sold && (sold.onStreet.length || sold.near?.covered) ? (
              <details className="acc sp" id="sold-nearby">
                <summary><h2>Sold nearby</h2><span className="acc-ic" aria-hidden="true" /></summary>
                <div className="acc-body">
                  <p style={{ color: 'var(--ink-soft)' }}>What homes around here have actually sold for, {sold.near?.typed ? `${lrTypeFor(p.propertyType) === 'F' ? 'flats' : 'houses'} like this one first` : 'newest first'}, so you can judge the price for yourself.</p>
                  {sold.near ? <SoldStats stats={sold.near.stats} note={sold.near.where} /> : null}
                  <SoldList sales={[...sold.onStreet, ...(sold.near?.recent ?? []).filter((r) => !sold.onStreet.some((x) => x.postcode === r.postcode && x.soldOn === r.soldOn && x.price === r.price))].slice(0, 8)} highlight={sold.street} />
                  <p style={{ marginTop: 10 }}><a href={`/sold-prices?postcode=${encodeURIComponent(p.postcode ?? '')}`} style={{ color: 'var(--gold-deep)', fontWeight: 600 }}>See more sold prices near {p.postcode} →</a></p>
                  <SoldCredit />
                </div>
              </details>
            ) : null}
          </div>
        </div>

        <aside className="aside">
          <EnquiryForm propertyId={p.id} isLet={isLet} />
          {isLet ? (
            <div className="tenant-box">
              <b>Not quite right?</b>
              <p>Tell us what you’re looking for and we’ll email you new homes to rent that fit, often before they reach the portals.</p>
              <a className="btn btn-gold" href="/renting#register">Get new homes by email</a>
              <a className="tb-link" href="/fees">What you’ll pay to rent</a>
            </div>
          ) : null}
          <div className="branch">
            <LogoMark />
            <div><b>Preston Hill Estates</b>271 Preston Road, Harrow HA3 0PS<br />Ref {p.ref}</div>
          </div>
        </aside>
      </div>
      {districtOf(p.postcode) ? <LocalIntel districts={[districtOf(p.postcode)!]} place={districtOf(p.postcode)!} rent={isLet} boxed /> : null}
      <ValueBanner rent={isLet} boxed />
      <Reviews site category={isLet ? 'lettings' : 'sales'} title={isLet ? <>What tenants and landlords <em>say</em></> : <>What our clients <em>say</em></>} />
    </div>
  )
}
