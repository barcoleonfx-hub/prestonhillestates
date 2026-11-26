'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Script, Slot } from '@/lib/call-script-rules'
import { CALL_OUTCOMES, outcomeLabel } from '@/lib/call-script-rules'
import { quietEnds, quietReason, waLink } from '@/lib/whatsapp'
import { finishCall, saveCallProgress } from '../../../call-script-actions'
import { logWhatsApp } from '../../../lead-actions'

type Earlier = { id: string; by: string; answers: Record<string, string>; notes: string; outcome: string | null; detail: string | null; startedAt: string }

const day = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
const londonDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
const londonTime = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London' })

/**
 * The call script for this lead: what to say, in their name and about their home, the questions with a box for each
 * answer, notes, and how the call ended. Saved as you type; finishing it logs the call and sets up what's next.
 */
export function CallScript({ enquiryId, script, slots, open, earlier, startOpen, wa, first, kind }: {
  enquiryId: string
  script: Script
  slots: Slot[]
  open: { answers: Record<string, string>; ticks: string[]; notes: string; startedAt: string } | null
  earlier: Earlier[]
  startOpen: boolean
  wa: { e164: string | null; blocked: string | null }
  first: string
  kind: 'valuation' | 'buyer' | 'tenant'
}) {
  const router = useRouter()
  const [show, setShow] = useState(startOpen || !!open)
  const [answers, setAnswers] = useState<Record<string, string>>(open?.answers ?? {})
  const [ticks, setTicks] = useState<string[]>(open?.ticks ?? [])
  const [notes, setNotes] = useState(open?.notes ?? '')
  const [saved, setSaved] = useState<string | null>(open ? 'Carrying on from your last save' : null)
  const [outcome, setOutcome] = useState('')
  const [slot, setSlot] = useState(slots[0] ? `${slots[0].date} ${slots[0].time}` : 'own')
  const soon = new Date(Date.now() + 2 * 3600e3)
  const [date, setDate] = useState(londonDate(soon))
  const [time, setTime] = useState(londonTime(soon).replace(/:\d\d$/, ':00'))
  const [reason, setReason] = useState('')
  const [sells, setSells] = useState(false)
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null)
  const [waMsg, setWaMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const dirty = useRef(false)
  const ref = useRef<HTMLElement>(null)

  // Saved a moment after typing stops.
  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(async () => {
      const r = await saveCallProgress(enquiryId, { answers, ticks, notes }).catch(() => ({ error: 'Couldn’t save: check the connection.' }))
      setSaved('error' in r && r.error ? r.error : `Saved ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`)
    }, 900)
    return () => clearTimeout(t)
  }, [answers, ticks, notes, enquiryId])
  useEffect(() => { if (startOpen) ref.current?.scrollIntoView({ block: 'start' }) }, [startOpen])

  const touch = () => { dirty.current = true; setSaved('Saving…') }
  const tick = (k: string) => { touch(); setTicks((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k])) }
  const answer = (k: string, v: string) => { touch(); setAnswers((a) => ({ ...a, [k]: v })) }
  const asked = script.steps.flatMap((s) => s.asks ?? [])
  const got = asked.filter((q) => answers[q.key]?.trim()).length

  function pickOutcome(v: string) {
    setOutcome(v); setMsg(null)
    if (v === 'later') { const d = new Date(Date.now() + 28 * 864e5); setDate(londonDate(d)); setTime('10:30') }
    if (v === 'callback') { setDate(londonDate(soon)); setTime(londonTime(soon).replace(/:\d\d$/, ':00')) }
  }

  function finish() {
    if (!outcome) { setMsg({ error: 'Choose how the call ended.' }); return }
    const own = slot === 'own'
    const [sd, st] = own ? [date, time] : slot.split(' ')
    const input = {
      answers, ticks, notes, outcome, reason, sells,
      ...(outcome === 'booked' ? { date: sd, time: st } : outcome === 'callback' || outcome === 'later' ? { date, time } : {}),
    }
    start(async () => {
      const r = await finishCall(enquiryId, input)
      if (r.error) { setMsg({ error: r.error }); return }
      dirty.current = false
      setAnswers({}); setTicks([]); setNotes(''); setOutcome(''); setReason(''); setSells(false); setSaved(null)
      setMsg({ ok: r.said ?? 'Saved.' })
      if (r.go) router.push(r.go)
      else router.refresh()
    })
  }

  async function sendWhatsApp() {
    if (!wa.e164) return
    const q = quietReason()
    if (q && !confirm(`${q}. It’s kinder to send this ${quietEnds()}. Send it now anyway?`)) return
    const r = await logWhatsApp({ enquiryId, contactId: null, label: 'After a missed call', text: script.whatsapp, marketing: false })
    if (r.error) { setWaMsg(r.error); return }
    window.open(waLink(wa.e164, script.whatsapp), '_blank', 'noopener')
    setWaMsg('Opened in WhatsApp and noted on the lead. Press send there.')
    router.refresh()
  }

  if (!show) {
    return (
      <section className="card card-pad cs cs-closed" id="script" ref={ref}>
        <div>
          <h2>Call script <small>· {script.title.toLowerCase()}, written for {first || 'them'}</small></h2>
          <p className="card-sub">What to say, the questions to ask with a box for each answer, and notes. It saves as you go{earlier.length ? `, and remembers the ${earlier.length} earlier call${earlier.length === 1 ? '' : 's'}` : ''}.</p>
        </div>
        <button type="button" className="btn btn-dark" onClick={() => setShow(true)}>Open the call script</button>
      </section>
    )
  }

  return (
    <section className="card card-pad cs" id="script" ref={ref}>
      <div className="cs-head">
        <div>
          <h2>{script.title} <small>· for {first || 'them'}</small></h2>
          <p className="cs-goal"><b>Goal:</b> {script.goal}</p>
        </div>
        <div className="cs-status">
          <span>{got} of {asked.length} answers</span>
          {saved ? <span className={saved.startsWith('Couldn') ? 'cs-err' : ''}>{saved}</span> : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShow(false)}>Hide</button>
        </div>
      </div>

      {script.heads.length ? <ul className="cs-heads">{script.heads.map((h) => <li key={h}>{h}</li>)}</ul> : null}

      <ol className="cs-steps">
        {script.steps.map((s, i) => {
          const done = ticks.includes(s.key)
          return (
            <li key={s.key} className={done ? 'done' : ''}>
              <button type="button" className="cs-tick" aria-pressed={done} aria-label={done ? `Untick ${s.title}` : `Tick off ${s.title}`} onClick={() => tick(s.key)}>{done ? '✓' : i + 1}</button>
              <div className="cs-body">
                <h3>{s.title}</h3>
                {s.say ? <p className="cs-say">{s.say}</p> : null}
                {s.tip ? <p className="cs-tip">{s.tip}</p> : null}
                {s.asks?.map((q) => (
                  <label key={q.key} className="cs-ask">
                    <span className="cs-q">{q.q}</span>
                    {q.hint ? <span className="cs-hint">{q.hint}</span> : null}
                    {q.known ? <span className="cs-known">Already told us: {q.known}. Just check it’s still right.</span> : null}
                    <textarea className="textarea" rows={1} value={answers[q.key] ?? ''} placeholder="What they said" onChange={(ev) => answer(q.key, ev.target.value)} />
                  </label>
                ))}
              </div>
            </li>
          )
        })}
      </ol>

      <label className="cs-notes">
        <span className="cs-q">Notes</span>
        <textarea className="textarea" rows={3} value={notes} placeholder="Anything else: what they asked for, what you promised, how they came across" onChange={(ev) => { touch(); setNotes(ev.target.value) }} />
      </label>

      <div className="cs-more">
        <details>
          <summary className="det-sum">When they say…</summary>
          <p className="cs-tip">Agree first, then answer, then come back to the next step. Never argue or push.</p>
          <dl className="cs-obj">{script.objections.map((o) => <div key={o.they}><dt>{o.they}</dt><dd>{o.you}</dd></div>)}</dl>
        </details>
        <details>
          <summary className="det-sum">No answer: voicemail and WhatsApp</summary>
          <p className="cs-tip">Keep the voicemail under 20 seconds, then send the WhatsApp straight away.</p>
          <p className="cs-say"><b>Voicemail:</b> {script.voicemail}</p>
          <p className="cs-say"><b>WhatsApp:</b> {script.whatsapp}</p>
          {wa.blocked ? <p className="cs-tip">{wa.blocked}</p> : wa.e164 ? <button type="button" className="btn btn-wa btn-sm" onClick={sendWhatsApp}>Send this WhatsApp</button> : <p className="cs-tip">No mobile number on file for WhatsApp.</p>}
          {waMsg ? <p className="cs-tip">{waMsg}</p> : null}
        </details>
      </div>

      <div className="cs-finish">
        <h3>How did it end?</h3>
        <div className="chips" role="radiogroup" aria-label="How the call ended">
          {CALL_OUTCOMES.map((o) => (
            <label key={o.value} className="chip"><input type="radio" name="cs-outcome" value={o.value} checked={outcome === o.value} onChange={() => pickOutcome(o.value)} /><span>{o.label}</span></label>
          ))}
        </div>
        {outcome === 'booked' ? (
          <div className="cs-when">
            <span className="cs-q">Which time?</span>
            <div className="chips">
              {slots.map((s) => <label key={s.date + s.time} className="chip"><input type="radio" name="cs-slot" checked={slot === `${s.date} ${s.time}`} onChange={() => setSlot(`${s.date} ${s.time}`)} /><span>{s.label}</span></label>)}
              <label className="chip"><input type="radio" name="cs-slot" checked={slot === 'own'} onChange={() => setSlot('own')} /><span>Another time</span></label>
            </div>
            {slot === 'own' ? <div className="cs-dt"><input className="input" type="date" value={date} onChange={(ev) => setDate(ev.target.value)} /><input className="input" type="time" value={time} onChange={(ev) => setTime(ev.target.value)} /></div> : null}
            <p className="cs-tip">Next you’ll be taken to the diary with this time filled in, so they get the confirmation and the reminder.</p>
          </div>
        ) : outcome === 'callback' || outcome === 'later' ? (
          <div className="cs-when">
            <span className="cs-q">{outcome === 'callback' ? 'When to call them back' : 'When to check in'}</span>
            <div className="cs-dt"><input className="input" type="date" value={date} onChange={(ev) => setDate(ev.target.value)} /><input className="input" type="time" value={time} onChange={(ev) => setTime(ev.target.value)} /></div>
            <p className="cs-tip">It goes on your list, with a reminder when it’s due.</p>
          </div>
        ) : outcome === 'lost' ? (
          <label className="cs-when"><span className="cs-q">Why? (what changed)</span><input className="input" value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. decided to stay, went with another agent" /></label>
        ) : outcome === 'dnc' ? (
          <p className="cs-tip">They won’t be called, emailed or messaged again, and the follow-ups stop.</p>
        ) : outcome === 'no-answer' ? (
          <p className="cs-tip">Leave the voicemail and send the WhatsApp above. Try again on a different day and at a different time of day.</p>
        ) : null}
        {kind !== 'valuation' && outcome && outcome !== 'no-answer' && outcome !== 'dnc' ? (
          <label className="cs-check"><input type="checkbox" checked={sells} onChange={(ev) => setSells(ev.target.checked)} /> They have a home to sell: add it as a valuation lead</label>
        ) : null}
        <div className="cs-go">
          <button type="button" className="btn btn-gold" disabled={pending} onClick={finish}>{pending ? 'Saving…' : 'Finish the call'}</button>
          {msg?.error ? <span className="cs-err" role="alert">{msg.error}</span> : msg?.ok ? <span className="cs-ok" role="status">{msg.ok}</span> : null}
        </div>
      </div>

      {earlier.length ? (
        <details className="cs-earlier">
          <summary className="det-sum">Earlier calls ({earlier.length})</summary>
          <ol>
            {earlier.map((c) => (
              <li key={c.id}>
                <div className="cs-q">{day(c.startedAt)} · {c.by} · {outcomeLabel(c.outcome)}{c.detail ? ` (${c.detail})` : ''}</div>
                {asked.filter((q) => c.answers[q.key]?.trim()).map((q) => <p key={q.key}><span className="cs-hint">{q.q.replace(/[“”]/g, '')}</span> {c.answers[q.key]}</p>)}
                {c.notes ? <p><span className="cs-hint">Notes</span> {c.notes}</p> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  )
}
