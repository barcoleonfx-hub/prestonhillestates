'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { renderEmail, type Draft, type EmailProperty, type EmailRecipient, type Sender } from '@/lib/property-email'
import { sendPropertyEmails, sendPropertyEmailTest } from '../../../../property-email-actions'

export type Row = {
  recipient: EmailRecipient
  draft: Draft
  score: number
  reasons: string[]
  lastAt: string
  sentAt: string | null
  lastError: string | null
}
type Status = { state: 'sending' | 'sent' | 'failed'; error?: string }

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' })
const CHUNK = 5

export function PropertyEmailer({ propertyId, prop, sender, rows, skipped, canSend }: {
  propertyId: string; prop: EmailProperty; sender: Sender; rows: Row[]
  skipped: { noEmail: number; optedOut: number; alreadyAsked: number }; canSend: boolean
}) {
  const router = useRouter()
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.filter((r) => !r.sentAt).map((r) => r.recipient.contactId)))
  const [active, setActive] = useState<string | null>(rows[0]?.recipient.contactId ?? null)
  const [edits, setEdits] = useState<Record<string, { subject: string; message: string }>>({})
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop')
  const frame = useRef<HTMLIFrameElement>(null)

  const row = rows.find((r) => r.recipient.contactId === active) ?? null
  const text = (r: Row) => edits[r.recipient.contactId] ?? { subject: r.draft.subject, message: r.draft.message }
  const preview = useMemo(() => {
    if (!row) return ''
    const t = edits[row.recipient.contactId] ?? { subject: row.draft.subject, message: row.draft.message }
    return renderEmail(prop, row.recipient, { ...row.draft, ...t }, sender).html
  }, [row, edits, prop, sender])

  // Grow the preview to the email's full height, again once the photos have loaded.
  useEffect(() => {
    const f = frame.current
    if (!f) return
    const fit = () => { const h = f.contentDocument?.body?.scrollHeight; if (h) f.style.height = `${h + 8}px` }
    const onLoad = () => { fit(); f.contentDocument?.querySelectorAll('img').forEach((i) => i.addEventListener('load', fit)) }
    f.addEventListener('load', onLoad)
    const t = [setTimeout(fit, 150), setTimeout(fit, 900)]
    return () => { f.removeEventListener('load', onLoad); t.forEach(clearTimeout) }
  }, [preview, width])

  const setText = (k: 'subject' | 'message', v: string) => {
    if (!row) return
    setEdits((e) => ({ ...e, [row.recipient.contactId]: { ...text(row), [k]: v } }))
  }
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const chosen = rows.filter((r) => picked.has(r.recipient.contactId) && status[r.recipient.contactId]?.state !== 'sent')
  const resending = chosen.filter((r) => r.sentAt).length

  async function send() {
    if (!chosen.length) return
    const msg = `Send ${chosen.length} email${chosen.length === 1 ? '' : 's'} from ${sender.email}?${resending ? `\n\n${resending} of them were already emailed about this property.` : ''}`
    if (!window.confirm(msg)) return
    setBusy(true); setNote(null)
    let sent = 0, failed = 0
    for (let i = 0; i < chosen.length; i += CHUNK) {
      const batch = chosen.slice(i, i + CHUNK)
      setStatus((s) => ({ ...s, ...Object.fromEntries(batch.map((r) => [r.recipient.contactId, { state: 'sending' as const }])) }))
      let res: Awaited<ReturnType<typeof sendPropertyEmails>>
      try {
        res = await sendPropertyEmails(propertyId, batch.map((r) => ({ contactId: r.recipient.contactId, ...text(r) })), resending > 0)
      } catch {
        res = { error: 'Lost connection to the portal. Check what was sent below and try the rest again.', results: [] }
      }
      if (res.error) {
        setStatus((s) => ({ ...s, ...Object.fromEntries(batch.map((r) => [r.recipient.contactId, { state: 'failed' as const, error: res.error }])) }))
        failed += batch.length
        setNote({ ok: false, text: res.error })
        break
      }
      const done = new Set(res.results.map((x) => x.contactId))
      setStatus((s) => ({
        ...s,
        ...Object.fromEntries(res.results.map((x) => [x.contactId, x.ok ? { state: 'sent' as const } : { state: 'failed' as const, error: x.error }])),
        ...Object.fromEntries(batch.filter((r) => !done.has(r.recipient.contactId)).map((r) => [r.recipient.contactId, { state: 'failed' as const, error: 'Not sent: stopped after an error.' }])),
      }))
      sent += res.results.filter((x) => x.ok).length
      failed += res.results.filter((x) => !x.ok).length + batch.filter((r) => !done.has(r.recipient.contactId)).length
      if (res.results.some((x) => !x.ok && /password|reach the outgoing/i.test(x.error ?? ''))) { setNote({ ok: false, text: res.results.find((x) => !x.ok)!.error! }); break }
    }
    setBusy(false)
    if (sent || !failed) setNote({ ok: !failed, text: `${sent} sent${failed ? `, ${failed} not sent (see the list)` : ''}. Copies are in the mailbox’s Sent folder, and replies will show in the Inbox.` })
    router.refresh()
  }

  async function test() {
    if (!row) return
    setBusy(true); setNote(null)
    const r = await sendPropertyEmailTest(propertyId, { contactId: row.recipient.contactId, ...text(row) }).catch(() => ({ error: 'Lost connection to the portal.' } as { error: string; ok?: undefined; to?: undefined }))
    setBusy(false)
    setNote(r.ok ? { ok: true, text: `Test sent to ${r.to}. Check how it looks on your phone and computer.` } : { ok: false, text: r.error ?? 'The test didn’t send.' })
  }

  if (!rows.length) {
    return (
      <section className="card card-pad">
        <h2>No one to email yet</h2>
        <p className="card-sub" style={{ marginTop: 8 }}>
          Nobody with an email address matches this listing on price, area and bedrooms.
          {skipped.noEmail ? ` ${skipped.noEmail} match${skipped.noEmail === 1 ? 'es' : ''} but we only have a phone number; they’re in “Other applicants to call”.` : ''}
          {skipped.optedOut ? ` ${skipped.optedOut} asked not to get property emails.` : ''}
        </p>
        <Link className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} href={`/admin/properties/${propertyId}#matches`}>Back to the property</Link>
      </section>
    )
  }

  return (
    <div className="pmail">
      <section className="card pmail-list" aria-label="Who gets an email">
        <div className="pmail-list-head">
          <div>
            <h2>{rows.length} {rows.length === 1 ? 'person' : 'people'} to email</h2>
            <p className="card-sub">Best matches first. {[
              skipped.noEmail ? `${skipped.noEmail} more match but have no email address` : '',
              skipped.optedOut ? `${skipped.optedOut} asked not to be emailed` : '',
              skipped.alreadyAsked ? `${skipped.alreadyAsked} already asked about this property` : '',
            ].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="pmail-bulk">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set(rows.filter((r) => !r.sentAt).map((r) => r.recipient.contactId)))}>Tick all</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>Untick all</button>
          </div>
        </div>
        <ul>
          {rows.map((r) => {
            const id = r.recipient.contactId, st = status[id]
            return (
              <li key={id} className={`pmail-row${id === active ? ' on' : ''}`}>
                <input type="checkbox" aria-label={`Email ${r.recipient.name}`} checked={picked.has(id)} disabled={busy || st?.state === 'sent'} onChange={() => toggle(id)} />
                <button type="button" className="pmail-pick" onClick={() => setActive(id)}>
                  <span className="pmail-name">{r.recipient.name}{edits[id] ? <span className="pmail-edited">edited</span> : null}</span>
                  <span className="pmail-mail">{r.recipient.email}</span>
                  <span className="pmail-why">{r.recipient.asked[0] ? `Asked about ${r.recipient.asked[0].what} · ${day(r.recipient.asked[0].when)}` : 'Gave us their requirements'}</span>
                </button>
                <span className="pmail-state">
                  {st?.state === 'sending' ? <span className="pill">Sending…</span>
                    : st?.state === 'sent' ? <span className="pill live">Sent</span>
                      : st?.state === 'failed' ? <span className="pill warn" title={st.error}>Not sent</span>
                        : r.sentAt ? <span className="pill" title="Already emailed about this property">Emailed {day(r.sentAt)}</span>
                          : r.lastError ? <span className="pill warn" title={r.lastError}>Failed before</span>
                            : <span className="pm-score sm" title="How well they match">{r.score}</span>}
                </span>
              </li>
            )
          })}
        </ul>
        <div className="pmail-send">
          {note ? <div className={`notice ${note.ok ? 'ok' : 'err'}`}>{note.text}</div> : null}
          <button type="button" className="btn btn-gold" disabled={!canSend || busy || !chosen.length} onClick={send}>
            {busy ? 'Sending…' : `Send ${chosen.length} email${chosen.length === 1 ? '' : 's'}`}
          </button>
          <p className="card-sub">Sent one by one from {sender.email}, so replies come back to the office. Each has an unsubscribe link.</p>
        </div>
      </section>

      {row ? (
        <section className="card pmail-edit" aria-label={`Email for ${row.recipient.name}`}>
          <div className="pmail-edit-head">
            <div>
              <h2>{row.recipient.name}</h2>
              <div className="pm-reasons">{row.reasons.map((x) => <span key={x}>{x}</span>)}{row.recipient.said.length ? <span>Mentioned: {row.recipient.said.join(', ')}</span> : null}</div>
            </div>
            <div className="pmail-tools">
              {edits[row.recipient.contactId] ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdits((e) => { const n = { ...e }; delete n[row.recipient.contactId]; return n })}>Back to suggested</button> : null}
              <button type="button" className="btn btn-ghost btn-sm" disabled={!canSend || busy} onClick={test}>Send me a test</button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="pm-subject">Subject</label>
            <input id="pm-subject" className="input" value={text(row).subject} onChange={(e) => setText('subject', e.target.value)} maxLength={150} />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="pm-message">Your message</label>
            <textarea id="pm-message" className="textarea" rows={9} value={text(row).message} onChange={(e) => setText('message', e.target.value)} maxLength={6000} />
            <span className="hint">The photos, price, “Why we thought of you” and highlights are added underneath automatically, picked for this person.</span>
          </div>
          <div className="pmail-preview-head">
            <h3>Preview</h3>
            <div className="seg" role="group" aria-label="Preview size">
              <button type="button" className={width === 'desktop' ? 'on' : ''} onClick={() => setWidth('desktop')}>Computer</button>
              <button type="button" className={width === 'mobile' ? 'on' : ''} onClick={() => setWidth('mobile')}>Phone</button>
            </div>
          </div>
          <div className="pmail-frame-wrap">
            <iframe
              title="Email preview" className={`pmail-frame ${width}`} srcDoc={preview} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              ref={frame}
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}
