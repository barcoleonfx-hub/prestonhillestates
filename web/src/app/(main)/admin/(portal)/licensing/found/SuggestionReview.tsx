'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { fmtDay, kindLabel } from '@/lib/licensing-rules'
import type { Suggestion } from '@/lib/licensing-scan'
import { dismissFound, useSuggestions } from '../../../licensing-actions'

export type Group = { rentalId: string; address: string; current: Record<'licence' | 'gas' | 'eicr' | 'epc', string | null>; items: Suggestion[] }
const LABEL = { licence: 'Licence', gas: 'Gas safety', eicr: 'EICR', epc: 'EPC' } as const

function what(s: Suggestion) {
  const f = s.found
  if (s.kind === 'licence') return [kindLabel(f.licenceKind ?? 'selective'), f.number, f.status === 'applied' ? `applied ${fmtDay(f.startsOn ?? null)}` : null, f.startsOn && f.status !== 'applied' ? `from ${fmtDay(f.startsOn)}` : null, f.expiresOn ? `until ${fmtDay(f.expiresOn)}` : null].filter(Boolean).join(' · ')
  return [f.expiresOn ? `Expires ${fmtDay(f.expiresOn)}` : 'No expiry date', f.inspectedOn ? `inspected ${fmtDay(f.inspectedOn)}` : null, f.rating ? `rated ${f.rating}` : null].filter(Boolean).join(' · ')
}
/** Ticked to start with: the sure ones that fill a gap or bring a date forward. */
const startTicked = (g: Group, s: Suggestion) => s.confidence === 'high' && (!g.current[s.kind] || (!!s.found.expiresOn && s.found.expiresOn > (g.current[s.kind] ?? '')))

export function SuggestionReview({ groups, compact }: { groups: Group[]; compact?: boolean }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(groups.flatMap((g) => g.items.filter((s) => startTicked(g, s)).map((s) => s.id))))
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const toggle = (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const ids = [...ticked]
  const use = (list: string[]) => start(async () => { const r = await useSuggestions(list); setMsg(`${r.applied} added to the register.${r.notes.length ? ` ${r.notes.join(' ')}` : ''}`); setTicked(new Set()) })
  const dismiss = (list: string[]) => start(async () => { await dismissFound(list); setMsg(`${list.length} dismissed.`); setTicked(new Set()) })
  if (!groups.length) return <p className="card-sub">{msg ?? 'Nothing waiting to be checked.'}</p>
  return (
    <div className="sug">
      {!compact ? (
        <div className="sug-bar">
          <span>{ids.length} ticked</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTicked(new Set(groups.flatMap((g) => g.items.map((s) => s.id))))}>Tick all</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTicked(new Set())}>Untick all</button>
          <button type="button" className="btn btn-gold btn-sm" disabled={!ids.length || pending} onClick={() => use(ids)}>{pending ? 'Working…' : `Use ${ids.length} ticked`}</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!ids.length || pending} onClick={() => dismiss(ids)}>Dismiss ticked</button>
        </div>
      ) : null}
      {msg ? <div className="notice ok">{msg}</div> : null}
      {groups.map((g) => (
        <div key={g.rentalId} className="sug-group">
          {!compact ? <h3><Link href={`/admin/licensing/${g.rentalId}`}>{g.address}</Link></h3> : null}
          {g.items.map((s) => (
            <div key={s.id} className={`sug-item c-${s.confidence}`}>
              <input type="checkbox" checked={ticked.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Use ${LABEL[s.kind]}`} />
              <div className="sug-main">
                <div className="sug-top"><b>{LABEL[s.kind]}</b><span>{what(s)}</span><span className={`sug-conf c-${s.confidence}`}>{s.confidence === 'high' ? 'Clear' : s.confidence === 'medium' ? 'Worked out' : 'Rough guess'}</span></div>
                <div className="sug-how">{s.found.how}. Now on file: {g.current[s.kind] ?? 'nothing'}.</div>
                <div className="sug-src">From “{s.doc.subject || '(no subject)'}” · {s.doc.fromAddr} · {s.doc.sentAt ? fmtDay(s.doc.sentAt.slice(0, 10)) : ''} · folder {s.doc.folder}
                  {s.doc.pdfs.map((f) => <span key={f.id}> · <a href={`/api/admin/licensing/files/${f.id}`} target="_blank" rel="noreferrer">Open {f.filename}</a></span>)}
                  {!s.doc.pdfs.length && s.doc.files ? ` · ${s.doc.files.split('\n').join(', ')}` : ''}
                </div>
              </div>
              {compact ? (
                <div className="actions">
                  <button type="button" className="btn btn-gold btn-sm" disabled={pending} onClick={() => use([s.id])}>Use</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => dismiss([s.id])}>Dismiss</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
