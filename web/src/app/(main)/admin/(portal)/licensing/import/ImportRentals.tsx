'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { councilLabel, kindLabel, OCCUPANCY, fmtDay } from '@/lib/licensing-rules'
import { commitImport, previewImport, readImportFile, type ImportRow, type Mapping } from '../../../licensing-actions'

const TEMPLATE = 'Address,Postcode,Landlord,Landlord email,Landlord phone,Type,Licence type,Licence number,Licence status,Licence start,Licence expiry,Gas expiry,EICR expiry,EPC expiry,EPC rating,Notes\n"14 Kenton Road, Harrow",HA3 0AB,Mr A Shah,a.shah@example.com,07700 900000,Single household,Selective,BR/SL/12345,Granted,01/04/2024,31/03/2029,12/06/2027,01/02/2030,10/10/2033,D,\n'
const FIELDS: { key: keyof Mapping; label: string; group: string }[] = [
  { key: 'address', label: 'Address (first line)', group: 'Property' }, { key: 'address2', label: 'Address line 2', group: 'Property' }, { key: 'town', label: 'Town', group: 'Property' },
  { key: 'postcode', label: 'Postcode', group: 'Property' }, { key: 'occupancy', label: 'Type (single / HMO)', group: 'Property' }, { key: 'council', label: 'Council', group: 'Property' }, { key: 'ward', label: 'Ward', group: 'Property' },
  { key: 'landlordName', label: 'Landlord name', group: 'Landlord' }, { key: 'landlordEmail', label: 'Landlord email', group: 'Landlord' }, { key: 'landlordPhone', label: 'Landlord phone', group: 'Landlord' },
  { key: 'licenceKind', label: 'Licence type', group: 'Licence' }, { key: 'licenceNumber', label: 'Licence number', group: 'Licence' }, { key: 'licenceStatus', label: 'Licence status', group: 'Licence' },
  { key: 'licenceStart', label: 'Licence start', group: 'Licence' }, { key: 'licenceExpiry', label: 'Licence expiry', group: 'Licence' },
  { key: 'gasExpires', label: 'Gas safety expiry', group: 'Certificates' }, { key: 'eicrExpires', label: 'EICR expiry', group: 'Certificates' }, { key: 'epcExpires', label: 'EPC expiry', group: 'Certificates' }, { key: 'epcRating', label: 'EPC rating', group: 'Certificates' },
  { key: 'notes', label: 'Notes', group: 'Other' },
]
const toBase64 = async (f: File) => { const b = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }

export function ImportRentals() {
  const router = useRouter()
  const [file, setFile] = useState<{ name: string; b64: string; sheets: string[]; sheet: number; head: string[]; rows: string[][] } | null>(null)
  const [map, setMap] = useState<Mapping>({})
  const [preview, setPreview] = useState<ImportRow[] | null>(null)
  const [update, setUpdate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function load(name: string, b64: string, sheet: number) {
    setBusy(true); setMsg(null); setPreview(null)
    // If the server doesn't answer (e.g. it's restarting after an update), wait a moment and try once more.
    const ask = () => readImportFile(name, b64, sheet)
    const r = await ask().catch(() => new Promise<Awaited<ReturnType<typeof ask>>>((ok) => setTimeout(() => ask().then(ok).catch((e: Error) => ok({
      sheets: [], sheet: 0, head: [], rows: [], mapping: {},
      error: `The portal didn’t answer (${(e?.message || 'no response').slice(0, 120)}). If the site has just been updated or was busy, wait a minute and try again. If it keeps happening, the file may be too large: save just the sheet you need as a new file.`,
    })), 4000)))
    setBusy(false)
    if (r.error && !r.sheets.length) { setFile(null); return setMsg({ ok: false, text: r.error }) }
    if (r.error) setMsg({ ok: false, text: r.error })
    setFile({ name, b64, sheets: r.sheets, sheet: r.sheet, head: r.head, rows: r.rows }); setMap(r.mapping)
  }
  const pick = async (f: File) => load(f.name, await toBase64(f), 0)
  useEffect(() => {
    if (!file) return
    const t = setTimeout(async () => {
      const r = await previewImport(file.rows, map).catch(() => null)
      if (!r) setMsg({ ok: false, text: 'The portal didn’t answer while reading the rows. Wait a minute and choose the file again.' })
      setPreview(r)
    }, 300)
    return () => clearTimeout(t)
  }, [file, map])

  async function go() {
    if (!file) return
    setBusy(true)
    const r = await commitImport(file.rows, map, update).catch(() => null)
    setBusy(false)
    if (!r) return setMsg({ ok: false, text: 'The import didn’t finish. Try again.' })
    setMsg({ ok: true, text: `${r.added} added${r.updated ? `, ${r.updated} already in the register had their gaps filled` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}. Councils and wards are being looked up, and stored emails matched, now.` })
    setFile(null); setPreview(null)
    setTimeout(() => router.push('/admin/licensing'), 3000)
  }
  const sample = (i: number | null | undefined) => (i == null ? '' : file?.rows.find((r) => r[i])?.[i] ?? '')
  const fresh = preview?.filter((r) => !r.existing).length ?? 0, old = (preview?.length ?? 0) - fresh
  const found = preview?.filter((r) => r.postcodeFound).length ?? 0
  const bad = preview?.filter((r) => r.problems.length).length ?? 0

  return (
    <div className="lic-import">
      <div className="lic-import-pick">
        <label className="btn btn-gold">
          {busy && !file ? 'Reading…' : file ? 'Choose a different file' : 'Choose an Excel or CSV file'}
          <input type="file" accept=".xlsx,.csv,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f) }} />
        </label>
        <a className="btn btn-ghost" download="licensing-register-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}>Download a template</a>
      </div>
      <p className="card-sub"><b>From Rentman:</b> export your property list (with landlord details and any gas, EICR, EPC and licence dates you keep there) as Excel or CSV and choose it here. Any column layout works: you match the columns below.</p>
      {msg ? <div className={`notice ${msg.ok ? 'ok' : 'err'}`} style={{ marginTop: 12 }}>{msg.text}</div> : null}

      {file ? (
        <>
          {file.sheets.length > 1 ? (
            <div className="imp-sheets" role="group" aria-label="Sheet">
              <span>Sheet:</span>
              {file.sheets.map((n, i) => <button key={i} type="button" className={i === file.sheet ? 'on' : ''} disabled={busy} onClick={() => load(file.name, file.b64, i)}>{n}</button>)}
            </div>
          ) : null}
          <h2 style={{ marginTop: 22 }}>Match the columns · {file.name}{file.sheets.length > 1 ? ` · ${file.sheets[file.sheet]}` : ''} · {file.rows.length} rows</h2>
          <p className="card-sub">We’ve guessed which column is which. Change any that are wrong, or set them to “Not in this file”.</p>
          <div className="imp-map">
            {FIELDS.map((f) => (
              <label key={f.key} className={map[f.key] != null ? 'set' : undefined}>
                <span><small>{f.group}</small>{f.label}</span>
                <select className="select" value={map[f.key] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}>
                  <option value="">Not in this file</option>
                  {file.head.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
                <em>{sample(map[f.key]) ? `e.g. ${sample(map[f.key]).slice(0, 40)}` : ''}</em>
              </label>
            ))}
          </div>

          {preview ? (
            <>
              <div className="today-head" style={{ marginTop: 22 }}>
                <div>
                  <h2>{fresh} new{old ? ` · ${old} already in the register` : ''}</h2>
                  <p className="card-sub">{found ? `${found} postcodes were found for you from the Land Registry address list (marked “found for you”). ` : ''}{bad ? `${bad} rows have something to check (in red); they can still be imported and fixed afterwards. ` : ''}Nothing is saved until you press Import.</p>
                  {old ? <label className="imp-update"><input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} /> Fill in the blanks on the {old} already in the register (nothing there is overwritten; a certificate date is only moved later)</label> : null}
                </div>
                <button type="button" className="btn btn-gold" disabled={busy || !map.address} onClick={go}>{busy ? 'Importing…' : `Import ${fresh}${old && update ? ` and update ${old}` : ''}`}</button>
              </div>
              <div className="table-wrap lic-import-table">
                <table className="list">
                  <thead><tr><th>Address</th><th>Postcode</th><th>Council</th><th>Landlord</th><th>Licence</th><th>Expires</th><th>Gas</th><th>EICR</th><th>EPC</th></tr></thead>
                  <tbody>
                    {preview.slice(0, 300).map((r, i) => (
                      <tr key={i} className={r.problems.length ? 'bad' : undefined}>
                        <td>{r.address || '—'}{r.existing ? <span className="pill" style={{ marginLeft: 6 }}>Already in</span> : null}{r.problems.length ? <div className="lic-problem">{r.problems.join('. ')}</div> : null}</td>
                        <td>{r.postcode ?? '—'}{r.postcodeFound ? <div className="addr-sub" title="Found in the Land Registry address list from the house number and street. Check it.">found for you</div> : null}</td>
                        <td className="addr-sub">{r.council === 'auto' ? 'From postcode' : councilLabel(r.council)}{r.occupancy !== 'single' ? <div>{OCCUPANCY.find((o) => o.value === r.occupancy)?.label}</div> : null}</td>
                        <td className="addr-sub">{[r.landlordName, r.landlordEmail, r.landlordPhone].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="addr-sub">{r.licenceKind ? `${kindLabel(r.licenceKind)}${r.licenceNumber ? ` · ${r.licenceNumber}` : ''}${r.licenceStatus === 'applied' ? ` (applied${r.appliedOn ? ` ${fmtDay(r.appliedOn)}` : ''})` : ''}` : r.licenceNote ?? '—'}</td>
                        <td className="addr-sub">{fmtDay(r.licenceExpiry)}</td>
                        <td className="addr-sub">{fmtDay(r.gasExpires)}</td>
                        <td className="addr-sub">{fmtDay(r.eicrExpires)}</td>
                        <td className="addr-sub">{fmtDay(r.epcExpires)}{r.epcRating ? ` · ${r.epcRating}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.length > 300 ? <p className="card-sub">Showing the first 300 of {preview.length}.</p> : null}
            </>
          ) : msg && !msg.ok ? null : <p className="card-sub">Reading the rows…</p>}
        </>
      ) : null}
    </div>
  )
}
