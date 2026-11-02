'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { logCall, type CallState } from '../crm-actions'
import { CALL_NEXT, CALLER_TYPES, DIRECTIONS, moneyShort, POSITIONS, roleLabel, SOURCES } from '@/lib/crm-options'
import { addDays, dayLabel, fmtWhen, isoToLondon, todayLondon } from '@/lib/time'

export type DrawerStaff = { id: string; name: string }
export type DrawerProperty = { id: string; ref: string; label: string; channel: string }

type Match = { id: string; name: string; phone: string | null; email: string | null; roles: string[]; lastContactAt: string | null; ownerName: string | null; openTasks: number; address: string | null }
type Brief = {
  contact: { id: string; name: string; phone: string | null; email: string | null; roles: string[]; areas: string | null; minBeds: number | null; maxPrice: number | null; position: string | null; address: string | null; ownerName: string | null; source: string | null }
  recent: { id: string; at: string; title: string; body?: string | null; by?: string | null }[]
  tasks: { id: string; title: string; dueAt: string; assigneeName: string; mine: boolean }[]
}
export type CallPrefill = { contactId?: string; name?: string; phone?: string; email?: string; enquiryId?: string; callerType?: string; propertyId?: string; direction?: string }

/** Opens the call log from anywhere: window.dispatchEvent(new CustomEvent('phe:new-call', { detail: prefill })) */
export function openCallLog(prefill: CallPrefill = {}) {
  window.dispatchEvent(new CustomEvent('phe:new-call', { detail: prefill }))
}

const BEDS = [0, 1, 2, 3, 4, 5]
const CB_TIMES = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00', '18:00']

function ago(iso: string | null) {
  if (!iso) return 'never'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 14) return `${d} days ago`
  if (d < 60) return `${Math.round(d / 7)} weeks ago`
  return `${Math.round(d / 30)} months ago`
}

function inAnHour() {
  const { date, time } = isoToLondon(new Date(Date.now() + 60 * 60000).toISOString())
  const [h, m] = time.split(':').map(Number)
  const rounded = Math.ceil((h * 60 + m) / 15) * 15
  return { date, time: `${String(Math.floor(rounded / 60) % 24).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}` }
}

export function CallDrawer({ me, staff, props }: { me: DrawerStaff; staff: DrawerStaff[]; props: DrawerProperty[] }) {
  const [open, setOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [prefill, setPrefill] = useState<CallPrefill>({})

  const show = useCallback((p: CallPrefill = {}) => { setPrefill(p); setFormKey((k) => k + 1); setOpen(true) }, [])

  useEffect(() => {
    const onEvent = (e: Event) => show((e as CustomEvent<CallPrefill>).detail ?? {})
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return
      if (t.closest('input, textarea, select, [contenteditable], .gate, .call-drawer')) return
      e.preventDefault()
      show()
    }
    window.addEventListener('phe:new-call', onEvent)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('phe:new-call', onEvent); window.removeEventListener('keydown', onKey) }
  }, [show])

  return (
    <>
      <button type="button" className="newcall" onClick={() => show()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
        </svg>
        Log a call <kbd>N</kbd>
      </button>
      {open ? <CallForm key={formKey} me={me} staff={staff} props={props} prefill={prefill} onClose={() => setOpen(false)} onAnother={() => show()} /> : null}
    </>
  )
}

function CallForm({ me, staff, props, prefill, onClose, onAnother }: {
  me: DrawerStaff; staff: DrawerStaff[]; props: DrawerProperty[]; prefill: CallPrefill; onClose: () => void; onAnother: () => void
}) {
  const router = useRouter()
  const [state, dispatch, pending] = useActionState<CallState, FormData>(logCall, {})
  const formRef = useRef<HTMLFormElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const today = todayLondon()

  const [direction, setDirection] = useState(prefill.direction ?? 'in')
  const [phone, setPhone] = useState(prefill.phone ?? '')
  const [name, setName] = useState(prefill.name ?? '')
  const [matches, setMatches] = useState<Match[]>([])
  const [brief, setBrief] = useState<Brief | null>(null)
  const [callerType, setCallerType] = useState(prefill.callerType ?? '')
  const [propertyId, setPropertyId] = useState(prefill.propertyId ?? '')
  const [propQ, setPropQ] = useState('')
  const [minBeds, setMinBeds] = useState<number | null>(null)
  const [position, setPosition] = useState('')
  const [source, setSource] = useState(prefill.enquiryId ? 'Our website' : '')
  const [next, setNext] = useState('')
  const [cbDate, setCbDate] = useState(today)
  const [cbTime, setCbTime] = useState('')
  const [assignTo, setAssignTo] = useState(me.id)
  const [dirty, setDirty] = useState(false)

  const loadBrief = useCallback(async (id: string) => {
    const res = await fetch(`/api/admin/contacts/lookup?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
    if (!res.ok) return
    const b = (await res.json()) as Brief
    setBrief(b)
    setMatches([])
    setCallerType((t) => t || b.contact.roles[0] || '')
  }, [])

  useEffect(() => {
    if (prefill.contactId) void loadBrief(prefill.contactId)
    else phoneRef.current?.focus()
  }, [prefill.contactId, loadBrief])

  // Search as they type the number (or a name) so repeat callers are recognised before you've said hello.
  useEffect(() => {
    if (brief) return
    const q = phone.trim() || name.trim()
    if (q.replace(/\D/g, '').length < 4 && !/[a-z]{2}/i.test(q)) { setMatches([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/contacts/lookup?q=${encodeURIComponent(q)}`, { signal: ctrl.signal, cache: 'no-store' })
        if (res.ok) setMatches(((await res.json()) as { matches: Match[] }).matches)
      } catch { /* aborted */ }
    }, 180)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [phone, name, brief])

  useEffect(() => {
    if (!state.ok) return
    if (state.go) { onClose(); router.push(state.go) } else router.refresh()
  }, [state, onClose, router])

  const close = () => {
    if (dirty && !state.ok && !confirm('Close without saving this call?')) return
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(() => dispatch(fd))
  }

  const isApplicant = callerType === 'buyer' || callerType === 'tenant'
  const isOwner = callerType === 'seller' || callerType === 'landlord'
  const prop = props.find((p) => p.id === propertyId)
  const propList = (propQ ? props.filter((p) => `${p.ref} ${p.label}`.toLowerCase().includes(propQ.toLowerCase())) : props).slice(0, 5)
  const err = (f: string) => (state.field === f ? ' has-error' : '')
  const c = brief?.contact

  if (state.ok && !state.go) {
    return (
      <div className="call-drawer" role="dialog" aria-modal="false" aria-label="Call logged">
        <div className="cd-done">
          <div className="cd-tick" aria-hidden="true">✓</div>
          <h2>Call logged</h2>
          <p>{next === 'callback' ? `Callback set for ${assignTo === me.id ? 'you' : staff.find((s) => s.id === assignTo)?.name}, ${['Today', 'Tomorrow'].includes(dayLabel(cbDate, today)) ? dayLabel(cbDate, today).toLowerCase() : `on ${dayLabel(cbDate, today)}`} at ${cbTime}. It will pop up when it’s due.` : 'Saved to their record.'}</p>
          <div className="cd-done-actions">
            <button type="button" className="btn btn-gold" onClick={onAnother}>Log another call</button>
            {state.contactId ? <Link className="btn btn-ghost" href={`/admin/contacts/${state.contactId}`} onClick={onClose}>Open their record</Link> : null}
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="call-drawer" role="dialog" aria-modal="false" aria-labelledby="cd-title">
      <form ref={formRef} onSubmit={submit} onChange={() => setDirty(true)}>
        <div className="cd-head">
          <h2 id="cd-title">Log a call</h2>
          <button type="button" className="iconbtn" onClick={close} aria-label="Close">✕</button>
        </div>

        <div className="cd-body">
          <input type="hidden" name="direction" value={direction} />
          <input type="hidden" name="callerType" value={callerType} />
          <input type="hidden" name="propertyId" value={propertyId} />
          <input type="hidden" name="minBeds" value={minBeds ?? ''} />
          <input type="hidden" name="position" value={position} />
          <input type="hidden" name="source" value={source} />
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="cbDate" value={cbDate} />
          <input type="hidden" name="cbTime" value={cbTime} />
          {c ? <input type="hidden" name="contactId" value={c.id} /> : null}
          {prefill.enquiryId ? <input type="hidden" name="enquiryId" value={prefill.enquiryId} /> : null}

          <div className="seg cd-dir" role="radiogroup" aria-label="Type of contact">
            {DIRECTIONS.map((d) => (
              <label key={d.value}><input type="radio" name="_dir" checked={direction === d.value} onChange={() => setDirection(d.value)} /><span>{d.label}</span></label>
            ))}
          </div>

          {c ? (
            <div className="cd-known">
              <div className="cd-known-top">
                <div>
                  <div className="cd-name">{c.name}</div>
                  <div className="cd-meta">{[c.phone, c.email].filter(Boolean).join(' · ')}</div>
                  <div className="cd-roles">{c.roles.map((r) => <span key={r} className="pill">{roleLabel(r)}</span>)}{c.ownerName ? <span className="cd-owner">Looked after by {c.ownerName}</span> : null}</div>
                </div>
                {!prefill.contactId ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBrief(null)}>Not them</button> : null}
              </div>
              {c.areas || c.minBeds != null || c.maxPrice || c.position || c.address ? (
                <p className="cd-wants">
                  {c.address ? <>Owns {c.address}. </> : null}
                  {c.areas || c.minBeds != null || c.maxPrice ? <>Looking for {c.minBeds != null ? `${c.minBeds === 0 ? 'studio' : `${c.minBeds}+ bed`}` : 'a home'}{c.areas ? ` in ${c.areas}` : ''}{c.maxPrice ? `, up to ${moneyShort(c.maxPrice)}` : ''}. </> : null}
                  {c.position ? <>{c.position}.</> : null}
                </p>
              ) : null}
              {brief!.tasks.length ? (
                <div className="cd-tasks">
                  {brief!.tasks.map((t) => (
                    <label key={t.id} className="check">
                      <input type="checkbox" name="closeTask" value={t.id} defaultChecked={t.mine} />
                      <span>This call is the “{t.title}” {t.mine ? '' : `(${t.assigneeName}’s) `}due {fmtWhen(t.dueAt)}</span>
                    </label>
                  ))}
                </div>
              ) : null}
              {brief!.recent.length ? (
                <ul className="cd-recent">
                  {brief!.recent.map((r) => <li key={r.id}><b>{ago(r.at)}</b> {r.title}{r.by ? ` (${r.by})` : ''}{r.body ? <span>{r.body}</span> : null}</li>)}
                </ul>
              ) : null}
            </div>
          ) : (
            <>
              <div className={`field${err('phone')}`}>
                <label htmlFor="cd-phone">Their number</label>
                <input ref={phoneRef} className="input cd-phone" id="cd-phone" name="phone" type="tel" inputMode="tel" autoComplete="off"
                  value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07… or 020…" />
              </div>
              {matches.length ? (
                <div className="cd-matches" role="listbox" aria-label="People we already know">
                  <p className="hint">Already in contacts? Tap to pick them.</p>
                  {matches.map((m) => (
                    <button type="button" role="option" aria-selected={false} key={m.id} onClick={() => void loadBrief(m.id)}>
                      <span className="m-name">{m.name}</span>
                      <span className="m-meta">{[m.phone, m.roles.map(roleLabel).join(', '), `last spoke ${ago(m.lastContactAt)}`].filter(Boolean).join(' · ')}</span>
                      {m.openTasks ? <span className="pill gold">{m.openTasks} to do</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="grid2">
                <div className="field"><label htmlFor="cd-name">Name</label><input className="input" id="cd-name" name="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="e.g. Mrs Patel" /></div>
                <div className={`field${err('email')}`}><label htmlFor="cd-email">Email <span className="hint">(optional)</span></label><input className="input" id="cd-email" name="email" type="email" defaultValue={prefill.email} autoComplete="off" /></div>
              </div>
            </>
          )}

          <fieldset className={`field${err('callerType')}`}>
            <legend className="flabel">Who’s calling? <span className="req">Required</span></legend>
            <div className="chips">
              {CALLER_TYPES.map((t) => (
                <label key={t.value} className="chip"><input type="radio" name="_ct" checked={callerType === t.value} onChange={() => { setCallerType(t.value); setPosition('') }} /><span>{t.label}</span></label>
              ))}
            </div>
          </fieldset>

          {isApplicant ? (
            <div className="cd-sub">
              <div className="field">
                <span className="flabel">Calling about one of our properties?</span>
                {prop ? (
                  <div className="bk-prop"><div><div className="addr-main">{prop.ref} · {prop.label}</div></div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setPropertyId('')}>Change</button></div>
                ) : (
                  <>
                    <input className="input" placeholder="Search ref or street" value={propQ} onChange={(e) => setPropQ(e.target.value)} aria-label="Search our properties" />
                    {propQ ? (
                      <div className="bk-proplist">
                        {propList.map((p) => <button type="button" key={p.id} onClick={() => { setPropertyId(p.id); setPropQ('') }}><b>{p.ref}</b> {p.label}<span>{p.channel === 'let' ? 'To let' : 'For sale'}</span></button>)}
                        {propList.length === 0 ? <p className="hint">No match.</p> : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
              <div className="grid2">
                <div className="field"><label htmlFor="cd-areas">Areas</label><input className="input" id="cd-areas" name="areas" placeholder="Kenton, Harrow, Wembley Park" defaultValue={c?.areas ?? ''} /></div>
                <div className={`field${err('maxPrice')}`}><label htmlFor="cd-budget">{callerType === 'tenant' ? 'Rent up to (pcm)' : 'Budget up to'}</label><input className="input" id="cd-budget" name="maxPrice" placeholder={callerType === 'tenant' ? '1800' : '450k'} defaultValue={c?.maxPrice ? String(c.maxPrice) : ''} /></div>
              </div>
              <div className="field">
                <span className="flabel">Bedrooms, at least</span>
                <div className="chips">
                  {BEDS.map((b) => <label key={b} className="chip"><input type="radio" name="_beds" checked={minBeds === b} onChange={() => setMinBeds(b)} /><span>{b === 0 ? 'Studio' : b === 5 ? '5+' : b}</span></label>)}
                </div>
              </div>
            </div>
          ) : null}

          {isOwner ? (
            <div className="cd-sub">
              <div className="field"><label htmlFor="cd-addr">Their property’s address</label><input className="input" id="cd-addr" name="address" placeholder="House number, street, postcode" defaultValue={c?.address ?? ''} /></div>
            </div>
          ) : null}

          {callerType && POSITIONS[callerType]?.length ? (
            <div className="field">
              <span className="flabel">Their position</span>
              <div className="chips chips-sm">
                {POSITIONS[callerType].map((p) => <label key={p} className="chip"><input type="radio" name="_pos" checked={position === p} onChange={() => setPosition(p)} /><span>{p}</span></label>)}
              </div>
            </div>
          ) : null}

          {!c ? (
            <div className="field">
              <span className="flabel">How did they hear about us?</span>
              <div className="chips chips-sm">
                {SOURCES.map((s) => <label key={s} className="chip"><input type="radio" name="_src" checked={source === s} onChange={() => setSource(s)} /><span>{s}</span></label>)}
              </div>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="cd-notes">Notes</label>
            <textarea className="textarea" id="cd-notes" name="notes" rows={3} placeholder="What they said, what they want, anything to remember" />
          </div>

          <fieldset className={`field${err('next')}${err('cb')}`}>
            <legend className="flabel">Next step <span className="req">Required</span></legend>
            <div className="chips">
              {CALL_NEXT.map((n) => (
                <label key={n.value} className="chip"><input type="radio" name="_next" checked={next === n.value} onChange={() => {
                  setNext(n.value)
                  if (n.value === 'callback' && !cbTime) { const h = inAnHour(); setCbDate(h.date); setCbTime(h.time) }
                }} /><span>{n.label}</span></label>
              ))}
            </div>
            {next === 'callback' ? (
              <div className="cd-cb">
                <div className="chips chips-sm" role="radiogroup" aria-label="Callback day">
                  {[0, 1, 2, 3, 4].map((i) => addDays(today, i)).map((d) => (
                    <label key={d} className="chip"><input type="radio" name="_cbd" checked={cbDate === d} onChange={() => setCbDate(d)} /><span>{dayLabel(d, today)}</span></label>
                  ))}
                  <label className="chip chip-input"><input type="date" min={today} value={cbDate} onChange={(e) => e.target.value && setCbDate(e.target.value)} aria-label="Callback date" /></label>
                </div>
                <div className="chips chips-sm" role="radiogroup" aria-label="Callback time">
                  {(() => { const h = inAnHour(); return h.date === cbDate ? (
                    <label className="chip"><input type="radio" name="_cbt" checked={cbTime === h.time} onChange={() => setCbTime(h.time)} /><span>In an hour ({h.time})</span></label>
                  ) : null })()}
                  {CB_TIMES.map((t) => <label key={t} className="chip"><input type="radio" name="_cbt" checked={cbTime === t} onChange={() => setCbTime(t)} /><span>{t}</span></label>)}
                  <label className="chip chip-input"><input type="time" step={300} value={cbTime} onChange={(e) => setCbTime(e.target.value)} aria-label="Callback time" /></label>
                </div>
                <div className="field cd-assign">
                  <label htmlFor="cd-assign">Who calls them back</label>
                  <select className="select" id="cd-assign" name="assignTo" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.id === me.id ? `${s.name} (me)` : s.name}</option>)}
                  </select>
                </div>
              </div>
            ) : null}
          </fieldset>
        </div>

        <div className="cd-foot">
          {state.error ? <div className="notice err" role="alert">{state.error}</div> : null}
          <button className="btn btn-gold" type="submit" disabled={pending}>
            {pending ? 'Saving…' : next === 'viewing' ? 'Save and book viewing' : next === 'valuation' ? 'Save and book valuation' : 'Save call'}
          </button>
        </div>
      </form>
    </div>
  )
}
