'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ROLES, type Audience } from '@/lib/campaign'
import type { Person } from '@/lib/campaign-data'
import { listPeople, listRecipients } from '../../../campaign-actions'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' })
const STATUS: Record<string, { label: string; cls: string }> = { queued: { label: 'Waiting', cls: '' }, sent: { label: 'Sent', cls: 'live' }, failed: { label: 'Not sent', cls: 'warn' }, skipped: { label: 'Skipped', cls: 'draft' } }
const SIZE = 50

/**
 * Exactly who a campaign goes to. Before sending (pass `audience`), people can be taken off one by one;
 * once it has started (pass `campaignId` + `started`), it shows how each send went.
 */
export function PeopleList({ campaignId, audience, onExclude, started, ro }: {
  campaignId: string; audience?: Audience; onExclude?: (ids: string[]) => void; started?: boolean; ro?: boolean
}) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ total: number; excluded: number; people: Person[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const key = JSON.stringify({ audience: audience ? { ...audience, exclude: undefined } : null, q, status, page })

  useEffect(() => {
    let live = true
    setLoading(true)
    const t = setTimeout(async () => {
      const r = await (started ? listRecipients(campaignId, status, q, page) : listPeople(audience!, q, page)).catch(() => null)
      if (live && r) setData(r)
      if (live) setLoading(false)
    }, 250)
    return () => { live = false; clearTimeout(t) }
    // The exclude list is applied locally below, so ticking someone doesn't reload the page of results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const excluded = new Set(audience?.exclude ?? [])
  const toggle = (id: string) => onExclude?.(excluded.has(id) ? [...excluded].filter((x) => x !== id) : [...excluded, id])
  const pages = data ? Math.max(1, Math.ceil(data.total / SIZE)) : 1

  return (
    <div className="ppl">
      <div className="ppl-tools">
        <input className="input" type="search" placeholder="Search by name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} aria-label="Search people" />
        {started ? (
          <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }} aria-label="Show">
            <option value="">Everyone</option><option value="sent">Sent</option><option value="queued">Waiting</option><option value="failed">Not sent</option><option value="skipped">Skipped</option>
          </select>
        ) : null}
        <a className="btn btn-ghost btn-sm" href={`/api/admin/campaigns/${campaignId}/people`}>Download as spreadsheet</a>
      </div>
      <p className="card-sub ppl-count">
        {data ? <>{data.total.toLocaleString('en-GB')} {q ? 'matching' : started ? 'in this campaign' : 'on the enquiries list who fit'}{!started && excluded.size ? ` · ${excluded.size} taken off by hand` : ''}</> : 'Loading…'}
        {loading && data ? ' · updating…' : ''}
      </p>
      {data?.people.length ? (
        <div className="table-wrap ppl-table">
          <table className="list">
            <thead><tr>{!started ? <th aria-label="Gets it" /> : null}<th>Name</th><th>Email</th><th>Who</th><th>Last enquiry</th>{started ? <th>Status</th> : null}</tr></thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.id} className={excluded.has(p.id) ? 'off' : undefined}>
                  {!started ? <td><input type="checkbox" checked={!excluded.has(p.id)} disabled={ro} onChange={() => toggle(p.id)} aria-label={`Send to ${p.name}`} /></td> : null}
                  <td><Link className="addr-main" href={`/admin/contacts/${p.id}`} target="_blank">{p.name}</Link></td>
                  <td className="addr-sub">{p.email}</td>
                  <td className="addr-sub">{p.roles.map((r) => ROLES.find((x) => x.value === r)?.label).join(', ')}{p.area ? ` · ${p.area}` : ''}</td>
                  <td className="addr-sub">{p.last ? <>{p.last.what}<br />{day(p.last.date)}{p.enquiries > 1 ? ` · ${p.enquiries} enquiries` : ''}</> : '—'}</td>
                  {started ? <td><span className={`pill ${STATUS[p.status ?? '']?.cls ?? ''}`} title={p.error ?? undefined}>{STATUS[p.status ?? '']?.label ?? p.status}</span></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : data ? <p className="card-sub">Nobody {q ? 'matches that search' : 'yet'}.</p> : null}
      {pages > 1 ? (
        <div className="ppl-pages">
          <button type="button" className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} of {pages}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      ) : null}
    </div>
  )
}
