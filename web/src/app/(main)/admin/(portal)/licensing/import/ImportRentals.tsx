'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { councilLabel, kindLabel, OCCUPANCY, fmtDay } from '@/lib/licensing-rules'
import { commitImport, previewImport, readImportFile, type ImportKind, type ImportRow, type Mapping } from '../../../licensing-actions'

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
const RENTMAN_FIELDS: { key: keyof Mapping; label: string; group: string }[] = [
  { key: 'rentmanRef', label: 'Property ref (Propref)', group: 'Rentman' }, { key: 'number', label: 'House / flat number', group: 'Rentman' }, { key: 'street', label: 'Street', group: 'Rentman' },
  { key: 'rent', label: 'Rent (Rental)', group: 'Rentman' }, { key: 'landlordRef', label: 'Landlord number (Llord)', group: 'Rentman' }, { key: 'rentmanArchived', label: 'Archived', group: 'Rentman' },
]
// Worth a look: a spelling that differs, more than one possible property, or (for a licensing sheet) no match at all.
const NEEDS_LOOK = (r: ImportRow) => !!r.match && (r.rentmanRef ? r.match.kind === 'likely' || r.match.kind === 'choose' : r.match.kind !== 'matched' || r.match.archived)
const toBase64 = async (f: File) => { const b = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }

export function ImportRentals() {
  const router = useRouter()
  const [file, setFile] = useState<{ name: string; b64: string; sheets: string[]; sheet: number; head: string[]; rows: string[][]; kind: ImportKind } | null>(null)
  const [choices, setChoices] = useState<Record<number, string>>({})
  const [only, setOnly] = useState<'all' | 'look'>('all')
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
      sheets: [], sheet: 0, head: [], rows: [], mapping: {}, kind: 'sheet' as ImportKind,
      error: `The portal didn’t answer (${(e?.message || 'no response').slice(0, 120)}). If the site has just been updated or was busy, wait a minute and try again. If it keeps happening, the file may be too large: save just the sheet you need as a new file.`,
    })), 4000)))
    setBusy(false)
    if (r.error && !r.sheets.length) { setFile(null); return setMsg({ ok: false, text: r.error }) }
    if (r.error) setMsg({ ok: false, text: r.error })
    setFile({ name, b64, sheets: r.sheets, sheet: r.sheet, head: r.head, rows: r.rows, kind: r.kind }); setMap(r.mapping); setChoices({}); setOnly('all')
  }
  const pick = async (f: File) => load(f.name, await toBase64(f), 0)
  useEffect(() => {
    if (!file) return
    const t = setTimeout(async () => {
      const r = await previewImport(file.rows, map).catch(() => null)
      if (!r) setMsg({ ok: false, text: 'The portal didn’t answer while reading the rows. Reload the page (⌘R or F5) and choose the file again: the portal may have been updated since this page was opened.' })
      setPreview(r)
    }, 300)
    return () => clearTimeout(t)
  }, [file, map])

  async function go() {
    if (!file) return
    setBusy(true)
    const label = `${file.name}${file.sheets.length > 1 ? ` · ${file.sheets[file.sheet]} tab` : ''}`
    let failed = ''
    const r = await commitImport(file.rows, map, update, choices, label).catch((e: Error) => { failed = e?.message ?? ''; return null })
    setBusy(false)
    // The page was opened before the portal was updated: its Import button no longer matches the server.
    if (!r && /server action|deployment|failed to find/i.test(failed)) return setMsg({ ok: false, text: 'The portal has been updated since this page was opened. Reload the page (⌘R or F5), choose the file again and press Import. Nothing was saved.' })
    if (!r) return setMsg({ ok: false, text: 'The portal didn’t answer: it may have been restarting. Wait a minute, reload the page and import again. If part of it was saved, nothing is duplicated.' })
    if (r.error) return setMsg({ ok: false, text: `The import stopped: ${r.error}. Nothing after that point was saved. Try again; if it happens again, send a screenshot of this message.` })
    setMsg({ ok: true, text: `${r.added} added${r.updated ? `, ${r.updated} already in the register updated` : ''}${r.joined ? ` (${r.joined} joined to the property from your licensing spreadsheet)` : ''}${r.skipped ? `, ${r.skipped} left out` : ''}. ${r.tracked} properties are now tracked for licensing. Councils, wards, EPCs, emails and council registers are being checked now.` })
    setFile(null); setPreview(null)
    setTimeout(() => router.push('/admin/licensing'), 4000)
  }
  const sample = (i: number | null | undefined) => (i == null ? '' : file?.rows.find((r) => r[i])?.[i] ?? '')
  const rentman = file?.kind === 'rentman' || map.rentmanRef != null
  const choiceOf = (r: ImportRow, i: number) => choices[i] ?? r.match?.choice ?? 'new'
  const all = preview?.map((r, i) => ({ r, i, c: choiceOf(r, i) })) ?? []
  const fresh = all.filter((x) => x.c === 'new').length, old = all.filter((x) => x.c !== 'new' && x.c !== 'skip').length, left = all.filter((x) => x.c === 'skip').length
  const found = preview?.filter((r) => r.postcodeFound).length ?? 0
  // A missing postcode doesn't matter on a row that goes onto a property we already have.
  const probs = (r: ImportRow, c: string) => (c === 'new' ? r.problems : r.problems.filter((x) => !/^No postcode|^No address/.test(x)))
  const bad = all.filter((x) => probs(x.r, x.c).length).length
  const n = (k: string) => preview?.filter((r) => r.match?.kind === k).length ?? 0
  const joining = preview?.filter((r) => r.rentmanRef && r.match?.id && r.match.how?.startsWith('Joins')).length ?? 0
  const archivedN = preview?.filter((r) => r.rentmanArchived).length ?? 0
  const alreadyIn = preview?.filter((r) => r.match?.how === 'Already in from Rentman').length ?? 0
  const look = preview?.filter(NEEDS_LOOK).length ?? 0
  // "To look at": more than one possible property first, then different spellings, then not found.
  const ORDER: Record<string, number> = { choose: 0, likely: 1, none: 2, matched: 3 }
  const shown = only === 'all' ? all : all.filter((x) => NEEDS_LOOK(x.r)).sort((a, b) => (ORDER[a.r.match?.kind ?? 'none'] ?? 3) - (ORDER[b.r.match?.kind ?? 'none'] ?? 3))
  const fields = rentman ? [...RENTMAN_FIELDS, ...FIELDS.filter((f) => !['address', 'address2'].includes(f.key) || map[f.key] != null)] : FIELDS

  return (
    <div className="lic-import">
      <div className="lic-import-pick">
        <label className="btn btn-gold">
          {busy && !file ? 'Reading…' : file ? 'Choose a different file' : 'Choose an Excel (.xlsx or .xls) or CSV file'}
          <input type="file" accept=".xlsx,.xls,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f) }} />
        </label>
        <a className="btn btn-ghost" download="licensing-register-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}>Download a template</a>
      </div>
      <p className="card-sub"><b>From Rentman:</b> export the property list (Propref, Number, Street, Town, Postcode, Rental, Archived, Llord) to Excel and choose it here. It’s recognised automatically; importing it again later adds new properties and updates the rest. <b>Your licensing spreadsheet:</b> choose it after the Rentman list, one tab at a time. Any column layout works: you match the columns below.</p>
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
            {fields.map((f) => (
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
                  {rentman ? (
                    <>
                      <h2>{preview.length} properties from Rentman</h2>
                      <p className="card-sub">
                        {fresh} new · {alreadyIn ? `${alreadyIn} already in (updated from Rentman) · ` : ''}{joining ? `${joining} joined to the same property from your licensing spreadsheet · ` : ''}{archivedN ? `${archivedN} archived on Rentman (kept for matching, but not tracked)` : ''}
                      </p>
                      <p className="card-sub">Rentman’s address and postcode replace ones typed on a spreadsheet or worked out by the portal. Licence details and certificates already in are kept. Nothing is saved until you press Import.</p>
                    </>
                  ) : (
                    <>
                      <h2>{preview.length} rows{all.some((x) => x.r.match) ? ` · ${n('matched')} matched to your properties` : ''}</h2>
                      {all.some((x) => x.r.match) ? (
                        <p className="card-sub">
                          {n('likely') ? <><b className="imp-k likely">{n('likely')} spelt differently</b> (matched to the closest: check them) · </> : null}
                          {n('choose') ? <><b className="imp-k choose">{n('choose')} could be more than one property</b> (choose which, or they’re left out) · </> : null}
                          {n('none') ? <><b className="imp-k none">{n('none')} not found</b> (added as new properties unless you pick one) · </> : null}
                          Licence details go onto the property each row is matched to.
                        </p>
                      ) : null}
                      <p className="card-sub">{found ? `${found} postcodes were found for you from the Land Registry address list (marked “found for you”). ` : ''}{bad ? `${bad} rows have something to check (in red); they can still be imported and fixed afterwards. ` : ''}Nothing is saved until you press Import.</p>
                    </>
                  )}
                  {old && !rentman ? <label className="imp-update"><input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} /> Add these details to the {old} matched properties (nothing there is overwritten; a certificate date is only moved later)</label> : null}
                  {look ? (
                    <div className="imp-sheets" role="group" aria-label="Show">
                      <span>Show:</span>
                      <button type="button" className={only === 'all' ? 'on' : ''} onClick={() => setOnly('all')}>All {preview.length}</button>
                      <button type="button" className={only === 'look' ? 'on' : ''} onClick={() => setOnly('look')}>{look} to look at</button>
                    </div>
                  ) : null}
                </div>
                <button type="button" className="btn btn-gold" disabled={busy || !(map.address != null || map.street != null)} onClick={go}>{busy ? 'Importing…' : `Import: ${fresh} new${old && (update || rentman) ? `, ${old} update` : ''}${left ? `, ${left} left out` : ''}`}</button>
              </div>
              <div className="table-wrap lic-import-table">
                <table className="list">
                  {rentman ? (
                    <>
                      <thead><tr><th>Ref</th><th>Address</th><th>Postcode</th><th>Rent</th><th>Landlord no.</th><th>On Rentman</th><th>In the register</th></tr></thead>
                      <tbody>
                        {shown.slice(0, 400).map(({ r, i, c }) => (
                          <tr key={i} className={r.problems.length ? 'bad' : undefined}>
                            <td className="addr-sub">{r.rentmanRef ?? '—'}</td>
                            <td>{r.address || '—'}{r.problems.length ? <div className="lic-problem">{r.problems.join('. ')}</div> : null}</td>
                            <td>{r.postcode ?? '—'}</td>
                            <td className="addr-sub">{r.rentPcm ? `£${r.rentPcm.toLocaleString('en-GB')}` : '—'}</td>
                            <td className="addr-sub">{r.landlordRef ?? '—'}</td>
                            <td className="addr-sub">{r.rentmanArchived ? 'Archived' : 'Current'}</td>
                            <td>{r.match ? <MatchPick r={r} c={c} set={(v) => setChoices((x) => ({ ...x, [i]: v }))} /> : <span className="addr-sub">{r.rentmanArchived ? 'Added, archived' : 'Added'}</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  ) : (
                    <>
                      <thead><tr><th>Row on the sheet</th><th>Our property</th><th>Council</th><th>Landlord</th><th>Licence</th><th>Expires</th><th>Gas</th><th>EICR</th><th>EPC</th></tr></thead>
                      <tbody>
                        {shown.slice(0, 400).map(({ r, i, c }) => (
                          <tr key={i} className={probs(r, c).length ? 'bad' : undefined}>
                            <td>{r.address || '—'}{c === 'new' && r.postcode ? <div className="addr-sub">{r.postcode}{r.postcodeFound ? ' · found for you' : ''}</div> : null}{probs(r, c).length ? <div className="lic-problem">{probs(r, c).join('. ')}</div> : null}</td>
                            <td>{r.match ? <MatchPick r={r} c={c} set={(v) => setChoices((x) => ({ ...x, [i]: v }))} /> : <span className="addr-sub">New property</span>}</td>
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
                    </>
                  )}
                </table>
              </div>
              {shown.length > 400 ? <p className="card-sub">Showing the first 400 of {shown.length}.</p> : null}
            </>
          ) : msg && !msg.ok ? null : <p className="card-sub">Reading the rows…</p>}
        </>
      ) : null}
    </div>
  )
}

/** Which property a row goes onto: the match, another candidate, a new property, or left out. */
function MatchPick({ r, c, set }: { r: ImportRow; c: string; set: (v: string) => void }) {
  const m = r.match!
  const opts = m.id && !m.candidates.some((x) => x.id === m.id) ? [{ id: m.id, label: m.label ?? 'Matched property' }, ...m.candidates] : m.candidates
  const tone = c === 'skip' ? 'skip' : c === 'new' ? (m.kind === 'none' ? 'none' : 'new') : c === m.id ? m.kind : 'picked'
  return (
    <div className={`imp-match k-${tone}`}>
      <select className="select" value={c} onChange={(e) => set(e.target.value)} aria-label="Our property">
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        <option value="new">Add as a new property</option>
        <option value="skip">Leave out</option>
      </select>
      {c === m.id && m.how ? <small>{m.how}</small> : c === 'skip' && m.kind === 'choose' ? <small>More than one fits: choose which</small> : c === 'new' && m.how ? <small>{m.how}</small> : null}
      {c === m.id && m.archived && !r.rentmanRef ? <small>Archived: it’ll be tracked again</small> : null}
      {r.rentmanRef && r.rentmanArchived && c !== 'skip' && c !== 'new' && !m.archived && m.how?.startsWith('Joins') ? <small>Archived on Rentman but on your licensing sheet: kept in the register</small> : null}
    </div>
  )
}
