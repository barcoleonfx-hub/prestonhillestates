'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { sendChatLead } from '@/app/(main)/(site)/actions'
import { LogoMark } from './Logo'
import './chat-prompt.css'

// A guided chat in the corner of the homepage, Landlords and Properties pages: "Selling, letting or management?"
// It asks for the postcode, name and phone, and the answer arrives in the portal as a valuation enquiry with an
// alert. Nobody has to be online to answer it. WhatsApp is offered for anyone who'd rather message.

const WHATSAPP = '447745203146'
const SENT_KEY = 'phe_chat_sent' // after sending: no prompt for a year
const QUIET_KEY = 'phe_chat_quiet' // prompt closed: not again this visit
const PROMPT_AFTER = 20_000

type Goal = 'sell' | 'let' | 'manage'
type Stage = 'choose' | 'browse' | 'postcode' | 'name' | 'phone' | 'sending' | 'done'
type Msg = { id: number; from: 'bot' | 'me'; text: string }

const GOALS: { key: Goal; label: string; said: string; reply: string; wa: string }[] = [
  { key: 'sell', label: 'Sell my home', said: 'I’m thinking of selling', reply: 'Great. We’ll come and value it for you, free and with no obligation.', wa: 'Hi Preston Hill Estates, I’m thinking of selling my home.' },
  { key: 'let', label: 'Let my property', said: 'I’m thinking of letting', reply: 'Great. We’ll tell you honestly what rent to expect, free and with no obligation.', wa: 'Hi Preston Hill Estates, I’m thinking of letting my property.' },
  { key: 'manage', label: 'Manage my property', said: 'I’d like my property managed', reply: 'Great. Our fully managed service looks after the tenancy, the rent and the repairs for you.', wa: 'Hi Preston Hill Estates, I’d like to talk about managing my property.' },
]

const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? ''
const POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/
const PHONE = /^[0-9+()\s-]{7,20}$/

/** When we'll call, from our opening hours (Mon to Fri 9.00 to 17.30, Sat 10.00 to 13.00), in London time. */
export function callWhen(at = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(at).map((p) => [p.type, p.value]))
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const day = days.indexOf(parts.weekday)
  const mins = Number(parts.hour) * 60 + Number(parts.minute)
  const hours = (d: number) => (d === 0 ? null : d === 6 ? [600, 780] : [540, 1050])
  const today = hours(day)
  if (today && mins < today[0]) return 'this morning'
  if (today && mins < today[1] - 30) return 'today'
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7
    if (hours(d)) return i === 1 ? 'tomorrow morning' : `on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]} morning`
  }
  return 'soon'
}

function store(kind: 'local' | 'session', key: string, value?: string): string | null {
  try {
    const s = kind === 'local' ? localStorage : sessionStorage
    if (value === undefined) return s.getItem(key)
    s.setItem(key, value)
  } catch { /* private mode */ }
  return null
}

/** Is a pop-up (the valuation one) showing? The chat waits until it's gone. */
const modalOpen = () => Array.from(document.querySelectorAll('[aria-modal="true"]')).some((el) => !(el as HTMLElement).closest('[hidden]') && el.getClientRects().length > 0)

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
const CHAT_ICON = 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z'
const CLOSE_ICON = 'M6 6l12 12M18 6L6 18'
const SEND_ICON = 'M5 12h13M13 6l6 6-6 6'
const WA_PATH = 'M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.8h-.01a9.84 9.84 0 0 1-5.02-1.38l-.36-.21-3.73.98 1-3.64-.24-.37a9.82 9.82 0 0 1-1.51-5.24c0-5.44 4.43-9.86 9.87-9.86a9.8 9.8 0 0 1 6.98 2.9 9.8 9.8 0 0 1 2.89 6.98c0 5.44-4.43 9.86-9.87 9.86zm8.4-18.26A11.8 11.8 0 0 0 12.04.06C5.5.06.17 5.38.17 11.93c0 2.09.55 4.13 1.59 5.94L.07 24l6.3-1.65a11.86 11.86 0 0 0 5.67 1.44h.01c6.54 0 11.87-5.32 11.87-11.87 0-3.17-1.24-6.15-3.48-8.39z'
const WaIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d={WA_PATH} /></svg>

export function ChatPrompt() {
  const [ready, setReady] = useState(false)
  const [teaser, setTeaser] = useState(false)
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>('choose')
  const [goal, setGoal] = useState<Goal | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [typing, setTyping] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const answers = useRef({ postcode: '', name: '', phone: '' })
  const nextId = useRef(1)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const reduced = useRef(false)
  const started = useRef(false)

  const say = useCallback((from: Msg['from'], text: string) => setMsgs((m) => [...m, { id: nextId.current++, from, text }]), [])
  /** The bot "types" for a moment before each reply, so it reads like a conversation. */
  const botSay = useCallback(async (...lines: string[]) => {
    for (const l of lines) {
      if (!reduced.current) { setTyping(true); await new Promise((r) => setTimeout(r, 450 + Math.min(l.length * 8, 650))) }
      setTyping(false)
      say('bot', l)
    }
  }, [say])

  // Show the button a moment after the page loads; the "Selling, letting or management?" prompt after 20 seconds,
  // but never on top of the valuation pop-up, and not again once closed (this visit) or once sent (a year).
  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t1 = window.setTimeout(() => setReady(true), 1500)
    if (store('session', QUIET_KEY) || Number(store('local', SENT_KEY) || 0) > Date.now()) return () => window.clearTimeout(t1)
    let t2 = 0, gone = false
    const tryPrompt = () => {
      if (gone) return
      if (modalOpen()) { t2 = window.setTimeout(() => { if (!modalOpen()) t2 = window.setTimeout(tryPrompt, 6000); else tryPrompt() }, 2000); return }
      setTeaser(true)
    }
    t2 = window.setTimeout(tryPrompt, PROMPT_AFTER)
    return () => { gone = true; window.clearTimeout(t1); window.clearTimeout(t2) }
  }, [])

  // On phones, pages with a quick-actions bar along the bottom: sit just above it.
  const [lift, setLift] = useState(0)
  useEffect(() => {
    const measure = () => {
      const bar = document.querySelector<HTMLElement>('.vx-mobilebar')
      const shown = bar && getComputedStyle(bar).display !== 'none' && getComputedStyle(bar).position === 'fixed'
      setLift(shown ? Math.round(window.innerHeight - bar.getBoundingClientRect().top + 10) : 0)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const start = useCallback(() => {
    setTeaser(false)
    setOpen(true)
    store('session', QUIET_KEY, '1')
    if (started.current) return
    started.current = true
    void botSay('Hi, welcome to Preston Hill Estates.', 'Are you thinking of selling, letting, or would you like us to manage your property?')
  }, [botSay])

  const close = useCallback(() => {
    setOpen(false)
    window.setTimeout(() => launcherRef.current?.focus(), 0)
  }, [])

  // Keep the newest message in view, and put the cursor in the box when we ask a question.
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduced.current ? 'auto' : 'smooth' }) }, [msgs, typing, stage])
  useEffect(() => { if (open && !typing && (stage === 'postcode' || stage === 'name' || stage === 'phone')) inputRef.current?.focus() }, [open, typing, stage])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const choose = async (g: Goal | 'browse') => {
    if (typing) return
    if (g === 'browse') {
      say('me', 'I’m looking to buy or rent')
      setStage('browse')
      await botSay('Here’s what we have at the moment. Register as a tenant and we’ll send you new lets first.')
      return
    }
    const info = GOALS.find((x) => x.key === g)!
    setGoal(g)
    say('me', info.said)
    setStage('postcode')
    await botSay(info.reply, 'What’s the postcode of the property?')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (typing || stage === 'sending') return
    const v = value.trim()
    setError(null)
    if (stage === 'postcode') {
      const pc = v.toUpperCase().replace(/\s+/g, ' ')
      if (!POSTCODE.test(pc)) { setError('Enter the full postcode, e.g. HA3 0PS.'); return }
      answers.current.postcode = pc; say('me', pc); setValue(''); setStage('name')
      await botSay('Thanks. And your name?')
    } else if (stage === 'name') {
      if (!v) { setError('Please tell us your name.'); return }
      answers.current.name = v.slice(0, 120); say('me', v); setValue(''); setStage('phone')
      await botSay(`Thanks, ${firstName(v)}. What’s the best number to call you on?`)
    } else if (stage === 'phone') {
      if (!PHONE.test(v)) { setError(v ? 'That phone number doesn’t look right.' : 'Add a phone number so we can call you.'); return }
      answers.current.phone = v; say('me', v); setValue(''); setStage('sending')
      const fd = new FormData()
      fd.set('goal', goal ?? ''); fd.set('postcode', answers.current.postcode); fd.set('name', answers.current.name); fd.set('phone', v)
      fd.set('page', window.location.pathname); fd.set('hp_check', (document.getElementById('phc-hp') as HTMLInputElement | null)?.value ?? '')
      const r = await sendChatLead(fd).catch(() => ({ ok: false, error: 'Something went wrong sending that. Please call us on 020 8904 9005.', field: undefined }))
      if (!r.ok) {
        const back: Stage = r.field === 'postcode' ? 'postcode' : r.field === 'name' ? 'name' : 'phone'
        setStage(back); await botSay(r.error ?? 'Something went wrong. Please try again.'); return
      }
      store('local', SENT_KEY, String(Date.now() + 365 * 864e5))
      setStage('done')
      const what = goal === 'manage' ? 'talk through how we’d manage it' : 'arrange your free valuation'
      await botSay(`Thank you, ${firstName(answers.current.name)}. We’ll call you ${callWhen()} to ${what}.`, 'If you’d rather message us, we’re on WhatsApp too.')
    }
  }

  const info = goal ? GOALS.find((x) => x.key === goal)! : null
  const asking = stage === 'postcode' || stage === 'name' || stage === 'phone' || stage === 'sending'
  const field = { postcode: { label: 'Postcode of the property', ph: 'e.g. HA3 0PS', type: 'text', auto: 'postal-code' }, name: { label: 'Your name', ph: 'Your name', type: 'text', auto: 'name' }, phone: { label: 'Phone number', ph: 'e.g. 07700 900123', type: 'tel', auto: 'tel' }, sending: { label: 'Phone number', ph: 'Sending…', type: 'tel', auto: 'tel' } }[stage as 'postcode' | 'name' | 'phone' | 'sending']

  return (
    <div className={`phc${ready ? ' phc-ready' : ''}`} style={lift && !open ? { bottom: lift } : undefined}>
      {open ? (
        <section className="phc-panel" role="dialog" aria-label="Chat with Preston Hill Estates">
          <header className="phc-head">
            <span className="phc-avatar"><LogoMark /></span>
            <span className="phc-title"><b>Preston Hill Estates</b><small>Preston Road, Harrow · since 2004</small></span>
            <button type="button" className="phc-x" onClick={close} aria-label="Close the chat"><Icon d={CLOSE_ICON} /></button>
          </header>
          <div className="phc-list" ref={listRef} aria-live="polite">
            {msgs.map((m) => <p key={m.id} className={`phc-msg phc-${m.from}`}>{m.text}</p>)}
            {typing ? <p className="phc-msg phc-bot phc-typing" aria-label="Typing"><i /><i /><i /></p> : null}
            {!typing && stage === 'choose' && msgs.length >= 2 ? (
              <div className="phc-choices">
                {GOALS.map((g) => <button key={g.key} type="button" onClick={() => choose(g.key)}>{g.label}</button>)}
                <button type="button" className="phc-quiet" onClick={() => choose('browse')}>I’m looking to buy or rent</button>
              </div>
            ) : null}
            {!typing && stage === 'browse' ? (
              <div className="phc-choices">
                <a href="/properties?channel=sale">Homes for sale</a>
                <a href="/properties?channel=let">Homes to rent</a>
                <a href="/renting">Register as a tenant</a>
                <button type="button" className="phc-quiet" onClick={() => setStage('choose')}>Back</button>
              </div>
            ) : null}
            {!typing && stage === 'done' ? (
              <div className="phc-choices">
                <a className="phc-wa" href={waLink(info?.wa ?? 'Hi Preston Hill Estates')} target="_blank" rel="noopener noreferrer"><WaIcon /> Message us on WhatsApp</a>
                <button type="button" className="phc-quiet" onClick={close}>Close</button>
              </div>
            ) : null}
          </div>
          {asking ? (
            <form className="phc-form" onSubmit={submit} noValidate>
              {error ? <p className="phc-err" role="alert">{error}</p> : null}
              <input id="phc-hp" name="hp_check" tabIndex={-1} autoComplete="off" aria-hidden="true" className="phc-hp" />
              <label htmlFor="phc-in" className="phc-sr">{field.label}</label>
              <input id="phc-in" ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} placeholder={field.ph} type={field.type} autoComplete={field.auto}
                inputMode={stage === 'phone' ? 'tel' : undefined} style={stage === 'postcode' ? { textTransform: 'uppercase' } : undefined} disabled={typing || stage === 'sending'} aria-invalid={error ? true : undefined} />
              <button type="submit" aria-label="Send" disabled={typing || stage === 'sending'}><Icon d={SEND_ICON} /></button>
            </form>
          ) : stage === 'choose' || stage === 'browse' ? (
            <p className="phc-foot"><a href={waLink('Hi Preston Hill Estates')} target="_blank" rel="noopener noreferrer"><WaIcon /> Prefer WhatsApp? Message us</a></p>
          ) : null}
        </section>
      ) : null}

      {!open && teaser ? (
        <div className="phc-teaser">
          <button type="button" className="phc-teaser-body" onClick={start}>
            <b>Thinking of selling, letting or need your property managed?</b>
            <span>Chat with us</span>
          </button>
          <button type="button" className="phc-teaser-x" onClick={() => { setTeaser(false); store('session', QUIET_KEY, '1') }} aria-label="Dismiss"><Icon d={CLOSE_ICON} /></button>
        </div>
      ) : null}

      {!open ? (
        <button ref={launcherRef} type="button" className="phc-launch" onClick={start} aria-label="Chat with us: selling, letting or management">
          <Icon d={CHAT_ICON} />
        </button>
      ) : null}
    </div>
  )
}
