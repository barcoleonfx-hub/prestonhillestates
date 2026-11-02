'use client'
import { startTransition, useActionState, useState } from 'react'
import { addCallback, updateContact, type SimpleState } from '../../../crm-actions'
import { CALLER_TYPES, POSITIONS, SOURCES } from '@/lib/crm-options'
import { addDays, dayLabel, todayLondon } from '@/lib/time'

type Staff = { id: string; name: string }
type C = {
  id: string; name: string; phone: string | null; phone2: string | null; email: string | null; roles: string[]; source: string | null
  areas: string | null; minBeds: number | null; maxPrice: number | null; position: string | null; address: string | null; notes: string | null; ownerId: string | null
}

const submitWith = (dispatch: (fd: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault()
  const fd = new FormData(e.currentTarget)
  startTransition(() => dispatch(fd))
}

export function EditContactForm({ c, staff }: { c: C; staff: Staff[] }) {
  const [state, dispatch, pending] = useActionState<SimpleState, FormData>(updateContact, {})
  const positions = [...new Set(c.roles.flatMap((r) => POSITIONS[r] ?? []))]
  return (
    <form className="contact-edit" onSubmit={submitWith(dispatch)}>
      <input type="hidden" name="id" value={c.id} />
      <div className="grid2">
        <div className="field"><label htmlFor="ce-name">Name</label><input className="input" id="ce-name" name="name" defaultValue={c.name} required /></div>
        <div className="field"><label htmlFor="ce-email">Email</label><input className="input" id="ce-email" name="email" type="email" defaultValue={c.email ?? ''} /></div>
        <div className="field"><label htmlFor="ce-phone">Phone</label><input className="input" id="ce-phone" name="phone" type="tel" defaultValue={c.phone ?? ''} /></div>
        <div className="field"><label htmlFor="ce-phone2">Other phone</label><input className="input" id="ce-phone2" name="phone2" type="tel" defaultValue={c.phone2 ?? ''} /></div>
      </div>
      <fieldset className="field">
        <legend className="flabel">Type</legend>
        <div className="chips chips-sm">
          {CALLER_TYPES.map((t) => <label key={t.value} className="chip chip-check"><input type="checkbox" name="roles" value={t.value} defaultChecked={c.roles.includes(t.value)} /><span>{t.label}</span></label>)}
        </div>
      </fieldset>
      <div className="grid2">
        <div className="field"><label htmlFor="ce-areas">Areas wanted</label><input className="input" id="ce-areas" name="areas" defaultValue={c.areas ?? ''} /></div>
        <div className="field"><label htmlFor="ce-beds">Bedrooms, at least</label><input className="input" id="ce-beds" name="minBeds" type="number" min={0} max={10} defaultValue={c.minBeds ?? ''} /></div>
        <div className="field"><label htmlFor="ce-max">Budget / rent up to</label><input className="input" id="ce-max" name="maxPrice" defaultValue={c.maxPrice ?? ''} placeholder="450k or 1800" /></div>
        <div className="field">
          <label htmlFor="ce-pos">Position</label>
          <input className="input" id="ce-pos" name="position" list="ce-pos-list" defaultValue={c.position ?? ''} />
          <datalist id="ce-pos-list">{positions.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
      </div>
      <div className="field"><label htmlFor="ce-addr">Their property (sellers and landlords)</label><input className="input" id="ce-addr" name="address" defaultValue={c.address ?? ''} /></div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="ce-owner">Looked after by</label>
          <select className="select" id="ce-owner" name="ownerId" defaultValue={c.ownerId ?? ''}>
            <option value="">Nobody in particular</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ce-src">Heard about us from</label>
          <select className="select" id="ce-src" name="source" defaultValue={c.source ?? ''}>
            <option value="">Not recorded</option>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label htmlFor="ce-notes">Notes that always apply</label><textarea className="textarea" id="ce-notes" name="notes" rows={3} defaultValue={c.notes ?? ''} placeholder="e.g. Prefers WhatsApp, only free after 6pm" /></div>
      {state.error ? <div className="notice err" role="alert">{state.error}</div> : null}
      {state.ok ? <div className="notice ok" role="status">Saved.</div> : null}
      <button className="btn btn-dark" type="submit" disabled={pending} style={{ alignSelf: 'flex-start' }}>{pending ? 'Saving…' : 'Save details'}</button>
    </form>
  )
}

export function AddCallbackForm({ contactId, staff, meId }: { contactId: string; staff: Staff[]; meId: string }) {
  const [state, dispatch, pending] = useActionState<SimpleState, FormData>(addCallback, {})
  const today = todayLondon()
  const [date, setDate] = useState(addDays(today, 1))
  const [time, setTime] = useState('10:00')
  return (
    <form className="cb-form" onSubmit={submitWith(dispatch)}>
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="date" value={date} />
      <div className="chips chips-sm">
        {[0, 1, 2, 3, 7].map((i) => addDays(today, i)).map((d) => (
          <label key={d} className="chip"><input type="radio" name="_d" checked={date === d} onChange={() => setDate(d)} /><span>{dayLabel(d, today)}</span></label>
        ))}
        <label className="chip chip-input"><input type="date" min={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" /></label>
      </div>
      <div className="grid2">
        <div className="field"><label htmlFor="cb-time">Time</label><input className="input" id="cb-time" name="time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required /></div>
        <div className="field">
          <label htmlFor="cb-who">Who</label>
          <select className="select" id="cb-who" name="assignTo" defaultValue={meId}>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.id === meId ? `${s.name} (me)` : s.name}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label htmlFor="cb-title">What for <span className="hint">(optional)</span></label><input className="input" id="cb-title" name="title" placeholder="e.g. Chase mortgage in principle" /></div>
      {state.error ? <div className="notice err" role="alert">{state.error}</div> : null}
      {state.ok ? <div className="notice ok" role="status">Callback added.</div> : null}
      <button className="btn btn-ghost btn-sm" type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add callback'}</button>
    </form>
  )
}
