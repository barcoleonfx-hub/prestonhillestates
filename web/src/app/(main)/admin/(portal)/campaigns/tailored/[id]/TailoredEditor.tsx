'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MAX_RECIPIENTS, gapsIn, parseRecipients, renderTailored, type EmailImage, type TailoredContent } from '@/lib/tailored-email'
import { saveTailored, sendTailored, testTailored, uploadEmailImage, type SendResult } from '../../../../tailored-actions'

export type ListingPick = { id: string; label: string; title: string; address: string; price: string; url: string; facts: string; photos: EmailImage[] }

type Props = {
  id: string; sent: boolean; initialName: string; initialRecipients: string; initialContent: TailoredContent; initialResults: SendResult[]
  base: string; senderEmail: string; canSend: boolean; listings: ListingPick[]
}

/** Adds a picture: uploads it, resized, and hands back where it lives. */
function AddPicture({ label, onAdd, disabled }: { label: string; onAdd: (img: EmailImage) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const pick = async (f: File | undefined) => {
    if (!f) return
    setBusy(true); setErr(null)
    const fd = new FormData(); fd.set('file', f)
    const r = await uploadEmailImage(fd).catch(() => ({ ok: false as const, error: 'Couldn’t upload that. Try again.' }))
    setBusy(false)
    if (input.current) input.current.value = ''
    if (r.ok) onAdd(r.image); else setErr(r.error)
  }
  return (
    <span className="te-add">
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy || disabled} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : label}</button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {err ? <small className="te-err">{err}</small> : null}
    </span>
  )
}

export function TailoredEditor(p: Props) {
  const router = useRouter()
  const [name, setName] = useState(p.initialName)
  const [to, setTo] = useState(p.initialRecipients)
  const [c, setC] = useState<TailoredContent>(p.initialContent)
  const [saved, setSaved] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved')
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<SendResult[]>(p.initialResults)
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop')
  const [as, setAs] = useState(0)
  const first = useRef(true)

  const set = <K extends keyof TailoredContent>(k: K, v: TailoredContent[K]) => setC((x) => ({ ...x, [k]: v }))
  const setS = <K extends keyof TailoredContent['spotlight']>(k: K, v: TailoredContent['spotlight'][K]) => setC((x) => ({ ...x, spotlight: { ...x.spotlight, [k]: v } }))
  const setT = <K extends keyof TailoredContent['terms']>(k: K, v: TailoredContent['terms'][K]) => setC((x) => ({ ...x, terms: { ...x.terms, [k]: v } }))

  // Saves a moment after each change.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (p.sent) return
    setSaved('unsaved')
    const t = setTimeout(async () => {
      setSaved('saving')
      const r: { ok?: boolean; error?: string } = await saveTailored(p.id, name, to, c).catch(() => ({ error: 'Not saved' }))
      setSaved(r.ok ? 'saved' : 'error')
    }, 900)
    return () => clearTimeout(t)
  }, [name, to, c, p.id, p.sent])

  const people = useMemo(() => parseRecipients(to), [to])
  const gaps = useMemo(() => gapsIn(c), [c])
  const previewAs = people.list[as] ?? { email: 'someone@example.com', name: '' }
  const rendered = useMemo(() => renderTailored(c, previewAs, { base: p.base, senderEmail: p.senderEmail }), [c, previewAs, p.base, p.senderEmail])

  const fill = (id: string) => {
    const l = p.listings.find((x) => x.id === id)
    if (!l) return
    setC((x) => ({ ...x, spotlight: { ...x.spotlight, show: true, title: l.title, address: l.address, price: l.price, facts: l.facts, link: l.url, linkLabel: 'See the full details', photos: l.photos } }))
  }

  const test = async () => {
    setBusy(true); setNote(null)
    const r: { ok?: boolean; error?: string; to?: string } = await testTailored(c).catch(() => ({ error: 'Couldn’t send the test.' }))
    setBusy(false)
    setNote(r.ok ? { ok: true, text: `Test sent to ${r.to}. Check how it looks, then send it for real.` } : { ok: false, text: r.error ?? 'Couldn’t send the test.' })
  }
  const send = async () => {
    const n = people.list.length
    if (!confirm(`Send this to ${n} ${n === 1 ? 'person' : 'people'}?\n\n${people.list.map((r) => r.name ? `${r.name} <${r.email}>` : r.email).join('\n')}`)) return
    setBusy(true); setNote(null)
    const r = await sendTailored(p.id, name, to, c).catch(() => ({ error: 'Couldn’t send. Check your connection and try again.' } as { error: string; results?: SendResult[]; ok?: boolean }))
    setBusy(false)
    if (r.results) setResults(r.results)
    if (r.ok) { setNote({ ok: true, text: `Sent to ${r.results!.filter((x) => x.ok).length} of ${n}. A copy of each is in Sent and in the email history.` }); router.refresh() }
    else setNote({ ok: false, text: r.error ?? 'Nothing was sent.' })
  }

  const ro = p.sent
  const ta = (v: string, on: (v: string) => void, rows: number, ph = '') => <textarea className="textarea" rows={rows} value={v} onChange={(e) => on(e.target.value)} placeholder={ph} disabled={ro} />
  const tx = (v: string, on: (v: string) => void, ph = '') => <input className="input" value={v} onChange={(e) => on(e.target.value)} placeholder={ph} disabled={ro} />

  return (
    <div className="cmp">
      <div className="cmp-left">
        <section className="card card-pad">
          <h2 className="cmp-h">Who it’s to</h2>
          <div className="field">
            <label htmlFor="te-to">Email addresses, one person per line</label>
            <textarea id="te-to" className="textarea" rows={4} value={to} onChange={(e) => setTo(e.target.value)} disabled={ro}
              placeholder={'jo@agency.co.uk\nFoxtons Wembley <wembley@foxtons.co.uk>'} />
            <span className="hint">Add a name before the address to use it in “Dear …”. Each person gets their own copy and can’t see who else it went to. Up to {MAX_RECIPIENTS} at a time.</span>
          </div>
          {people.list.length ? <p className="te-people">{people.list.map((r) => <span key={r.email}><b>{r.name || r.email}</b>{r.name ? ` · ${r.email}` : ''}</span>)}</p> : null}
          {people.bad.length ? <p className="te-err">Not email addresses: {people.bad.join(', ')}</p> : null}
          <div className="field" style={{ marginTop: 12 }}><label htmlFor="te-name">Name in your list (only you see this)</label><input id="te-name" className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={ro} /></div>
        </section>

        <section className="card card-pad">
          <h2 className="cmp-h">Subject and opening</h2>
          <div className="field"><label>Subject</label>{tx(c.subject, (v) => set('subject', v))}</div>
          <div className="field"><label>Preview line <span className="hint">(the grey text after the subject in an inbox)</span></label>{tx(c.preheader, (v) => set('preheader', v))}</div>
          <div className="field">
            <label>Banner picture <span className="hint">(optional, across the top)</span></label>
            {c.hero ? (
              <div className="te-pics"><figure><img src={c.hero.url} alt="" /><button type="button" className="te-x" onClick={() => set('hero', null)} disabled={ro} aria-label="Remove the banner picture">×</button></figure></div>
            ) : <AddPicture label="Add a banner picture" onAdd={(img) => set('hero', img)} disabled={ro} />}
          </div>
          <div className="cmp-two">
            <div className="field"><label>Small heading</label>{tx(c.eyebrow, (v) => set('eyebrow', v), 'e.g. Joint agency opportunity')}</div>
            <div className="field"><label>Big heading <span className="hint">(*words* in gold)</span></label>{tx(c.headline, (v) => set('headline', v))}</div>
          </div>
          <div className="cmp-two">
            <div className="field"><label>Greeting <span className="hint">({'{name}'} = their name)</span></label>{tx(c.greeting, (v) => set('greeting', v))}</div>
            <div className="field"><label>When there’s no name</label>{tx(c.fallbackName, (v) => set('fallbackName', v), 'Sir or Madam')}</div>
          </div>
          <div className="field"><label>Opening</label>{ta(c.intro, (v) => set('intro', v), 6)}<span className="hint">A blank line starts a new paragraph.</span></div>
        </section>

        <section className="card card-pad">
          <label className="te-toggle"><input type="checkbox" checked={c.spotlight.show} onChange={(e) => setS('show', e.target.checked)} disabled={ro} /><h2 className="cmp-h">Property spotlight</h2></label>
          {c.spotlight.show ? (
            <>
              {p.listings.length ? (
                <div className="field"><label>Fill in from one of our listings</label>
                  <select className="select" value="" onChange={(e) => fill(e.target.value)} disabled={ro}>
                    <option value="">Choose a listing…</option>
                    {p.listings.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </div>
              ) : null}
              <div className="field">
                <label>Photos <span className="hint">(the first is the big one; up to 4)</span></label>
                <div className="te-pics">
                  {c.spotlight.photos.map((ph, i) => (
                    <figure key={ph.id + i}><img src={ph.url} alt="" />{i === 0 ? <span className="te-main">Main</span> : null}
                      <button type="button" className="te-x" onClick={() => setS('photos', c.spotlight.photos.filter((_, j) => j !== i))} disabled={ro} aria-label="Remove this photo">×</button>
                      {i > 0 ? <button type="button" className="te-first" onClick={() => setS('photos', [ph, ...c.spotlight.photos.filter((_, j) => j !== i)])} disabled={ro}>Make main</button> : null}
                    </figure>
                  ))}
                </div>
                {c.spotlight.photos.length < 4 ? <AddPicture label="Add a photo" onAdd={(img) => setS('photos', [...c.spotlight.photos, img])} disabled={ro} /> : null}
              </div>
              <div className="cmp-two">
                <div className="field"><label>Small heading</label>{tx(c.spotlight.label, (v) => setS('label', v))}</div>
                <div className="field"><label>Title</label>{tx(c.spotlight.title, (v) => setS('title', v))}</div>
              </div>
              <div className="field"><label>Address</label>{tx(c.spotlight.address, (v) => setS('address', v))}</div>
              <div className="field"><label>Key points, one per line <span className="hint">(each gets a gold tick)</span></label>{ta(c.spotlight.facts, (v) => setS('facts', v), 4)}</div>
              <div className="field"><label>Price</label>{tx(c.spotlight.price, (v) => setS('price', v))}</div>
              <div className="cmp-two">
                <div className="field"><label>Link <span className="hint">(optional)</span></label>{tx(c.spotlight.link, (v) => setS('link', v), 'https://…')}</div>
                <div className="field"><label>Link wording</label>{tx(c.spotlight.linkLabel, (v) => setS('linkLabel', v))}</div>
              </div>
            </>
          ) : <p className="card-sub">A box with the property’s photos, address, key points and price.</p>}
        </section>

        <section className="card card-pad">
          <label className="te-toggle"><input type="checkbox" checked={c.terms.show} onChange={(e) => setT('show', e.target.checked)} disabled={ro} /><h2 className="cmp-h">Terms box</h2></label>
          {c.terms.show ? (
            <>
              <div className="field"><label>Heading</label>{tx(c.terms.title, (v) => setT('title', v))}</div>
              <div className="field"><label>One per line, as “Label: what it is”</label>{ta(c.terms.rows, (v) => setT('rows', v), 4, 'Our total fee: 1.5% of the final sale price\nYour share: 50%')}</div>
              <div className="field"><label>Small print <span className="hint">(optional)</span></label>{tx(c.terms.note, (v) => setT('note', v))}</div>
            </>
          ) : <p className="card-sub">A dark box that makes the important figures stand out, such as a fee split or rent.</p>}
        </section>

        <section className="card card-pad">
          <h2 className="cmp-h">Closing</h2>
          <div className="field"><label>The rest of the letter</label>{ta(c.body, (v) => set('body', v), 5)}</div>
          <div className="cmp-two">
            <div className="field"><label>Button <span className="hint">(optional)</span></label>{tx(c.cta.label, (v) => set('cta', { ...c.cta, label: v }), 'e.g. Reply to discuss')}</div>
            <div className="field"><label>Button link <span className="hint">({'{reply}'} = reply to us)</span></label>{tx(c.cta.url, (v) => set('cta', { ...c.cta, url: v }))}</div>
          </div>
          <div className="cmp-two">
            <div className="field"><label>Sign-off</label>{tx(c.signoff, (v) => set('signoff', v))}</div>
            <div className="field"><label>Your name</label>{tx(c.signedBy, (v) => set('signedBy', v))}</div>
          </div>
          <div className="cmp-two">
            <div className="field"><label>Your title</label>{tx(c.signTitle, (v) => set('signTitle', v))}</div>
            <div className="field"><label>Phone</label>{tx(c.phone, (v) => set('phone', v))}</div>
          </div>
        </section>
      </div>

      <div className="cmp-right">
        <section className="card cmp-preview">
          <div className="cmp-preview-head">
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="te-as">See it as</label>
              <select id="te-as" className="select" value={as} onChange={(e) => setAs(Number(e.target.value))}>
                {people.list.length ? people.list.map((r, i) => <option key={r.email} value={i}>{r.name ? `${r.name} · ${r.email}` : r.email}</option>) : <option value={0}>Someone without a name</option>}
              </select>
            </div>
            <div className="seg" role="group" aria-label="Preview size">
              <button type="button" className={width === 'desktop' ? 'on' : ''} onClick={() => setWidth('desktop')}>Computer</button>
              <button type="button" className={width === 'mobile' ? 'on' : ''} onClick={() => setWidth('mobile')}>Phone</button>
            </div>
          </div>
          <div className="cmp-inbox"><b>{rendered.subject}</b><span>{c.preheader}</span></div>
          <div className="pmail-frame-wrap cmp-scroll"><iframe title="Email preview" className={`pmail-frame ${width}`} srcDoc={rendered.html} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" /></div>
        </section>

        <section className="card card-pad cmp-send">
          {note ? <div className={`notice ${note.ok ? 'ok' : 'err'}`}>{note.text}</div> : null}
          {!ro && gaps.length ? <div className="notice warn">Fill in or delete before sending: {gaps.join(', ')}</div> : null}
          {!ro ? (
            <div className="cmp-send-row">
              <span className={`cmp-saved ${saved}`}>{{ saved: 'Saved', saving: 'Saving…', unsaved: 'Changes not saved yet', error: 'Not saved' }[saved]}</span>
              <button type="button" className="btn btn-ghost" disabled={busy || !p.canSend} onClick={test}>Send me a test</button>
              <button type="button" className="btn btn-gold" disabled={busy || !p.canSend || !people.list.length || !!people.bad.length || people.list.length > MAX_RECIPIENTS || !c.subject.trim() || !!gaps.length} onClick={send}>
                {busy ? 'Sending…' : `Send to ${people.list.length || ''} ${people.list.length === 1 ? 'person' : 'people'}`.replace('  ', ' ')}
              </button>
            </div>
          ) : null}
          {results.length ? (
            <ul className="te-results">
              {results.map((r) => <li key={r.email} className={r.ok ? 'ok' : 'bad'}><b>{r.ok ? 'Sent' : 'Not sent'}</b> {r.name ? `${r.name} · ` : ''}{r.email}{r.error ? <small> · {r.error}</small> : null}</li>)}
            </ul>
          ) : <p className="card-sub">Sent from {p.senderEmail}. A copy of each goes in Sent and the email history, and replies arrive in the inbox.</p>}
        </section>
      </div>
    </div>
  )
}
