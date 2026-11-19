'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ROLES, type Role } from '@/lib/campaign'
import { SEND_NOW_MAX, attachLimit, parseAddresses, renderLetter, type LetterProperty } from '@/lib/letter-email'
import type { LetterFile, ToMode } from '@/lib/letters'
import { aiWriteLetter, findContacts, groupCount, propertyBox, removeLetterFile, saveLetter, sendLetterAction, testLetter, uploadLetterFile, type LetterState } from '../../../../letter-actions'
import { AUDIENCES, LENGTHS, TONES, type AudienceKey, type LengthKey, type ToneKey } from '@/lib/email-writer-rules'

type Props = {
  id: string; initial: LetterState; files: LetterFile[]; properties: { id: string; channel: 'sale' | 'let'; label: string }[]
  property: LetterProperty | null; base: string; senderEmail: string; sent: boolean; canSend: boolean; today: string
}
const EMAIL_OK = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
const MB = (n: number) => `${(n / 1048576).toFixed(n < 1048576 ? 2 : 1)} MB`

export function LetterEditor(p: Props) {
  const router = useRouter()
  const [s, setS] = useState<LetterState>(p.initial)
  const [files, setFiles] = useState(p.files)
  const [property, setProperty] = useState<LetterProperty | null>(p.property)
  const [saved, setSaved] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved')
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ id: string; name: string; email: string; note: string | null }[]>([])
  const [groupTotal, setGroupTotal] = useState<number | null>(null)
  // "One person" typed in rather than picked from contacts: counts as soon as it's a valid address.
  const [typedOne, setTypedOne] = useState(() => (p.initial.one.contactId ? { email: '', name: '' } : { email: p.initial.one.email, name: p.initial.one.name }))
  useEffect(() => {
    if (s.one.contactId) return
    const email = EMAIL_OK(typedOne.email) ? typedOne.email.trim().toLowerCase() : ''
    if (email !== s.one.email || typedOne.name.trim() !== s.one.name) setS((x) => ({ ...x, one: { contactId: null, email, name: typedOne.name.trim() } }))
  }, [typedOne]) // eslint-disable-line react-hooks/exhaustive-deps
  // Writing the message with AI: the choices, what it said about who it wrote for, and the words before (to undo).
  const [ai, setAi] = useState<{ audience: AudienceKey; length: LengthKey; tone: ToneKey; notes: string }>({ audience: 'auto', length: 'standard', tone: 'warm', notes: '' })
  const [aiBusy, setAiBusy] = useState<'' | 'write' | 'improve'>('')
  const [aiSaid, setAiSaid] = useState<{ ok: boolean; text: string; who?: string } | null>(null)
  const [undo, setUndo] = useState<{ subject: string; body: string } | null>(null)
  const first = useRef(true)
  const ro = p.sent
  const c = s.content
  const set = (patch: Partial<LetterState>) => setS((x) => ({ ...x, ...patch }))
  const setC = (patch: Partial<LetterState['content']>) => setS((x) => ({ ...x, content: { ...x.content, ...patch } }))

  // Saves a moment after each change.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (ro) return
    setSaved('unsaved')
    const t = setTimeout(async () => { setSaved('saving'); const r = await saveLetter(p.id, s).catch(() => ({ error: 'x' })); setSaved('error' in r && r.error ? 'error' : 'saved') }, 900)
    return () => clearTimeout(t)
  }, [s, p.id, ro])

  // The property box for the chosen home.
  useEffect(() => { let on = true; propertyBox(c.propertyId).then((x) => on && setProperty(x)).catch(() => {}); return () => { on = false } }, [c.propertyId])
  // Searching the contact list for "one person".
  useEffect(() => { const t = setTimeout(() => { findContacts(q).then(setFound).catch(() => setFound([])) }, 250); return () => clearTimeout(t) }, [q])
  // How many people a group reaches.
  useEffect(() => {
    if (s.toMode !== 'groups') return
    const t = setTimeout(() => { groupCount(s.audience).then((r) => setGroupTotal(r.total)).catch(() => setGroupTotal(null)) }, 400)
    return () => clearTimeout(t)
  }, [s.toMode, s.audience])

  const typed = useMemo(() => parseAddresses(s.recipients), [s.recipients])
  const count = s.toMode === 'one' ? (s.one.email ? 1 : 0) : s.toMode === 'list' ? typed.list.length : (groupTotal ?? 0) + typed.list.length
  const sample = s.toMode === 'one' ? { email: s.one.email || 'them@example.com', name: s.one.name } : s.toMode === 'list' && typed.list[0] ? typed.list[0] : { email: 'sam@example.com', name: 'Sam Example' }
  const size = files.reduce((n, f) => n + f.size, 0)
  const rendered = useMemo(() => renderLetter(c, sample, {
    base: p.base, senderEmail: p.senderEmail, property, attachments: files.map((f) => f.name), date: p.today,
    footer: s.toMode === 'one' ? 'plain' : s.toMode === 'groups' ? 'unsubscribe' : 'reply', unsubscribeUrl: s.toMode === 'groups' ? `${p.base}/unsubscribe` : null,
  }), [c, sample.email, sample.name, property, files, p.base, p.senderEmail, p.today, s.toMode]) // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(list: FileList | null) {
    if (!list?.length) return
    setUploading(true); setNote(null)
    const fd = new FormData(); fd.set('id', p.id); for (const f of Array.from(list)) fd.append('file', f)
    const r = await uploadLetterFile(fd).catch(() => ({ ok: false as const, error: 'That didn’t upload. Try again.' }))
    setUploading(false)
    if (r.ok) setFiles(r.files); else setNote({ ok: false, text: r.error })
  }
  async function remove(fid: string) { const r = await removeLetterFile(p.id, fid); if (r.ok) setFiles(r.files) }
  async function test() {
    setBusy(true); setNote(null)
    const r = await testLetter(p.id, s).catch(() => ({ error: 'Couldn’t send the test.' }) as { error: string })
    setBusy(false)
    setNote('error' in r && r.error ? { ok: false, text: r.error } : { ok: true, text: `Test sent to ${(r as { to?: string }).to}. Check your inbox.` })
  }
  async function send() {
    const who = s.toMode === 'one' ? (s.one.name || s.one.email) : `${count} ${count === 1 ? 'person' : 'people'}`
    if (!window.confirm(`Send “${c.subject}” to ${who}?${count > SEND_NOW_MAX ? ' It will go out over the next while, a few at a time.' : ''}`)) return
    setBusy(true); setNote(null)
    const r = await sendLetterAction(p.id, s).catch(() => ({ error: 'Something went wrong. Nothing was sent.' }) as { error: string })
    setBusy(false)
    if ('error' in r && r.error) { setNote({ ok: false, text: r.error }); return }
    const res = r as { sent?: number; failed?: number; queued?: number; skipped?: { email: string; reason: string }[] }
    const skipped = res.skipped?.length ? ` Left out: ${res.skipped.map((x) => `${x.email} (${x.reason.toLowerCase()})`).join(', ')}.` : ''
    setNote({ ok: true, text: res.queued ? `Sending to ${res.queued} people in the background.${skipped}` : `Sent to ${res.sent}${res.failed ? `; ${res.failed} couldn’t be sent` : ''}.${skipped}` })
    router.refresh()
  }

  async function writeWithAi(mode: 'write' | 'improve') {
    if (mode === 'write' && c.body.trim() && !window.confirm('Replace your message with a new one written by AI? (You can undo it.)')) return
    setAiBusy(mode); setAiSaid(null)
    const r = await aiWriteLetter({ propertyId: c.propertyId, ...ai, mode, subject: c.subject, draft: c.body, contactId: s.toMode === 'one' ? s.one.contactId : null })
      .catch(() => ({ error: 'The AI couldn’t be reached. Try again.' }))
    setAiBusy('')
    if ('error' in r) { setAiSaid({ ok: false, text: r.error }); return }
    setUndo({ subject: c.subject, body: c.body })
    setC({ subject: r.subject || c.subject, body: r.body })
    setAiSaid({ ok: true, who: r.audience, text: r.why })
  }
  const channel = p.properties.find((x) => x.id === c.propertyId)?.channel
  const audiences = AUDIENCES.filter((a) => (channel === 'let' ? a.key !== 'first-time' && a.key !== 'downsizer' : a.key !== 'tenant'))

  const ready = !!c.subject.trim() && !!c.body.trim() && count > 0 && !typed.bad.length && size <= attachLimit(count)
  const roleOn = (r: Role) => s.audience.roles.includes(r)

  return (
    <div className="cmp">
      <div className="cmp-left">
        <section className="card card-pad">
          <h2 className="cmp-h">Who it’s to</h2>
          <div className="seg lt-mode" role="radiogroup" aria-label="Who it’s to">
            {([['one', 'One person'], ['list', 'Type addresses'], ['groups', 'Groups of contacts']] as [ToMode, string][]).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={s.toMode === k} className={s.toMode === k ? 'on' : undefined} onClick={() => !ro && set({ toMode: k })} disabled={ro}>{l}</button>
            ))}
          </div>

          {s.toMode === 'one' ? (
            <div className="lt-one">
              {s.one.contactId && s.one.email ? (
                <div className="lt-chosen"><span><b>{s.one.name || s.one.email}</b>{s.one.name ? <small>{s.one.email}</small> : null}</span>{!ro ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { set({ one: { contactId: null, email: '', name: '' } }); setTypedOne({ email: '', name: '' }) }}>Change</button> : null}</div>
              ) : (
                <>
                  <div className="field"><label htmlFor="lt-find">Find someone on your contacts</label><input id="lt-find" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or phone" autoComplete="off" /></div>
                  {found.length ? <ul className="lt-found">{found.map((f) => <li key={f.id}><button type="button" onClick={() => { set({ one: { contactId: f.id, email: f.email, name: f.name } }); setTypedOne({ email: '', name: '' }); setQ(''); setFound([]) }}><b>{f.name}</b><small>{f.email}{f.note ? ` · ${f.note}` : ''}</small></button></li>)}</ul> : null}
                  <p className="hint">Or type their email address (and name, for “Dear …”):</p>
                  <div className="cmp-two lt-typed">
                    <div className="field"><label htmlFor="lt-oe">Email</label><input id="lt-oe" className="input" type="email" value={typedOne.email} onChange={(e) => setTypedOne({ ...typedOne, email: e.target.value })} placeholder="name@example.com" disabled={ro} /></div>
                    <div className="field"><label htmlFor="lt-on">Name</label><input id="lt-on" className="input" value={typedOne.name} onChange={(e) => setTypedOne({ ...typedOne, name: e.target.value })} disabled={ro} /></div>
                  </div>
                  {typedOne.email.trim() && !EMAIL_OK(typedOne.email) ? <p className="te-err">That doesn’t look like an email address yet.</p> : null}
                </>
              )}
              <span className="hint">For a client who asked about a home. It also goes into their latest enquiry, so their reply lands there.</span>
            </div>
          ) : null}

          {s.toMode === 'groups' ? (
            <div className="lt-groups">
              <div className="cmp-roles">
                {ROLES.map((r) => (
                  <label key={r.value} className={`cmp-role${roleOn(r.value) ? ' on' : ''}`}>
                    <input type="checkbox" checked={roleOn(r.value)} disabled={ro} onChange={(e) => set({ audience: { ...s.audience, roles: e.target.checked ? [...s.audience.roles, r.value] : s.audience.roles.filter((x) => x !== r.value) } })} />{r.plural}
                  </label>
                ))}
              </div>
              <div className="cmp-two">
                <div className="field"><label htmlFor="lt-areas">Only these areas <span className="hint">(optional)</span></label><input id="lt-areas" className="input" value={s.audience.areas} disabled={ro} onChange={(e) => set({ audience: { ...s.audience, areas: e.target.value } })} placeholder="e.g. HA3, Kenton" /></div>
                <div className="field"><label htmlFor="lt-active">In touch within</label>
                  <select id="lt-active" className="select" value={s.audience.activeMonths ?? ''} disabled={ro} onChange={(e) => set({ audience: { ...s.audience, activeMonths: e.target.value ? Number(e.target.value) : null } })}>
                    <option value="">Any time</option><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option><option value="24">2 years</option>
                  </select>
                </div>
              </div>
              <p className="lt-count">{s.audience.roles.length ? (groupTotal == null ? 'Counting…' : `${groupTotal.toLocaleString('en-GB')} people`) : 'Tick at least one group.'} <span className="hint">People who unsubscribed or asked not to be contacted are always left out.</span></p>
            </div>
          ) : null}

          {s.toMode !== 'one' ? (
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="lt-to">{s.toMode === 'groups' ? 'And these addresses too (optional)' : 'Email addresses, one per line'}</label>
              <textarea id="lt-to" className="textarea" rows={s.toMode === 'groups' ? 2 : 4} value={s.recipients} onChange={(e) => set({ recipients: e.target.value })} disabled={ro} placeholder={'jo@example.com\nSam Example <sam@example.com>'} />
              <span className="hint">Add a name before the address for “Dear …”. Everyone gets their own copy and can’t see who else it went to.</span>
              {typed.list.length && s.toMode === 'list' ? <p className="te-people">{typed.list.slice(0, 30).map((r) => <span key={r.email}><b>{r.name || r.email}</b>{r.name ? ` · ${r.email}` : ''}</span>)}{typed.list.length > 30 ? <span>and {typed.list.length - 30} more</span> : null}</p> : null}
              {typed.bad.length ? <p className="te-err">Not email addresses: {typed.bad.join(', ')}</p> : null}
            </div>
          ) : null}
          <div className="field" style={{ marginTop: 12 }}><label htmlFor="lt-name">Name in your list (only you see this)</label><input id="lt-name" className="input" value={s.name} onChange={(e) => set({ name: e.target.value })} disabled={ro} /></div>
        </section>

        <section className="card card-pad">
          <h2 className="cmp-h">The email</h2>
          {!ro ? (
            <div className="ai-box">
              <div className="ai-head"><b>Write it with AI</b><span>Uses everything on the chosen property’s listing (description, key features, rooms and facts) and only that. Check it before you send.</span></div>
              <div className="ai-grid">
                <label className="field ai-who"><span className="flabel">Written for</span>
                  <select className="select" value={ai.audience} onChange={(e) => setAi({ ...ai, audience: e.target.value as AudienceKey })}>{audiences.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
                </label>
                <label className="field"><span className="flabel">Length</span>
                  <select className="select" value={ai.length} onChange={(e) => setAi({ ...ai, length: e.target.value as LengthKey })}>{(Object.keys(LENGTHS) as LengthKey[]).map((k) => <option key={k} value={k}>{LENGTHS[k].replace(/ \(.*$/, '')}</option>)}</select>
                </label>
                <label className="field"><span className="flabel">Tone</span>
                  <select className="select" value={ai.tone} onChange={(e) => setAi({ ...ai, tone: e.target.value as ToneKey })}>{(Object.keys(TONES) as ToneKey[]).map((k) => <option key={k} value={k}>{TONES[k].replace(/ and .*$/, '').replace(/^Short /, '')}</option>)}</select>
                </label>
              </div>
              <label className="field"><span className="flabel">Anything to mention? <span className="hint">(optional)</span></span>
                <input className="input" value={ai.notes} maxLength={600} onChange={(e) => setAi({ ...ai, notes: e.target.value })} placeholder="e.g. Open house Saturday 11 to 1. Chain free. New kitchen fitted this year." />
              </label>
              <div className="ai-actions">
                <button type="button" className="btn btn-dark" disabled={!!aiBusy || !c.propertyId} onClick={() => writeWithAi('write')}>{aiBusy === 'write' ? 'Writing… (about 20 seconds)' : 'Write it for me'}</button>
                <button type="button" className="btn btn-ghost" disabled={!!aiBusy || !c.body.trim()} onClick={() => writeWithAi('improve')}>{aiBusy === 'improve' ? 'Improving…' : 'Improve my message'}</button>
                {undo && !aiBusy ? <button type="button" className="btn btn-ghost" onClick={() => { setC(undo); setUndo(null); setAiSaid(null) }}>Undo</button> : null}
              </div>
              {!c.propertyId ? <p className="hint">Choose the property under “The property” first. “Improve my message” works without one.</p> : null}
              {aiSaid ? <p className={`notice ${aiSaid.ok ? 'ok' : 'err'}`}>{aiSaid.ok ? <>Written for <b>{aiSaid.who}</b>: {aiSaid.text} Read it through and change anything you like.</> : aiSaid.text}</p> : null}
            </div>
          ) : null}
          <div className="field"><label htmlFor="lt-subj">Subject line</label><input id="lt-subj" className="input" value={c.subject} onChange={(e) => setC({ subject: e.target.value })} disabled={ro} placeholder="e.g. 3 bed house on Kenton Road: the brochure you asked for" /></div>
          <div className="field"><label htmlFor="lt-greet">Greeting</label><input id="lt-greet" className="input" value={c.greeting} onChange={(e) => setC({ greeting: e.target.value })} disabled={ro} /><span className="hint">{'{first name}'} is filled in for each person; with no name it becomes “Hello,”.</span></div>
          <div className="field"><label htmlFor="lt-body">Message</label><textarea id="lt-body" className="textarea lt-body" rows={12} value={c.body} onChange={(e) => setC({ body: e.target.value })} disabled={ro} placeholder={'Write it as you would a letter.\n\nLeave a blank line between paragraphs. **Two stars** make words bold, links work as they are, and lines starting with "- " become bullet points.'} /></div>
        </section>

        <section className="card card-pad">
          <h2 className="cmp-h">The property</h2>
          <div className="field">
            <label htmlFor="lt-prop">Which property? <span className="hint">(optional)</span></label>
            <select id="lt-prop" className="select" value={c.propertyId ?? ''} onChange={(e) => setC({ propertyId: e.target.value || null, showProperty: true })} disabled={ro}>
              <option value="">None: just the letter</option>
              {(['sale', 'let'] as const).map((ch) => { const list = p.properties.filter((x) => x.channel === ch); return list.length ? <optgroup key={ch} label={ch === 'sale' ? 'For sale' : 'To let'}>{list.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup> : null })}
            </select>
            <span className="hint">Adds a small box under your message: the address, price, a few key details and a link to it on the website. No photos.</span>
          </div>
          {c.propertyId ? <label className="te-toggle"><input type="checkbox" checked={c.showProperty} onChange={(e) => setC({ showProperty: e.target.checked })} disabled={ro} /> Show the property box</label> : null}
        </section>

        <section className="card card-pad">
          <h2 className="cmp-h">Attachments</h2>
          {files.length ? <ul className="lt-files">{files.map((f) => <li key={f.id}><span><b>{f.name}</b><small>{MB(f.size)}</small></span>{!ro ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(f.id)}>Remove</button> : null}</li>)}</ul> : null}
          {!ro ? <label className="btn btn-ghost lt-upload">{uploading ? 'Uploading…' : files.length ? 'Add another file' : 'Attach files'}<input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={(e) => { upload(e.target.files); e.target.value = '' }} hidden /></label> : null}
          <p className="hint" style={{ marginTop: 8 }}>PDFs, photos or Word documents, up to 10 MB each and 15 MB in all{count > SEND_NOW_MAX ? '; to more than 25 people, 5 MB in all' : ''}. {files.length ? `Total ${MB(size)}.` : ''}</p>
          {size > attachLimit(count) ? <p className="te-err">To {count} people the attachments must come to {attachLimit(count) / 1048576} MB or less. Remove one or send a smaller version.</p> : null}
        </section>

        <section className="card card-pad">
          <h2 className="cmp-h">Signed by</h2>
          <div className="cmp-two">
            <div className="field"><label htmlFor="lt-so">Sign-off</label><input id="lt-so" className="input" value={c.signoff} onChange={(e) => setC({ signoff: e.target.value })} disabled={ro} /></div>
            <div className="field"><label htmlFor="lt-by">Name</label><input id="lt-by" className="input" value={c.signedBy} onChange={(e) => setC({ signedBy: e.target.value })} disabled={ro} /></div>
          </div>
          <div className="field"><label htmlFor="lt-title">Job title <span className="hint">(optional)</span></label><input id="lt-title" className="input" value={c.signTitle} onChange={(e) => setC({ signTitle: e.target.value })} disabled={ro} /></div>
        </section>
      </div>

      <div className="cmp-right">
        <section className="card cmp-preview">
          <div className="cmp-preview-head">
            <p className="card-sub" style={{ margin: 0 }}>As {sample.name || sample.email} will see it</p>
            <div className="seg" role="group" aria-label="Preview size">
              <button type="button" className={width === 'desktop' ? 'on' : ''} onClick={() => setWidth('desktop')}>Computer</button>
              <button type="button" className={width === 'mobile' ? 'on' : ''} onClick={() => setWidth('mobile')}>Phone</button>
            </div>
          </div>
          <div className="cmp-inbox"><b>{rendered.subject}</b>{files.length ? <span>📎 {files.length} attachment{files.length === 1 ? '' : 's'}</span> : null}</div>
          <div className="pmail-frame-wrap cmp-scroll"><iframe title="Email preview" className={`pmail-frame ${width}`} srcDoc={rendered.html} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" /></div>
        </section>

        <section className="card card-pad cmp-send">
          {note ? <div className={`notice ${note.ok ? 'ok' : 'err'}`}>{note.text}</div> : null}
          {!ro ? (
            <div className="cmp-send-row">
              <span className={`cmp-saved ${saved}`}>{{ saved: 'Saved', saving: 'Saving…', unsaved: 'Changes not saved yet', error: 'Not saved' }[saved]}</span>
              <button type="button" className="btn btn-ghost" disabled={busy || !p.canSend} onClick={test}>Send me a test</button>
              <button type="button" className="btn btn-gold" disabled={busy || !p.canSend || !ready} onClick={send}>
                {busy ? 'Sending…' : s.toMode === 'one' ? `Send to ${s.one.name || s.one.email || 'them'}` : `Send to ${count.toLocaleString('en-GB')} ${count === 1 ? 'person' : 'people'}`}
              </button>
            </div>
          ) : null}
          {!ro && (!ready || !p.canSend) ? (
            <div className="notice warn lt-missing"><b>Before you can send:</b>
              <ul>
                {!p.canSend ? <li>Connect the office mailbox in Email settings.</li> : null}
                {!count ? <li>{s.toMode === 'one' ? 'Choose the person from your contacts, or type their email address.' : s.toMode === 'groups' ? 'Tick at least one group (or add addresses).' : 'Add at least one email address.'}</li> : null}
                {typed.bad.length ? <li>Fix the addresses that aren’t email addresses.</li> : null}
                {!c.subject.trim() ? <li>Add a subject line.</li> : null}
                {!c.body.trim() ? <li>Write your message.</li> : null}
                {size > attachLimit(count) ? <li>Make the attachments smaller (see Attachments).</li> : null}
              </ul>
            </div>
          ) : null}
          {!p.canSend ? <p className="card-sub">Connect the office mailbox in Email settings to send.</p> : <p className="card-sub">Sent from {p.senderEmail}. {count > SEND_NOW_MAX ? 'Big sends go out a few at a time, within your daily campaign limit.' : 'A copy of each goes in Sent and the email history, and replies arrive in the inbox.'}</p>}
        </section>
      </div>
    </div>
  )
}
