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

export default async function PropertyPage({ params }: { params: Params }) {
  const { slug } = await params
  const p = await getPublishedByRef(refFromSlug(slug))
  if (!p) notFound()
  const canonical = slugFor(p)
  if (slug !== canonical) permanentRedirect(`/properties/${canonical}`)

  const address = displayAddressFor(p)
  const photos = p.media.filter((m) => m.kind === 'photo')
  const plans = p.media.filter((m) => m.kind === 'floorplan')
  const videos = p.media.filter((m) => m.kind === 'video')
  const epc = p.media.find((m) => m.kind === 'epc')
  const brochure = p.media.find((m) => m.kind === 'brochure')
  const embed = embedUrl(p.videoUrl)
  const isLet = p.channel === 'let'
  const paragraphs = (p.description || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)

  const material: [string, string | null | undefined][] = [
    [isLet ? 'Rent' : 'Price', priceLabel(p)],
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

          {shownMaterial.length ? (
            <section className="dsec">
              <h2>Property information</h2>
              <div className="kv">
                {shownMaterial.map(([k, v]) => <div className="row" key={k}><span className="k">{k}</span><span>{v}</span></div>)}
              </div>
            </section>
          ) : null}

          {epc || brochure || p.virtualTourUrl ? (
            <section className="dsec">
              <h2>Documents & tours</h2>
              <div className="docs">
                {p.virtualTourUrl ? <a className="btn btn-dark" href={p.virtualTourUrl} target="_blank" rel="noreferrer">Take the virtual tour</a> : null}
                {brochure ? <a className="btn btn-ghost" href={brochure.url} target="_blank" rel="noreferrer">Download brochure</a> : null}
                {epc ? <a className="btn btn-ghost" href={epc.url} target="_blank" rel="noreferrer">View EPC</a> : null}
              </div>
            </section>
          ) : null}

          <section className="dsec">
            <h2>Location</h2>
            <p style={{ color: 'var(--ink-soft)' }}>{address}. <a href={mapsLink} target="_blank" rel="noreferrer" style={{ color: 'var(--gold-deep)' }}>Open in Google Maps</a></p>
          </section>
        </div>

        <aside className="aside">
          <EnquiryForm propertyId={p.id} isLet={isLet} />
          <div className="branch">
            <LogoMark />
            <div><b>Preston Hill Estates</b>271 Preston Road, Harrow HA3 0PS<br />Ref {p.ref}</div>
          </div>
        </aside>
      </div>
    </div>
  )
}
