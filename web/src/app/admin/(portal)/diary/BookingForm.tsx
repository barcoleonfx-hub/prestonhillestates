'use client'
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { saveAppointment, type BookingState } from '../../appointment-actions'
import { APPT_KINDS, DURATIONS, REMINDERS, SLOTS } from '@/lib/appointment-options'
import { addDays, dayLabel, durationLabel, fmtDay, fmtTime, londonToIso, todayLondon } from '@/lib/time'

export type StaffOption = { id: string; name: string; role: string }
export type PropertyOption = { id: string; ref: string; label: string; address: string; channel: string }
export type Busy = { id: string; staffId: string; startsAt: string; durationMin: number; kind: string; location: string }

export type BookingDefaults = {
  id?: string
  kind: string
  propertyId: string
  address: string
  date: string
  time: string
  durationMin: number
  staffId: string
  contactName: string
  contactPhone: string
  contactEmail: string
  notes: string
  reminderMin: number
  enquiryId?: string
}

export function BookingForm({ staff, props, busy, defaults, meId }: {
  staff: StaffOption[]; props: PropertyOption[]; busy: Busy[]; defaults: BookingDefaults; meId: string
}) {
  const [state, dispatch, pending] = useActionState<BookingState, FormData>(saveAppointment, {})
  const formRef = useRef<HTMLFormElement>(null)
  const today = todayLondon()

  const [kind, setKind] = useState(defaults.kind)
  const [propertyId, setPropertyId] = useState(defaults.propertyId)
  const [address, setAddress] = useState(defaults.address)
  const [date, setDate] = useState(defaults.date)
  const [time, setTime] = useState(defaults.time)
  const [durationMin, setDuration] = useState(defaults.durationMin)
  const [staffId, setStaffId] = useState(defaults.staffId)
  const [reminderMin, setReminder] = useState(defaults.reminderMin)
  const [propQuery, setPropQuery] = useState('')

  const quickDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i)), [today])
  const startIso = date && time ? londonToIso(date, time) : null
  const startMs = startIso ? new Date(startIso).getTime() : NaN
  const endMs = startMs + durationMin * 60000

  // Everything already booked on the chosen day, for the busy markers.
  const dayBusy = useMemo(() => {
    const from = londonToIso(date, '00:00')
    const to = londonToIso(addDays(date, 1), '00:00')
    if (!from || !to) return []
    return busy.filter((b) => b.id !== defaults.id && b.startsAt >= from && b.startsAt < to)
  }, [busy, date, defaults.id])

  const overlaps = (b: Busy, s: number, e: number) => {
    const bs = new Date(b.startsAt).getTime()
    return bs < e && bs + b.durationMin * 60000 > s
  }
  const clashFor = (sid: string) => (Number.isFinite(startMs) ? dayBusy.filter((b) => b.staffId === sid && overlaps(b, startMs, endMs)) : [])
  const slotBusy = (slot: string) => {
    if (!staffId) return false
    const s = londonToIso(date, slot)
    if (!s) return false
    const sm = new Date(s).getTime()
    return dayBusy.some((b) => b.staffId === staffId && overlaps(b, sm, sm + durationMin * 60000))
  }
  const slotPast = (slot: string) => {
    const s = londonToIso(date, slot)
    return !defaults.id && !!s && new Date(s).getTime() < Date.now() - 5 * 60000
  }

  const prop = props.find((p) => p.id === propertyId)
  const filteredProps = propQuery
    ? props.filter((p) => `${p.ref} ${p.label} ${p.address}`.toLowerCase().includes(propQuery.toLowerCase())).slice(0, 8)
    : props.slice(0, 8)
  const person = staff.find((s) => s.id === staffId)
  const myClashes = staffId ? clashFor(staffId) : []

  const submit = (force: boolean) => {
    const form = formRef.current
    if (!form || !form.reportValidity()) return
    const fd = new FormData(form)
    if (force) fd.set('force', '1')
    startTransition(() => dispatch(fd))
  }

  // Bring a refusal (such as a double booking) into view above the sticky bar.
  useEffect(() => {
    if (state.error) formRef.current?.querySelector('.bk-err')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [state])

  const err = (f: string) => (state.field === f ? ' has-error' : '')

  return (
    <form ref={formRef} className="booking" onSubmit={(e) => { e.preventDefault(); submit(false) }}>
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      {defaults.enquiryId ? <input type="hidden" name="enquiryId" value={defaults.enquiryId} /> : null}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="time" value={time} />
      <input type="hidden" name="durationMin" value={durationMin} />
      <input type="hidden" name="staffId" value={staffId} />
      <input type="hidden" name="reminderMin" value={reminderMin} />

      <section className="card bk-sec">
        <h2><span className="step">1</span>What and where</h2>
        <div className="seg" role="radiogroup" aria-label="Appointment type">
          {APPT_KINDS.map((k) => (
            <label key={k.value}><input type="radio" name="_kind" checked={kind === k.value} onChange={() => setKind(k.value)} /><span>{k.label}</span></label>
          ))}
        </div>

        {prop ? (
          <div className="bk-prop">
            <div>
              <div className="addr-main">{prop.ref} · {prop.label}</div>
              <div className="addr-sub">{prop.address}</div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPropertyId('')}>Change</button>
          </div>
        ) : (
          <div className={`bk-propsearch${err('address')}`}>
            {kind !== 'valuation' && props.length > 0 ? (
              <div className="field">
                <label htmlFor="bk-prop-q">Property</label>
                <input className="input" id="bk-prop-q" placeholder="Search by ref, street or postcode" value={propQuery} onChange={(e) => setPropQuery(e.target.value)} autoComplete="off" />
                <div className="bk-proplist" role="listbox" aria-label="Properties">
                  {filteredProps.map((p) => (
                    <button type="button" role="option" aria-selected={false} key={p.id} onClick={() => { setPropertyId(p.id); setAddress('') }}>
                      <b>{p.ref}</b> {p.label}<span>{p.channel === 'let' ? 'To let' : 'For sale'}</span>
                    </button>
                  ))}
                  {filteredProps.length === 0 ? <p className="hint">No listed property matches. Type the address below instead.</p> : null}
                </div>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="bk-address">{kind === 'valuation' ? 'Address to value' : 'Or type the address'}</label>
              <input className="input" id="bk-address" name="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House number, street, postcode" autoComplete="off" />
            </div>
          </div>
        )}
      </section>

      <section className={`card bk-sec${err('date')}${err('time')}`}>
        <h2><span className="step">2</span>When</h2>
        <div className="chips" role="radiogroup" aria-label="Day">
          {quickDays.map((d) => (
            <label key={d} className="chip"><input type="radio" name="_day" checked={date === d} onChange={() => setDate(d)} /><span>{dayLabel(d, today)}</span></label>
          ))}
          <label className="chip chip-input">
            <span className="sr-only">Another date</span>
            <input type="date" value={quickDays.includes(date) ? '' : date} min={defaults.id ? undefined : today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick another date" />
          </label>
        </div>

        <div className="slots" role="radiogroup" aria-label="Start time">
          {SLOTS.map((s) => {
            const busyNow = slotBusy(s)
            const past = slotPast(s)
            return (
              <label key={s} className={`slot${busyNow ? ' busy' : ''}`} title={busyNow ? `${person?.name} is busy` : undefined}>
                <input type="radio" name="_slot" checked={time === s} disabled={past} onChange={() => setTime(s)} />
                <span>{s}</span>
              </label>
            )
          })}
          <label className="slot slot-other">
            <span className="sr-only">Other time</span>
            <input type="time" step={300} value={SLOTS.includes(time) ? '' : time} onChange={(e) => e.target.value && setTime(e.target.value)} aria-label="Other time" />
          </label>
        </div>

        <div className="bk-row">
          <span className="flabel">How long</span>
          <div className="chips" role="radiogroup" aria-label="Duration">
            {DURATIONS.map((d) => (
              <label key={d} className="chip"><input type="radio" name="_dur" checked={durationMin === d} onChange={() => setDuration(d)} /><span>{durationLabel(d)}</span></label>
            ))}
          </div>
        </div>
      </section>

      <section className={`card bk-sec${err('staffId')}`}>
        <h2><span className="step">3</span>Who’s going <span className="req">Required</span></h2>
        <p className="card-sub">They’re responsible for the appointment and for recording the outcome afterwards.</p>
        <div className="staffpick" role="radiogroup" aria-label="Who is going">
          {staff.map((s) => {
            const c = clashFor(s.id)
            return (
              <label key={s.id} className={`staffopt${c.length ? ' clash' : ''}`}>
                <input type="radio" name="_staff" checked={staffId === s.id} onChange={() => setStaffId(s.id)} required />
                <span className="avatar" aria-hidden="true">{s.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</span>
                <span className="sname">{s.name}{s.id === meId ? ' (you)' : ''}</span>
                <span className="sfree">
                  {!Number.isFinite(startMs) ? '' : c.length ? `Busy ${fmtTime(c[0].startsAt)}–${fmtTime(new Date(new Date(c[0].startsAt).getTime() + c[0].durationMin * 60000).toISOString())}` : 'Free'}
                </span>
              </label>
            )
          })}
        </div>
      </section>

      <section className="card bk-sec">
        <h2><span className="step">4</span>Who they’re meeting</h2>
        <div className="grid3">
          <div className={`field${err('contactName')}`}><label htmlFor="bk-cn">Name{kind !== 'other' ? <span className="req">Required</span> : null}</label><input className="input" id="bk-cn" name="contactName" defaultValue={defaults.contactName} autoComplete="off" /></div>
          <div className={`field${err('contactPhone')}`}><label htmlFor="bk-cp">Phone</label><input className="input" id="bk-cp" name="contactPhone" type="tel" defaultValue={defaults.contactPhone} autoComplete="off" /></div>
          <div className={`field${err('contactEmail')}`}><label htmlFor="bk-ce">Email</label><input className="input" id="bk-ce" name="contactEmail" type="email" defaultValue={defaults.contactEmail} autoComplete="off" /></div>
        </div>
        <div className="field"><label htmlFor="bk-notes">Notes for whoever goes <span className="hint">(keys, parking, buyer’s position…)</span></label><textarea className="textarea" id="bk-notes" name="notes" rows={3} defaultValue={defaults.notes} /></div>
        <div className="bk-row">
          <span className="flabel">Remind everyone</span>
          <div className="chips" role="radiogroup" aria-label="Reminder">
            {REMINDERS.map((r) => (
              <label key={r.value} className="chip"><input type="radio" name="_rem" checked={reminderMin === r.value} onChange={() => setReminder(r.value)} /><span>{r.label}</span></label>
            ))}
          </div>
        </div>
      </section>

      {state.error ? (
        <div className="notice err bk-err" role="alert">
          {state.error}
          {state.clashes?.length ? (
            <>
              <ul>{state.clashes.map((c) => <li key={c}>{c}</li>)}</ul>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => submit(true)} disabled={pending}>Book anyway</button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="bk-bar">
        <div className="bk-summary" aria-live="polite">
          {startIso ? (
            <>
              <b>{fmtDay(startIso)}, {time} to {fmtTime(new Date(endMs).toISOString())}</b>
              <span>{person ? `${person.name} going` : 'Choose who’s going'}{prop ? ` · ${prop.ref}` : address ? ` · ${address}` : ''}</span>
            </>
          ) : <span>Pick a day and a time</span>}
        </div>
        {myClashes.length && !state.clashes ? <span className="pill warn">{person?.name} is already booked then</span> : null}
        <button className="btn btn-gold" type="submit" disabled={pending}>{pending ? 'Saving…' : defaults.id ? 'Save and alert everyone' : 'Book and alert everyone'}</button>
      </div>
    </form>
  )
}
