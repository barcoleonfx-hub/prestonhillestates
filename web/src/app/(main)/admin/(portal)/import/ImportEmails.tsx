'use client'
import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'

type Row = {
  key: string; date: string; category: 'portal' | 'website' | 'person' | 'skipped'; source: string; reason?: string
  name: string; email: string | null; phone: string | null; subject: string; about: string | null; intent: string | null
  details?: string[]; situation?: string | null
}

const GROUPS: { id: Row['category']; title: string; hint: string; tick: boolean }[] = [
  { id: 'portal', title: 'Zoopla and OnTheMarket leads', hint: 'Ticked: these are enquiries.', tick: true },
  { id: 'website', title: 'Website form emails', hint: 'Ticked: sent from your old website’s contact forms.', tick: true },
  { id: 'person', title: 'Emails from people', hint: 'Not ticked: tick the ones that are buyers, tenants, sellers or landlords.', tick: false },
]
const SRC: Record<string, string> = { zoopla: 'Zoopla', onthemarket: 'OnTheMarket', website: 'Website', email: 'Email' }
const INTENT: Record<string, string> = { buy: 'Buying', rent: 'Renting', valuation: 'Valuation' }
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const newBatch = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `b${Date.now()}${Math.random().toString(36).slice(2)}`)

export function ImportEmails({ retentionYears }: { retentionYears: number }) {
  const [batch] = useState(newBatch)
  const [rows, setRows] = useState<Row[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ imported: number; contacts: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)

  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    // From a chosen ".mbox" folder only the "mbox" file matters; ignore Apple's index files.
    const files = [...list].filter((f) => /(^|\/)mbox$|\.mbox$|\.mbx$|\.eml$/i.test(f.webkitRelativePath || f.name) || (!f.name.includes('.') && f.size > 0))
    if (!files.length) { setError('That doesn’t look like an exported mailbox. Choose the “mbox” file inside the exported folder, or .eml files.'); return }
    setError(null)
    let latest = rows
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      setBusy(`Reading ${f.name}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ''}… ${(f.size / 1048576).toFixed(1)} MB`)
      const res = await fetch(`/api/admin/import/upload?batch=${batch}&n=${i}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f })
      const r = (await res.json().catch(() => ({ error: 'The upload failed.' }))) as { rows?: Row[]; error?: string }
      if (!res.ok || !r.rows) { setError(r.error ?? 'The upload failed.'); break }
      latest = r.rows
    }
    setRows(latest)
    setPicked(new Set(latest.filter((r) => GROUPS.find((g) => g.id === r.category)?.tick).map((r) => r.key)))
    setBusy(null)
    if (fileRef.current) fileRef.current.value = ''
    if (dirRef.current) dirRef.current.value = ''
  }

  const toggle = (key: string) => setPicked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const setGroup = (id: Row['category'], on: boolean) => setPicked((s) => {
    const n = new Set(s); rows.filter((r) => r.category === id).forEach((r) => (on ? n.add(r.key) : n.delete(r.key))); return n
  })

  const commit = async () => {
    setBusy(`Importing ${picked.size} enquiries…`)
    const res = await fetch('/api/admin/import/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch, keys: [...picked] }) })
    const r = (await res.json().catch(() => ({}))) as { imported?: number; contacts?: number; error?: string }
    setBusy(null)
    if (!res.ok) return setError(r.error ?? 'The import failed.')
    setDone({ imported: r.imported ?? 0, contacts: r.contacts ?? 0 })
  }

  const skipped = useMemo(() => rows.filter((r) => r.category === 'skipped'), [rows])
  const reasons = useMemo(() => Object.entries(skipped.reduce<Record<string, number>>((m, r) => ({ ...m, [r.reason ?? 'Other']: (m[r.reason ?? 'Other'] ?? 0) + 1 }), {})), [skipped])

  if (done) {
    return (
      <section className="card card-pad imp-done">
        <h2>Imported {done.imported} enquir{done.imported === 1 ? 'y' : 'ies'}</h2>
        <p className="card-sub">Linked to {done.contacts} contact{done.contacts === 1 ? '' : 's'}. They appear on their original dates in Activity, Contacts and Enquiries, marked as already handled.</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <Link className="btn btn-gold" href="/admin/contacts">See contacts</Link>
          <Link className="btn btn-ghost" href="/admin/enquiries">See enquiries</Link>
          <button className="btn btn-ghost" type="button" onClick={() => location.reload()}>Import more</button>
        </div>
      </section>
    )
  }

  return (
    <div className="imp">
      {rows.length === 0 ? (
        <section className="card card-pad imp-how">
          <h2>1. Export your emails from Apple Mail</h2>
          <ol>
            <li>In Apple Mail, make a new mailbox: <b>Mailbox → New Mailbox…</b>, call it <b>Portal import</b>, “On My Mac”.</li>
            <li>Search your inbox (for example <b>zoopla</b>, <b>onthemarket</b>, <b>viewing</b>, <b>valuation</b>), select the enquiry emails from the last {retentionYears} years and <b>copy</b> them into Portal import (hold <kbd>⌥ Option</kbd> while dragging so they stay in your inbox too).</li>
            <li>Select <b>Portal import</b> in the sidebar, then <b>Mailbox → Export Mailbox…</b> and save it to your Desktop. You get a folder called <b>Portal import.mbox</b>.</li>
          </ol>
          <p className="card-sub">You can also export your whole Inbox the same way. The portal skips newsletters, automated emails, anything you sent, and anything older than {retentionYears} years.</p>
          <h2 style={{ marginTop: 20 }}>2. Upload it here</h2>
          <div className="imp-pick">
            <button type="button" className="btn btn-gold" onClick={() => dirRef.current?.click()} disabled={!!busy}>Choose the exported folder</button>
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={!!busy}>Or choose .mbox / .eml files</button>
            <input ref={dirRef} type="file" hidden onChange={(e) => upload(e.target.files)} {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
            <input ref={fileRef} type="file" hidden multiple onChange={(e) => upload(e.target.files)} />
          </div>
          <p className="card-sub">Nothing is saved until you’ve reviewed the list and clicked Import.</p>
        </section>
      ) : null}

      {busy ? <div className="notice ok" role="status">{busy}</div> : null}
      {error ? <div className="notice err" role="alert">{error}</div> : null}

      {rows.length > 0 ? (
        <>
          <div className="imp-bar card">
            <div><b>{picked.size}</b> of {rows.length - skipped.length} ticked to import{skipped.length ? ` · ${skipped.length} skipped` : ''}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={!!busy}>Add more files</button>
              <input ref={fileRef} type="file" hidden multiple onChange={(e) => upload(e.target.files)} />
              <button type="button" className="btn btn-gold" onClick={commit} disabled={!!busy || picked.size === 0}>Import {picked.size} enquir{picked.size === 1 ? 'y' : 'ies'}</button>
            </div>
          </div>
          {GROUPS.map((g) => {
            const list = rows.filter((r) => r.category === g.id)
            if (!list.length) return null
            const on = list.filter((r) => picked.has(r.key)).length
            return (
              <section key={g.id} className="card imp-group">
                <div className="imp-group-head">
                  <div><h2>{g.title} · {list.length}</h2><p className="card-sub">{g.hint}</p></div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGroup(g.id, true)} disabled={on === list.length}>Tick all</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGroup(g.id, false)} disabled={on === 0}>Untick all</button>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="list imp-table">
                    <thead><tr><th /><th>Date</th><th>Name</th><th>Contact</th><th>About</th><th>From</th></tr></thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.key} className={picked.has(r.key) ? 'on' : undefined} onClick={() => toggle(r.key)}>
                          <td><input type="checkbox" checked={picked.has(r.key)} onChange={() => toggle(r.key)} onClick={(e) => e.stopPropagation()} aria-label={`Import ${r.name}`} /></td>
                          <td className="num addr-sub">{day(r.date)}</td>
                          <td><div className="addr-main">{r.name}</div>{r.intent ? <div className="addr-sub">{INTENT[r.intent]}</div> : null}</td>
                          <td className="addr-sub">{[r.phone, r.email].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="addr-sub imp-about" title={r.details?.join('\n') || r.subject}>
                            <div className="imp-about-main">{r.about ?? r.subject}</div>
                            {r.details?.length ? <div className="imp-details">{r.details.filter((d) => !d.startsWith('Property:')).slice(0, 4).join(' · ')}</div> : null}
                          </td>
                          <td><span className="pill">{SRC[r.source] ?? r.source}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })}
          {skipped.length ? (
            <section className="card card-pad">
              <details>
                <summary className="det-sum">Skipped · {skipped.length}</summary>
                <ul className="imp-reasons">{reasons.map(([why, n]) => <li key={why}><b>{n}</b> {why}</li>)}</ul>
              </details>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
