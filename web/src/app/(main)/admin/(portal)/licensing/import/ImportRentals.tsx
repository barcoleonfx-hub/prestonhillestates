'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { kindLabel, OCCUPANCY, fmtDay } from '@/lib/licensing-rules'
import { commitImport, previewImport, type ImportRow } from '../../../licensing-actions'

const TEMPLATE = 'Address,Postcode,Landlord,Landlord email,Landlord phone,Type,Licence type,Licence number,Licence status,Licence start,Licence expiry,Gas expiry,EICR expiry,EPC expiry,EPC rating,Notes\n"14 Kenton Road, Harrow",HA3 0AB,Mr A Shah,a.shah@example.com,07700 900000,Single household,Selective,BR/SL/12345,Granted,01/04/2024,31/03/2029,12/06/2027,01/02/2030,10/10/2033,D,\n'

export function ImportRentals() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [unknown, setUnknown] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function load(t: string) {
    setText(t); setBusy(true); setMsg(null)
    const r = await previewImport(t).catch(() => null)
    setBusy(false)
    if (!r) return setMsg({ ok: false, text: 'Couldn’t read that file.' })
    setRows(r.rows); setUnknown(r.unknown)
    if (!r.rows.length) setMsg({ ok: false, text: 'No rows found. The first line should be the column headings.' })
  }
  async function go() {
    setBusy(true)
    const r = await commitImport(text).catch(() => null)
    setBusy(false)
    if (!r) return setMsg({ ok: false, text: 'The import didn’t finish. Try again.' })
    setMsg({ ok: true, text: `${r.added} properties added${r.skipped ? `, ${r.skipped} skipped (already in the register or no address)` : ''}. Councils and wards are being looked up now.` })
    setRows(null)
    setTimeout(() => router.push('/admin/licensing'), 2500)
  }
  const bad = rows?.filter((r) => r.problems.length).length ?? 0
  return (
    <div className="lic-import">
      <div className="lic-import-pick">
        <label className="btn btn-gold">
          Choose a CSV file
          <input type="file" accept=".csv,text/csv,.tsv,text/tab-separated-values" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) await load(await f.text()) }} />
        </label>
        <a className="btn btn-ghost" download="licensing-register-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}>Download a template</a>
      </div>
      <p className="card-sub">In Excel or Numbers: <b>File → Save As / Export → CSV</b>. Use headings like the template; the order doesn’t matter and extra columns are ignored. Dates like 31/03/2026 are fine.</p>
      <details className="lic-paste"><summary>Or paste the rows here</summary>
        <textarea className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste from the spreadsheet, including the heading row" />
        <button type="button" className="btn btn-ghost btn-sm" disabled={!text.trim() || busy} onClick={() => load(text)}>Read these rows</button>
      </details>
      {msg ? <div className={`notice ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div> : null}
      {rows?.length ? (
        <>
          <div className="today-head" style={{ marginTop: 18 }}>
            <div><h2>{rows.length} properties found</h2><p className="card-sub">{bad ? `${bad} have something to check (shown in red); they can still be imported and fixed afterwards.` : 'Everything looks readable.'}{unknown.length ? ` Columns not used: ${unknown.join(', ')}.` : ''}</p></div>
            <button type="button" className="btn btn-gold" disabled={busy} onClick={go}>{busy ? 'Importing…' : `Import ${rows.length} properties`}</button>
          </div>
          <div className="table-wrap lic-import-table">
            <table className="list">
              <thead><tr><th>Address</th><th>Postcode</th><th>Type</th><th>Landlord</th><th>Licence</th><th>Expires</th><th>Gas</th><th>EICR</th><th>EPC</th></tr></thead>
              <tbody>
                {rows.slice(0, 300).map((r, i) => (
                  <tr key={i} className={r.problems.length ? 'bad' : undefined} title={r.problems.join('. ')}>
                    <td>{r.address || '—'}{r.problems.length ? <div className="lic-problem">{r.problems.join('. ')}</div> : null}</td>
                    <td>{r.postcode ?? '—'}</td>
                    <td className="addr-sub">{OCCUPANCY.find((o) => o.value === r.occupancy)?.label}</td>
                    <td className="addr-sub">{r.landlordName ?? '—'}</td>
                    <td className="addr-sub">{r.licenceKind ? `${kindLabel(r.licenceKind)}${r.licenceNumber ? ` · ${r.licenceNumber}` : ''}${r.licenceStatus === 'applied' ? ' (applied)' : ''}` : '—'}</td>
                    <td className="addr-sub">{fmtDay(r.licenceExpiry)}</td>
                    <td className="addr-sub">{fmtDay(r.gasExpires)}</td>
                    <td className="addr-sub">{fmtDay(r.eicrExpires)}</td>
                    <td className="addr-sub">{fmtDay(r.epcExpires)}{r.epcRating ? ` · ${r.epcRating}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 300 ? <p className="card-sub">Showing the first 300.</p> : null}
        </>
      ) : null}
    </div>
  )
}
