'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Alert, PendingOutcome } from '@/lib/appointments'
import { kindLabel } from '@/lib/appointment-options'
import { durationLabel, fmtTime, fmtWhen } from '@/lib/time'
import { OutcomeForm } from './diary/OutcomeForm'
import { openCallLog } from './CallDrawer'

const POLL_MS = 20_000
const SOUND_KEY = 'phe_alert_sound'

/** A reply to one of our emails is an enquiry alert too, titled "… replied". */
const tagFor = (a: { kind: string; title: string }) => (a.kind === 'enquiry' && / replied$/.test(a.title) ? 'Reply' : TAG[a.kind] ?? 'Alert')
const TAG: Record<string, string> = { booked: 'New booking', changed: 'Changed', cancelled: 'Cancelled', reminder: 'Reminder', callback: 'Callback due', callback_assigned: 'New callback for you', enquiry: 'New enquiry' }

function readSound(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== 'off' } catch { return true }
}

export function AlertCenter({ me, initialPending }: { me: { id: string; name: string }; initialPending: PendingOutcome[] }) {
  const router = useRouter()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [pending, setPending] = useState<PendingOutcome[]>(initialPending)
  const [sound, setSound] = useState(true)
  const [audioReady, setAudioReady] = useState(false)
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default')
  const seen = useRef(new Set<string>())
  const ctx = useRef<AudioContext | null>(null)
  const soundRef = useRef(true)
  const gateChimed = useRef('')
  const baseTitle = useRef('')

  useEffect(() => {
    const s = readSound()
    setSound(s)
    soundRef.current = s
    setPerm(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
    baseTitle.current = document.title
  }, [])

  // Browsers only allow sound after the person has clicked or typed on the page, so unlock audio on the first interaction.
  useEffect(() => {
    const unlock = () => {
      try {
        ctx.current ??= new AudioContext()
        void ctx.current.resume().then(() => setAudioReady(ctx.current?.state === 'running'))
      } catch { /* no audio support */ }
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
  }, [])

  const chime = useCallback((urgent: boolean) => {
    if (!soundRef.current) return
    const ac = ctx.current
    if (!ac || ac.state !== 'running') return
    const notes = [784, 988, 1319] // G5 B5 E6: a soft three note bell
    const rounds = urgent ? 2 : 1
    for (let r = 0; r < rounds; r++) {
      notes.forEach((f, i) => {
        const t = ac.currentTime + r * 0.9 + i * 0.16
        const osc = ac.createOscillator()
        const gain = ac.createGain()
        osc.type = 'sine'
        osc.frequency.value = f
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(0.28, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
        osc.connect(gain).connect(ac.destination)
        osc.start(t)
        osc.stop(t + 0.95)
      })
    }
  }, [])

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/alerts', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { alerts: Alert[]; pending: PendingOutcome[] }
      const fresh = data.alerts.filter((a) => !seen.current.has(a.id))
      fresh.forEach((a) => seen.current.add(a.id))
      if (fresh.length) {
        chime(fresh.some((a) => a.kind === 'reminder' || a.kind === 'callback'))
        if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          for (const a of fresh.slice(0, 3)) {
            const ap = a.appointment
            const body = a.task ? `${a.task.contactName ?? ''} ${a.task.contactPhone ?? ''}`.trim() : ap ? `${fmtWhen(ap.startsAt)} · ${durationLabel(ap.durationMin)}\n${ap.location}\n${ap.staffId === me.id ? 'You are' : `${ap.staffName} is`} going` : a.body ?? ''
            const n = new Notification(`${tagFor(a)}: ${a.title}`, { body, tag: a.id, requireInteraction: a.kind === 'reminder' || a.kind === 'callback' })
            n.onclick = () => { window.focus(); n.close() }
          }
        }
      }
      setAlerts(data.alerts)
      setPending(data.pending)
    } catch { /* offline: try again next tick */ }
  }, [chime, me.id])

  useEffect(() => {
    void poll()
    const t = setInterval(() => void poll(), POLL_MS)
    const onVis = () => { if (!document.hidden) void poll() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [poll])

  // Show the unread count in the browser tab so it's visible from other tabs.
  useEffect(() => {
    if (!baseTitle.current) return
    document.title = alerts.length ? `(${alerts.length}) ${baseTitle.current.replace(/^\(\d+\)\s*/, '')}` : baseTitle.current.replace(/^\(\d+\)\s*/, '')
  }, [alerts.length])

  // A gentle chime when the outcome form first blocks the screen.
  const gateId = pending[0]?.id ?? ''
  useEffect(() => {
    if (gateId && gateChimed.current !== gateId && audioReady) { gateChimed.current = gateId; chime(false) }
  }, [gateId, audioReady, chime])

  const ack = useCallback((ids: string[]) => {
    setAlerts((list) => list.filter((a) => !ids.includes(a.id)))
    void fetch('/api/admin/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
  }, [])

  const toggleSound = () => {
    const next = !sound
    setSound(next)
    soundRef.current = next
    try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off') } catch { /* private mode */ }
    if (next) setTimeout(() => chime(false), 50)
  }

  const askDesktop = async () => {
    if (typeof Notification === 'undefined') return
    setPerm(await Notification.requestPermission())
  }

  const onOutcomeSaved = useCallback(() => {
    setPending((list) => list.slice(1))
    router.refresh()
  }, [router])

  const gate = pending[0]

  // Keep keyboard focus inside the outcome form while it blocks the screen.
  useEffect(() => {
    const els = document.querySelectorAll('.admin-main, .admin-nav, .admin-brand, .admin-me')
    els.forEach((el) => el.toggleAttribute('inert', !!gate))
    return () => els.forEach((el) => el.removeAttribute('inert'))
  }, [gate])

  return (
    <>
      <div className="alert-prefs">
        <button type="button" className={sound ? 'on' : undefined} onClick={toggleSound} aria-pressed={sound}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9h4l5-4v14l-5-4H4z" />{sound ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <path d="m17 9 5 6M22 9l-5 6" />}
          </svg>
          Alert sound {sound ? 'on' : 'off'}
        </button>
        {perm === 'default' ? <button type="button" onClick={askDesktop}>Turn on desktop alerts</button> : null}
        {perm === 'denied' ? <span className="muted">Desktop alerts blocked in this browser</span> : null}
      </div>

      {alerts.length > 0 ? (
        <div className="alert-stack" role="region" aria-label="Alerts" aria-live="assertive">
          {alerts.slice(0, 4).map((a) => {
            const ap = a.appointment
            const tk = a.task
            const extra = tk ? null : a.body?.split('\n').slice(1).join(' ')
            return (
              <article key={a.id} className={`alert-card k-${a.kind}`}>
                <div className="alert-top">
                  <span className="alert-tag">{tagFor(a)}</span>
                  {ap ? <span className="alert-time">{fmtTime(ap.startsAt)}</span> : tk ? <span className="alert-time">{fmtTime(tk.dueAt)}</span> : null}
                </div>
                <h3>{a.title}</h3>
                {ap ? (
                  <dl>
                    <dt>When</dt><dd>{fmtWhen(ap.startsAt)} · {durationLabel(ap.durationMin)}</dd>
                    <dt>Where</dt><dd>{ap.location || 'To be confirmed'}</dd>
                    <dt>Going</dt><dd><b>{ap.staffId === me.id ? 'You' : ap.staffName}</b></dd>
                    {ap.contactName ? <><dt>Meeting</dt><dd>{ap.contactName}</dd></> : null}
                  </dl>
                ) : null}
                {tk ? (
                  <dl>
                    {tk.contactName ? <><dt>Who</dt><dd><b>{tk.contactName}</b></dd></> : null}
                    {tk.contactPhone ? <><dt>Phone</dt><dd><a href={`tel:${tk.contactPhone}`}>{tk.contactPhone}</a></dd></> : null}
                    <dt>Due</dt><dd>{fmtWhen(tk.dueAt)}</dd>
                  </dl>
                ) : null}
                {extra ? <p className="alert-extra">{extra}</p> : null}
                <div className="alert-actions">
                  <button type="button" className="btn btn-gold btn-sm" onClick={() => ack([a.id])}>Got it</button>
                  {ap ? <Link className="btn btn-ghost btn-sm" href={`/admin/diary/${ap.id}`} onClick={() => ack([a.id])}>Open</Link> : null}
                  {a.kind === 'enquiry' ? <Link className="btn btn-dark btn-sm" href="/admin/enquiries" onClick={() => ack([a.id])}>Open enquiries</Link> : null}
                  {tk?.contactId ? <button type="button" className="btn btn-dark btn-sm" onClick={() => { ack([a.id]); openCallLog({ contactId: tk.contactId!, direction: 'out' }) }}>Log the call</button> : null}
                  {tk?.contactId ? <Link className="btn btn-ghost btn-sm" href={`/admin/contacts/${tk.contactId}`} onClick={() => ack([a.id])}>Their record</Link> : null}
                </div>
              </article>
            )
          })}
          {sound && !audioReady ? <div className="alert-hint">Click anywhere on the page to let alerts play a sound.</div> : null}
          {alerts.length > 1 ? (
            <button type="button" className="alert-all" onClick={() => ack(alerts.map((a) => a.id))}>Dismiss all {alerts.length}</button>
          ) : null}
        </div>
      ) : null}

      {gate ? (
        <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
          <div className="gate-card">
            <p className="gate-kicker">Outcome needed{pending.length > 1 ? ` · 1 of ${pending.length}` : ''}</p>
            <h2 id="gate-title">How did the {kindLabel(gate.kind).toLowerCase()} go?</h2>
            <p className="gate-sub">
              {fmtWhen(gate.startsAt)} to {fmtTime(new Date(new Date(gate.startsAt).getTime() + gate.durationMin * 60000).toISOString())}
              {gate.location ? <> · {gate.location}</> : null}
              {gate.contactName ? <> · with {gate.contactName}{gate.contactPhone ? ` (${gate.contactPhone})` : ''}</> : null}
            </p>
            <p className="gate-why">You were the person going, so the portal stays locked until this is filled in. It takes a minute.</p>
            <OutcomeForm key={gate.id} id={gate.id} kind={gate.kind} onDone={onOutcomeSaved} idPrefix="gate" />
          </div>
        </div>
      ) : null}
    </>
  )
}
