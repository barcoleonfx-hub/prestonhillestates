'use client'
import { useActionState, useEffect, useRef, useState, startTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { FullProperty } from '@/lib/properties'
import {
  COUNCIL_TAX_BANDS, EPC_RATINGS, FURNISHING, LET_TYPES, PRICE_QUALIFIERS, PROPERTY_TYPES, RENT_FREQUENCIES,
  TENURES, statusesFor, type Option,
} from '@/lib/options'
import { saveProperty, type SaveState } from '../../../actions'
import { MediaManager } from './MediaManager'

type P = FullProperty
const str = (v: unknown) => (v == null ? '' : String(v))

function Select({ name, options, defaultValue, id }: { name: string; options: Option[]; defaultValue: string; id?: string }) {
  return (
    <select className="select" id={id ?? name} name={name} defaultValue={defaultValue}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function PropertyEditor({ property: p }: { property: P }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [state, dispatch, pending] = useActionState<SaveState, FormData>(saveProperty, {})
  const [channel, setChannel] = useState(p.channel)
  const [features, setFeatures] = useState<string[]>(p.keyFeatures?.length ? p.keyFeatures : [''])
  const [roomList, setRoomList] = useState(
    p.rooms.length ? p.rooms.map((r) => ({ key: r.id, name: r.name, dimensions: str(r.dimensions), description: str(r.description) })) : [],
  )
  const [summaryLen, setSummaryLen] = useState(str(p.summary).length)
  const [dirty, setDirty] = useState(false)
  const errors = state.errors ?? {}

  useEffect(() => {
    if (state.ok) {
      setDirty(false)
      router.refresh()
    }
  }, [state.at, state.ok, router])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const fd = new FormData(e.currentTarget, submitter)
    startTransition(() => dispatch(fd))
  }

  const Err = ({ name }: { name: string }) => (errors[name] ? <span className="hint" style={{ color: 'var(--danger)' }}>{errors[name]}</span> : null)
  const statuses = statusesFor(channel)
  const isLet = channel === 'let'

  return (
    <form ref={formRef} onSubmit={submit} onChange={() => setDirty(true)} noValidate>
      <input type="hidden" name="id" value={p.id} />
      <div className="editor">
        <nav className="editor-toc" aria-label="Sections">
          <a href="#sec-listing">Listing</a>
          <a href="#sec-address">Address</a>
          <a href="#sec-price">{isLet ? 'Rent & terms' : 'Price & tenure'}</a>
          <a href="#sec-details">Property details</a>
          <a href="#sec-description">Description</a>
          <a href="#sec-rooms">Rooms</a>
          <a href="#sec-media">Photos & media</a>
          <a href="#sec-material">Material information</a>
          <a href="#sec-internal">Internal</a>
        </nav>

        <div className="editor-sections">
          {/* LISTING */}
          <section className="card esec" id="sec-listing">
            <div className="esec-head"><h2>Listing</h2><span className="hint">Ref {p.ref}</span></div>
            <div className="esec-body">
              <div className="grid3">
                <div className="field">
                  <span className="flabel">Listing type</span>
                  <div className="seg" role="radiogroup" aria-label="Listing type">
                    <label><input type="radio" name="channel" value="sale" checked={channel === 'sale'} onChange={() => setChannel('sale')} /><span>For sale</span></label>
                    <label><input type="radio" name="channel" value="let" checked={channel === 'let'} onChange={() => setChannel('let')} /><span>To let</span></label>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="status">Status</label>
                  <select className="select" id="status" name="status" key={channel} defaultValue={statuses.some((s) => s.value === p.status) ? p.status : 'available'}>
                    {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <Err name="status" />
                </div>
                <div className="field">
                  <span className="flabel">On the website</span>
                  <label className="check" style={{ marginTop: 8 }}><input type="checkbox" name="featured" defaultChecked={p.featured} />Feature on the homepage</label>
                </div>
              </div>
              <div className="field">
                <label htmlFor="headline">Headline <span className="hint">(optional)</span></label>
                <input className="input" id="headline" name="headline" defaultValue={str(p.headline)} placeholder="Left blank, it reads e.g. “4 bedroom semi-detached house for sale”" />
              </div>
            </div>
          </section>

          {/* ADDRESS */}
          <section className="card esec" id="sec-address">
            <div className="esec-head"><h2>Address</h2><span className="hint">The full address stays private; buyers see the display address</span></div>
            <div className="esec-body">
              <div className="grid2">
                <div className="field"><label htmlFor="addressLine1">House name or number</label><input className="input" id="addressLine1" name="addressLine1" defaultValue={str(p.addressLine1)} /></div>
                <div className="field"><label htmlFor="street">Street</label><input className="input" id="street" name="street" defaultValue={str(p.street)} /><Err name="street" /></div>
                <div className="field"><label htmlFor="locality">Area</label><input className="input" id="locality" name="locality" defaultValue={str(p.locality)} placeholder="e.g. Preston Road" /></div>
                <div className="field"><label htmlFor="town">Town</label><input className="input" id="town" name="town" defaultValue={str(p.town)} placeholder="e.g. Wembley" /></div>
                <div className="field"><label htmlFor="postcode">Postcode</label><input className="input" id="postcode" name="postcode" defaultValue={str(p.postcode)} style={{ textTransform: 'uppercase' }} /><Err name="postcode" /></div>
                <div className="field"><label htmlFor="displayAddress">Display address</label><input className="input" id="displayAddress" name="displayAddress" defaultValue={str(p.displayAddress)} placeholder="e.g. Carlton Avenue East, Wembley HA9" /><span className="hint">Left blank: street, town and the first half of the postcode</span></div>
                <div className="field"><label htmlFor="latitude">Latitude <span className="hint">(for the map)</span></label><input className="input" id="latitude" name="latitude" inputMode="decimal" defaultValue={str(p.latitude)} /><Err name="latitude" /></div>
                <div className="field"><label htmlFor="longitude">Longitude</label><input className="input" id="longitude" name="longitude" inputMode="decimal" defaultValue={str(p.longitude)} /><Err name="longitude" /></div>
              </div>
            </div>
          </section>

          {/* PRICE */}
          <section className="card esec" id="sec-price">
            <div className="esec-head"><h2>{isLet ? 'Rent & terms' : 'Price & tenure'}</h2></div>
            <div className="esec-body">
              <div className="grid3">
                <div className="field">
                  <label htmlFor="price">{isLet ? 'Rent (£)' : 'Asking price (£)'}</label>
                  <input className="input" id="price" name="price" inputMode="numeric" defaultValue={str(p.price)} />
                  <Err name="price" />
                </div>
                {isLet ? (
                  <div className="field"><label htmlFor="rentFrequency">Rent is paid</label><Select name="rentFrequency" options={RENT_FREQUENCIES} defaultValue={p.rentFrequency || 'pcm'} /></div>
                ) : (
                  <>
                    <input type="hidden" name="rentFrequency" value="" />
                  </>
                )}
                <div className="field"><label htmlFor="priceQualifier">Price qualifier</label><Select name="priceQualifier" options={PRICE_QUALIFIERS} defaultValue={str(p.priceQualifier)} /></div>
              </div>
              {isLet ? (
                <div className="grid4">
                  <div className="field"><label htmlFor="deposit">Deposit (£)</label><input className="input" id="deposit" name="deposit" inputMode="numeric" defaultValue={str(p.deposit)} /><Err name="deposit" /></div>
                  <div className="field"><label htmlFor="availableFrom">Available from</label><input className="input" type="date" id="availableFrom" name="availableFrom" defaultValue={str(p.availableFrom)} /><Err name="availableFrom" /></div>
                  <div className="field"><label htmlFor="furnishing">Furnishing</label><Select name="furnishing" options={FURNISHING} defaultValue={str(p.furnishing)} /></div>
                  <div className="field"><label htmlFor="letType">Let type</label><Select name="letType" options={LET_TYPES} defaultValue={str(p.letType)} /></div>
                  <div className="field"><label htmlFor="minTenancyMonths">Minimum tenancy (months)</label><input className="input" id="minTenancyMonths" name="minTenancyMonths" inputMode="numeric" defaultValue={str(p.minTenancyMonths)} /></div>
                </div>
              ) : (
                <>
                  {['deposit', 'availableFrom', 'furnishing', 'letType', 'minTenancyMonths'].map((n) => <input key={n} type="hidden" name={n} value={str((p as unknown as Record<string, unknown>)[n])} />)}
                </>
              )}
              <div className="grid4">
                <div className="field"><label htmlFor="tenure">Tenure</label><Select name="tenure" options={TENURES} defaultValue={str(p.tenure)} /><Err name="tenure" /></div>
                <div className="field"><label htmlFor="leaseYearsRemaining">Lease years remaining</label><input className="input" id="leaseYearsRemaining" name="leaseYearsRemaining" inputMode="numeric" defaultValue={str(p.leaseYearsRemaining)} /></div>
                <div className="field"><label htmlFor="groundRent">Ground rent (£ a year)</label><input className="input" id="groundRent" name="groundRent" inputMode="numeric" defaultValue={str(p.groundRent)} /></div>
                <div className="field"><label htmlFor="serviceCharge">Service charge (£ a year)</label><input className="input" id="serviceCharge" name="serviceCharge" inputMode="numeric" defaultValue={str(p.serviceCharge)} /></div>
              </div>
              <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                <label className="check"><input type="checkbox" name="newBuild" defaultChecked={p.newBuild} />New build</label>
                <label className="check"><input type="checkbox" name="sharedOwnership" defaultChecked={p.sharedOwnership} />Shared ownership</label>
              </div>
            </div>
          </section>

          {/* DETAILS */}
          <section className="card esec" id="sec-details">
            <div className="esec-head"><h2>Property details</h2></div>
            <div className="esec-body">
              <div className="grid3">
                <div className="field span2"><label htmlFor="propertyType">Property type</label><Select name="propertyType" options={[{ value: '', label: 'Choose…' }, ...PROPERTY_TYPES]} defaultValue={str(p.propertyType)} /><Err name="propertyType" /></div>
                <div className="field"><label htmlFor="floorAreaSqft">Floor area (sq ft)</label><input className="input" id="floorAreaSqft" name="floorAreaSqft" inputMode="numeric" defaultValue={str(p.floorAreaSqft)} /></div>
              </div>
              <div className="grid3">
                <div className="field"><label htmlFor="bedrooms">Bedrooms</label><input className="input" id="bedrooms" name="bedrooms" inputMode="numeric" defaultValue={str(p.bedrooms)} /><Err name="bedrooms" /></div>
                <div className="field"><label htmlFor="bathrooms">Bathrooms</label><input className="input" id="bathrooms" name="bathrooms" inputMode="numeric" defaultValue={str(p.bathrooms)} /></div>
                <div className="field"><label htmlFor="receptions">Reception rooms</label><input className="input" id="receptions" name="receptions" inputMode="numeric" defaultValue={str(p.receptions)} /></div>
              </div>
            </div>
          </section>

          {/* DESCRIPTION */}
          <section className="card esec" id="sec-description">
            <div className="esec-head"><h2>Description</h2></div>
            <div className="esec-body">
              <div className="field">
                <label htmlFor="summary">Summary</label>
                <textarea className="textarea" id="summary" name="summary" rows={3} maxLength={1000} defaultValue={str(p.summary)} onChange={(e) => setSummaryLen(e.target.value.length)} placeholder="Two or three sentences shown on search results." />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><Err name="summary" /><span className="counter">{summaryLen} / 1000</span></div>
              </div>
              <div className="field">
                <span className="flabel">Key features <span className="hint">(up to 12, shown as bullet points)</span></span>
                <div className="rowlist">
                  {features.map((f, i) => (
                    <div className="rowitem" key={i}>
                      <input className="input" name="keyFeature" value={f} maxLength={120} placeholder="e.g. Walking distance to Preston Road station"
                        onChange={(e) => setFeatures(features.map((x, j) => (j === i ? e.target.value : x)))} />
                      <button type="button" className="iconbtn" aria-label="Remove feature" onClick={() => { setFeatures(features.filter((_, j) => j !== i)); setDirty(true) }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                      </button>
                    </div>
                  ))}
                  {features.length < 12 ? <button type="button" className="addline" onClick={() => setFeatures([...features, ''])}>+ Add a feature</button> : null}
                </div>
              </div>
              <div className="field">
                <label htmlFor="desc">Full description</label>
                <textarea className="textarea" id="desc" name="description" rows={10} defaultValue={str(p.description)} placeholder="The full write-up. Blank lines start a new paragraph." />
              </div>
            </div>
          </section>

          {/* ROOMS */}
          <section className="card esec" id="sec-rooms">
            <div className="esec-head"><h2>Rooms</h2><span className="hint">Optional room-by-room breakdown</span></div>
            <div className="esec-body">
              <div className="rowlist">
                {roomList.map((r, i) => (
                  <div className="rowitem room" key={r.key}>
                    <input className="input" name="roomName" aria-label="Room name" placeholder="Room, e.g. Kitchen" value={r.name} onChange={(e) => setRoomList(roomList.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <input className="input" name="roomDims" aria-label="Dimensions" placeholder="e.g. 4.2m x 3.1m" value={r.dimensions} onChange={(e) => setRoomList(roomList.map((x, j) => (j === i ? { ...x, dimensions: e.target.value } : x)))} />
                    <input className="input" name="roomDesc" aria-label="Notes" placeholder="Notes" value={r.description} onChange={(e) => setRoomList(roomList.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                    <button type="button" className="iconbtn" aria-label="Remove room" onClick={() => { setRoomList(roomList.filter((_, j) => j !== i)); setDirty(true) }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                  </div>
                ))}
                <button type="button" className="addline" onClick={() => setRoomList([...roomList, { key: `new-${Date.now()}`, name: '', dimensions: '', description: '' }])}>+ Add a room</button>
              </div>
            </div>
          </section>

          {/* MEDIA */}
          <section className="card esec" id="sec-media">
            <div className="esec-head"><h2>Photos & media</h2><span className="hint">Uploads save straight away</span></div>
            <div className="esec-body">
              {errors.media ? <div className="notice err">{errors.media}</div> : null}
              <MediaManager propertyId={p.id} items={p.media} />
              <div className="grid2" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 18 }}>
                <div className="field"><label htmlFor="videoUrl">Video link <span className="hint">(YouTube or Vimeo)</span></label><input className="input" id="videoUrl" name="videoUrl" defaultValue={str(p.videoUrl)} placeholder="https://youtu.be/…" /><Err name="videoUrl" /></div>
                <div className="field"><label htmlFor="virtualTourUrl">Virtual tour link <span className="hint">(e.g. Matterport)</span></label><input className="input" id="virtualTourUrl" name="virtualTourUrl" defaultValue={str(p.virtualTourUrl)} placeholder="https://…" /><Err name="virtualTourUrl" /></div>
              </div>
            </div>
          </section>

          {/* MATERIAL INFO */}
          <section className="card esec" id="sec-material">
            <div className="esec-head"><h2>Material information</h2><span className="hint">What Trading Standards expects listings to show</span></div>
            <div className="esec-body">
              <div className="grid3">
                <div className="field"><label htmlFor="councilTaxBand">Council tax band</label><Select name="councilTaxBand" options={COUNCIL_TAX_BANDS} defaultValue={str(p.councilTaxBand)} /><Err name="councilTaxBand" /></div>
                <div className="field"><label htmlFor="epcCurrent">EPC rating, current</label><Select name="epcCurrent" options={EPC_RATINGS} defaultValue={str(p.epcCurrent)} /></div>
                <div className="field"><label htmlFor="epcPotential">EPC rating, potential</label><Select name="epcPotential" options={EPC_RATINGS} defaultValue={str(p.epcPotential)} /></div>
              </div>
              <div className="grid2">
                {([
                  ['parking', 'Parking', 'e.g. Driveway for two cars'],
                  ['outsideSpace', 'Outside space', 'e.g. 60ft rear garden'],
                  ['heating', 'Heating', 'e.g. Gas central heating'],
                  ['electricity', 'Electricity supply', 'e.g. Mains'],
                  ['water', 'Water supply', 'e.g. Mains'],
                  ['sewerage', 'Sewerage', 'e.g. Mains'],
                  ['broadband', 'Broadband', 'e.g. Ultrafast fibre available'],
                  ['mobileSignal', 'Mobile signal', 'e.g. Good coverage on all networks'],
                  ['construction', 'Construction type', 'e.g. Standard brick'],
                  ['buildingSafety', 'Building safety', 'Known issues, cladding, etc.'],
                  ['restrictions', 'Restrictions', 'Covenants, conservation area, listed status'],
                  ['rightsEasements', 'Rights & easements', 'Rights of way, shared access'],
                  ['floodRisk', 'Flood risk', 'e.g. No flooding in the last five years'],
                  ['planning', 'Planning permission', 'Nearby applications or permissions'],
                  ['accessibility', 'Accessibility', 'Step-free access, adaptations'],
                ] as const).map(([name, label, ph]) => (
                  <div className="field" key={name}>
                    <label htmlFor={name}>{label}</label>
                    <input className="input" id={name} name={name} defaultValue={str((p as unknown as Record<string, unknown>)[name])} placeholder={ph} />
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* INTERNAL */}
          <section className="card esec" id="sec-internal">
            <div className="esec-head"><h2>Internal</h2><span className="hint">Never shown on the website</span></div>
            <div className="esec-body">
              <div className="grid2">
                <div className="field"><label htmlFor="negotiator">Negotiator</label><input className="input" id="negotiator" name="negotiator" defaultValue={str(p.negotiator)} /></div>
              </div>
              <div className="field"><label htmlFor="internalNotes">Notes</label><textarea className="textarea" id="internalNotes" name="internalNotes" rows={4} defaultValue={str(p.internalNotes)} placeholder="Viewing arrangements, keys, vendor notes…" /></div>
            </div>
          </section>

          <div className="savebar" role="region" aria-label="Save">
            <div className="left" aria-live="polite">
              {p.published ? <span className="pill live"><span className="dot" />Live on website</span> : <span className="pill draft">Draft</span>}
              {state.message ? (
                <span style={{ color: state.ok ? 'var(--ok)' : 'var(--danger)', fontWeight: 600 }}>
                  {state.message}
                  {!state.ok && Object.keys(errors).length ? ` ${Object.values(errors).join(' · ')}` : ''}
                </span>
              ) : dirty ? <span>Unsaved changes</span> : null}
            </div>
            <div className="right">
              {p.published ? (
                <>
                  <button className="btn btn-ghost" type="submit" name="intent" value="unpublish" disabled={pending}>Take off website</button>
                  <button className="btn btn-gold" type="submit" name="intent" value="save" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button>
                </>
              ) : (
                <>
                  <button className="btn btn-ghost" type="submit" name="intent" value="save" disabled={pending}>{pending ? 'Saving…' : 'Save draft'}</button>
                  <button className="btn btn-gold" type="submit" name="intent" value="publish" disabled={pending}>Publish to website</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}
