import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { loadSchemes } from '@/lib/licensing'
import { KINDS, WARDS, councilLabel, fmtDay, isoDay, type Scheme } from '@/lib/licensing-rules'
import { saveRegister, saveScheme } from '../../../licensing-actions'
import { registers } from '@/lib/council-registers'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Council licensing schemes' }

function SchemeForm({ s }: { s?: Scheme }) {
  const council = s?.council ?? 'brent'
  const whole = s?.wards.includes('*')
  return (
    <form action={saveScheme} className="lic-form">
      {s ? <input type="hidden" name="id" value={s.id} /> : null}
      <div className="lic-grid">
        <div className="field wide"><label>Name</label><input name="name" className="input" defaultValue={s?.name ?? ''} required /></div>
        <div className="field"><label>Council</label><select name="council" className="select" defaultValue={council}><option value="brent">Brent</option><option value="harrow">Harrow</option></select></div>
        <div className="field"><label>Licence</label><select name="kind" className="select" defaultValue={s?.kind ?? 'selective'}>{KINDS.filter((k) => k.value !== 'mandatory_hmo').map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></div>
        <div className="field"><label>Starts</label><input name="startsOn" type="date" className="input" defaultValue={s?.startsOn} required /></div>
        <div className="field"><label>Ends</label><input name="endsOn" type="date" className="input" defaultValue={s?.endsOn} required /></div>
      </div>
      <label className="lic-whole"><input type="checkbox" name="whole" value="1" defaultChecked={whole} /> The whole borough</label>
      <div className="lic-wards">
        {WARDS[council === 'harrow' ? 'harrow' : 'brent'].map((w) => <label key={w}><input type="checkbox" name="wards" value={w} defaultChecked={!whole && !!s?.wards.includes(w)} /> {w}</label>)}
      </div>
      <p className="card-sub">Ward list shown for {councilLabel(council)}; save after changing the council to see the other list.</p>
      <div className="lic-grid">
        <div className="field wide"><label>Where this comes from</label><input name="sourceUrl" className="input" defaultValue={s?.sourceUrl ?? ''} placeholder="Link to the council’s page or designation notice" /></div>
        <div className="field wide"><label>Notes</label><input name="notes" className="input" defaultValue={s?.notes ?? ''} /></div>
      </div>
      <div className="actions" style={{ marginTop: 10 }}>
        <button className="btn btn-gold btn-sm" type="submit">{s ? 'Save' : 'Add scheme'}</button>
        {s ? <button className="btn btn-danger btn-sm" type="submit" name="delete" value="1">Delete</button> : null}
      </div>
    </form>
  )
}

export default async function SchemesPage() {
  await requireAdmin()
  const schemes = await loadSchemes()
  const today = isoDay(new Date())
  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/licensing" style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← Licensing register</Link>
          <h1 style={{ marginTop: 6 }}>Council licensing schemes</h1>
          <p className="sub">The selective and additional HMO schemes the register checks against. These were filled in from Brent’s and Harrow’s designation notices on 5 November 2026. Councils add, renew and end schemes, so check their pages when one is about to start or end, and update it here. Mandatory HMO licensing (5 or more people, 2 or more households) applies everywhere and doesn’t need a scheme.</p>
        </div>
      </div>
      {schemes.map((s) => {
        const state = s.endsOn < today ? 'Ended' : s.startsOn > today ? 'Starts soon' : 'In force'
        return (
          <details key={s.id} className="card card-pad lic-scheme">
            <summary>
              <span><b>{s.name}</b><span className="addr-sub"> · {fmtDay(s.startsOn)} to {fmtDay(s.endsOn)} · {s.wards.includes('*') ? 'whole borough' : `${s.wards.length} ward${s.wards.length === 1 ? '' : 's'}`}</span></span>
              <span className={`pill ${state === 'In force' ? 'live' : state === 'Ended' ? 'draft' : 'gold'}`}>{state}</span>
            </summary>
            {s.notes ? <p className="card-sub">{s.notes}</p> : null}
            {s.sourceUrl ? <p className="card-sub"><a href={s.sourceUrl} target="_blank" rel="noreferrer">Council source</a>{s.checkedOn ? ` · last updated here ${fmtDay(s.checkedOn)}` : ''}</p> : null}
            <SchemeForm s={s} />
          </details>
        )
      })}
      <details className="card card-pad lic-scheme"><summary><b>Add a scheme</b></summary><SchemeForm /></details>

      <h2 style={{ margin: '28px 0 6px' }}>Council registers the portal downloads</h2>
      <p className="card-sub" style={{ marginBottom: 12 }}>Checked every week. If a council moves its register, paste the new link here (the file itself, or the page that links to it).</p>
      {(await registers()).map((g) => (
        <form key={g.id} action={saveRegister} className="card card-pad lic-form" style={{ marginBottom: 10 }}>
          <input type="hidden" name="id" value={g.id} />
          <div className="today-head"><b>{g.name}</b><label className="lic-whole" style={{ margin: 0 }}><input type="checkbox" name="enabled" value="1" defaultChecked={g.enabled} /> Check it</label></div>
          <div className="lic-grid">
            <div className="field wide"><label>Register file (or page)</label><input name="url" className="input" defaultValue={g.url} /></div>
            <div className="field wide"><label>Council page that links to it (used if the file link stops working)</label><input name="pageUrl" className="input" defaultValue={g.pageUrl ?? ''} /></div>
          </div>
          <p className="card-sub">{g.lastOkAt ? `Last read ${fmtDay(g.lastOkAt.slice(0, 10))}${g.asOf ? `, register dated ${g.asOf}` : ''}.` : 'Not read yet.'}{g.lastError ? ` Last problem: ${g.lastError}` : ''}</p>
          <div className="actions" style={{ marginTop: 8 }}><button className="btn btn-ghost btn-sm" type="submit">Save</button></div>
        </form>
      ))}
    </>
  )
}
