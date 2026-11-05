import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { rentalRegister } from '@/lib/licensing'
import { bestOf, scanState, suggestionsFor } from '@/lib/licensing-scan'
import { mailboxStatus } from '@/lib/mailbox'
import { checkRegistersNow, findPostcodesNow, lastImport, setAutofill, startEmailScan } from '../../licensing-actions'
import { db } from '@/db/client'
import { licenceSuggestions, rentals, settings } from '@/db/schema'
import { count as countOf, eq } from 'drizzle-orm'
import { hitsFor, registers } from '@/lib/council-registers'
import { siteBase } from '@/lib/property-email-data'
import { LicTabs } from './LicTabs'
import { BUCKETS, KINDS, bucketOf, councilLabel, fmtDay, inWords, isoDay, kindLabel, type Bucket } from '@/lib/licensing-rules'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Licensing' }

type SP = { b?: string; council?: string; ward?: string; kind?: string; landlord?: string; q?: string; cert?: string; pc?: string; reg?: string }

export default async function LicensingPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin()
  const sp = await searchParams
  const [{ rows, schemes }, scan, waiting, box] = await Promise.all([rentalRegister(), scanState(), suggestionsFor(), mailboxStatus(), siteBase()])
  const toCheck = new Set(bestOf(waiting).map((s) => s.rentalId)).size
  const [regs, hits] = await Promise.all([registers(), hitsFor(rows.map((r) => r.id))])
  const regCouncils = new Set(regs.filter((r) => r.lastOkAt).map((r) => r.council))
  const onRegister = new Set(hits.filter((h) => h.h.found).map((h) => h.h.rentalId))
  // Properties in a council whose register we've read, thought to be licensed, but not found on it.
  const notListed = rows.filter((r) => regCouncils.has(r.council ?? '') && !onRegister.has(r.id) && ['ok', 'due30', 'due90', 'due180'].includes(r.a.bucket))
  const notListedIds = new Set(notListed.map((r) => r.id))
  const [autoRows, autoSetting] = await Promise.all([
    db.select({ id: licenceSuggestions.id, kind: licenceSuggestions.kind }).from(licenceSuggestions).where(eq(licenceSuggestions.status, 'auto')),
    db.query.settings.findFirst({ where: eq(settings.key, 'licensing_autofill') }),
  ])
  const autofillOn = autoSetting?.value !== 'off'
  const [li, [{ n: archivedN }]] = await Promise.all([lastImport(), db.select({ n: countOf() }).from(rentals).where(eq(rentals.archived, true))])
  const liAge = li ? Date.now() - Date.parse(li.at) : Infinity
  const liStuck = li?.status === 'running' && liAge > 10 * 60_000
  const withEpc = rows.filter((r) => r.epcRef).length, epcChecked = rows.filter((r) => r.epcCheckedAt).length
  const noPostcode = rows.filter((r) => !r.postcode).length
  const autoPostcode = rows.filter((r) => r.postcode && (r.postcodeSource === 'land_registry' || r.postcodeSource === 'online')).length
  const today = isoDay(new Date())
  const certBad = (r: (typeof rows)[number]) => r.a.certs.some((c) => c.state === 'expired' || c.state === 'due30' || (c.state === 'missing' && c.key !== 'epc'))
  const q = (sp.q ?? '').trim().toLowerCase()
  const shown = rows.filter((r) =>
    (!sp.b || r.a.bucket === sp.b) && (!sp.council || r.council === sp.council) && (!sp.ward || r.ward === sp.ward) &&
    (!sp.kind || r.a.needed === sp.kind || r.a.upcoming?.kind === sp.kind) && (!sp.landlord || (r.landlordName ?? '') === sp.landlord) &&
    (!sp.cert || certBad(r)) && (!sp.reg || notListedIds.has(r.id)) &&
    (!sp.pc || (sp.pc === 'none' ? !r.postcode : sp.pc === 'auto' ? !!r.postcode && (r.postcodeSource === 'land_registry' || r.postcodeSource === 'online') : true)) && (!q || `${r.address} ${r.postcode ?? ''} ${r.landlordName ?? ''} ${r.licences.map((l) => l.number).join(' ')}`.toLowerCase().includes(q)))
  const count = (b: Bucket) => rows.filter((r) => r.a.bucket === b).length
  const wards = [...new Set(rows.map((r) => r.ward).filter(Boolean))].sort() as string[]
  const councils = [...new Set(['brent', 'harrow', ...rows.map((r) => r.council).filter(Boolean)])] as string[]
  const landlords = [...new Set(rows.map((r) => r.landlordName).filter(Boolean))].sort() as string[]
  const link = (patch: Partial<SP>) => { const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]); const s = p.toString(); return `/admin/licensing${s ? `?${s}` : ''}` }
  const filtered = Object.values(sp).some(Boolean)

  // The next 12 months, by the month each licence (or scheme) runs out.
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + i); return d.toISOString().slice(0, 7) })
  const byMonth = months.map((m) => ({ m, items: rows.filter((r) => (r.a.validUntil ?? '').startsWith(m) && r.a.licence?.status === 'granted') }))
  const starting = schemes.filter((s) => s.startsOn > today && s.startsOn <= isoDay(new Date(Date.now() + 365 * 86400000)))
  const ending = schemes.filter((s) => s.endsOn >= today && s.endsOn <= isoDay(new Date(Date.now() + 365 * 86400000)))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Licensing</h1>
          <p className="sub">Every current property, checked against Brent and Harrow’s licensing schemes, with licence and certificate expiry dates. Checked again every few hours; reminders go out 6 months, 90, 60, 30, 14, 7 and 1 days before anything runs out.</p>
        </div>
        <div className="actions">
          <Link className="btn btn-ghost" href="/admin/licensing/schemes">Council schemes</Link>
          <Link className="btn btn-ghost" href="/admin/licensing/import">Import a spreadsheet</Link>
          <Link className="btn btn-gold" href="/admin/licensing/new">Add a property</Link>
        </div>
      </div>
      <LicTabs on="licensing" tracked={rows.length} />
      {li && liAge < 3 * 86400_000 ? (
        <div className={`notice ${li.status === 'done' ? 'ok' : li.status === 'running' && !liStuck ? '' : 'err'}`} style={{ marginBottom: 14 }}>
          <b>Last import: {li.label}</b> ({new Date(li.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}, {li.by}).{' '}
          {li.status === 'done' ? `${li.added ?? 0} added, ${li.updated ?? 0} updated${li.skipped ? `, ${li.skipped} left out` : ''}. ${li.tracked ?? rows.length} properties tracked.`
            : li.status === 'failed' ? <>It stopped with an error: {li.error}. <Link href="/admin/licensing/import">Import it again</Link>.</>
              : liStuck ? <>It didn’t finish: the portal restarted while it ran. <Link href="/admin/licensing/import">Import it again</Link>; nothing is duplicated.</>
                : 'Still running…'}
        </div>
      ) : null}
      {archivedN > rows.length ? (
        <div className="notice" style={{ marginBottom: 14 }}>
          <b>{archivedN.toLocaleString('en-GB')} properties are archived on Rentman</b> and kept for records only. The properties on your licensing spreadsheet are the ones tracked here: <Link href="/admin/licensing/import">import the spreadsheet</Link> (Main tab first, then Brent, Harrow and the rest) and each one it matches is tracked again.
        </div>
      ) : null}

      {starting.length || ending.length ? (
        <div className="notice lic-schemes-note">
          {starting.map((s) => <div key={s.id}><b>{s.name}</b> starts on {fmtDay(s.startsOn)} ({inWords(Math.round((Date.parse(s.startsOn) - Date.now()) / 86400000))}). Properties it covers are marked “Scheme starting soon”.</div>)}
          {ending.map((s) => <div key={s.id}><b>{s.name}</b> ends on {fmtDay(s.endsOn)}. Check whether {councilLabel(s.council)} is renewing it.</div>)}
        </div>
      ) : null}

      {rows.length ? (
        <section className="card card-pad lic-auto">
          <div className="today-head">
            <div>
              <h2>Filling itself in</h2>
              <p className="card-sub">
                Add addresses and the portal does the rest: postcodes, council and ward, EPCs from GOV.UK, licences and certificates from your emails, and the councils’ registers.
                {autofillOn ? ' Clear details (dates written in the council’s email, register or certificate, and official EPC records) fill in the gaps by themselves; worked-out dates and guesses wait for you. Nothing you’ve entered is ever overwritten.' : ' Automatic filling is off: everything waits for you to check.'}
              </p>
            </div>
            <form action={setAutofill}><input type="hidden" name="on" value={autofillOn ? '0' : '1'} /><button className="btn btn-ghost btn-sm" type="submit">{autofillOn ? 'Turn off automatic filling' : 'Turn on automatic filling'}</button></form>
          </div>
          <ul className="lic-autolist">
            <li><b>{rows.length - noPostcode}</b> of {rows.length} have a postcode</li>
            <li><b>{withEpc}</b> EPCs found on GOV.UK{epcChecked > withEpc ? ` (${epcChecked - withEpc} checked with none listed)` : ''}</li>
            <li><b>{autoRows.length}</b> details filled in automatically{autoRows.length ? <> · <Link href="/admin/licensing/found#auto">see or undo them</Link></> : null}</li>
            <li><b>{toCheck}</b> propert{toCheck === 1 ? 'y' : 'ies'} with details waiting for you{toCheck ? <> · <Link href="/admin/licensing/found">check them</Link></> : null}</li>
          </ul>
        </section>
      ) : null}

      {rows.length ? (
        <section className="card card-pad lic-scan">
          <div className="today-head">
            <div>
              <h2>Fill in from our emails</h2>
              <p className="card-sub">
                {scan.status === 'searching' ? 'Searching every folder of the mailbox for council licence emails and safety certificates…'
                  : scan.status === 'reading' ? `Reading ${scan.queued.toLocaleString('en-GB')} likely emails and their PDF attachments: ${scan.read.toLocaleString('en-GB')} done, ${scan.docs.toLocaleString('en-GB')} relevant so far. This carries on in the background; you can leave the page.`
                    : scan.status === 'done' ? `Last scan ${fmtDay(scan.finishedAt?.slice(0, 10) ?? null)}: ${scan.read.toLocaleString('en-GB')} emails read, ${scan.docs.toLocaleString('en-GB')} licences and certificates found. New properties are matched against them automatically.`
                      : scan.status === 'error' ? `The last scan stopped: ${scan.error}`
                        : `Reads the whole mailbox (every folder, the last 6 years) for council licence emails, gas safety records, EICRs and EPCs, including PDF attachments, and matches them to these ${rows.length} properties by address. You check everything before it’s added.`}
                {scan.error && scan.status !== 'error' ? ` ${scan.error}` : ''}
              </p>
            </div>
            <div className="actions">
              {toCheck ? <Link className="btn btn-gold btn-sm" href="/admin/licensing/found">Check {toCheck} propert{toCheck === 1 ? 'y' : 'ies'} with details found</Link> : null}
              {scan.status !== 'searching' && scan.status !== 'reading' ? (
                <form action={startEmailScan}><button className="btn btn-ghost btn-sm" type="submit" disabled={!box?.hasPassword}>{scan.status === 'idle' ? 'Search our emails' : 'Search again'}</button></form>
              ) : null}
            </div>
          </div>
          {scan.status === 'reading' && scan.queued ? <div className="cmp-bar"><span style={{ width: `${Math.round((scan.read / scan.queued) * 100)}%` }} /></div> : null}
          {!box?.hasPassword ? <p className="card-sub">Connect the mailbox in <Link href="/admin/email-inbox">Email settings</Link> first.</p> : null}
        </section>
      ) : null}

      {rows.length ? (
        <div className="lic-two">
          <section className="card card-pad lic-regs">
            <div className="today-head">
              <div>
                <h2>Council registers</h2>
                <p className="card-sub">Brent and Harrow publish their registers of licensed properties. The portal downloads them every week and looks for each of your properties. Applications still being processed aren’t listed.</p>
              </div>
              <form action={checkRegistersNow}><button className="btn btn-ghost btn-sm" type="submit">Check now</button></form>
            </div>
            <ul className="lic-reglist">
              {regs.map((g) => {
                const mine = hits.filter((h) => h.h.registerId === g.id)
                return (
                  <li key={g.id}>
                    <b>{g.name}</b>
                    <span className="addr-sub">
                      {g.lastOkAt ? `Read ${fmtDay(g.lastOkAt.slice(0, 10))}${g.asOf ? ` (register dated ${g.asOf})` : ''} · ${mine.filter((h) => h.h.found).length} of ${mine.length} of your ${councilLabel(g.council)} properties listed` : g.lastError ? '' : 'Not read yet: it runs within the next few minutes, or press Check now.'}
                      {g.lastError ? <span className="lic-regerr"> {g.lastError}</span> : null}
                    </span>
                    {g.docId ? <Link className="lic-linkish" href={`/api/admin/licensing/registers/${g.id}`} target="_blank" rel="noreferrer">Open the downloaded register</Link> : null}
                  </li>
                )
              })}
              <li><b>Ealing and other councils</b><span className="addr-sub">Only searchable on their websites: use “Check the council’s register” on each property.</span></li>
            </ul>
            {notListed.length ? <Link className="btn btn-dark btn-sm" href={link({ reg: '1' })}>{notListed.length} we think are licensed weren’t found on the register</Link> : null}
          </section>
          <section className="card card-pad lic-pcs">
            <h2>Postcodes</h2>
            <p className="card-sub">{noPostcode ? `${noPostcode} propert${noPostcode === 1 ? 'y has' : 'ies have'} no postcode, so the ward (and whether a licence is needed) can’t be worked out.` : 'Every property has a postcode.'} {autoPostcode ? `${autoPostcode} were found automatically: worth a quick check.` : ''}</p>
            <div className="actions" style={{ marginTop: 10 }}>
              {noPostcode ? <Link className="btn btn-ghost btn-sm" href={link({ pc: 'none' })}>Show the {noPostcode} without</Link> : null}
              {autoPostcode ? <Link className="btn btn-ghost btn-sm" href={link({ pc: 'auto' })}>Check the {autoPostcode} found automatically</Link> : null}
              {noPostcode ? <form action={findPostcodesNow}><button className="btn btn-gold btn-sm" type="submit">Find missing postcodes</button></form> : null}
            </div>
            <p className="card-sub" style={{ marginTop: 8 }}>Tries the Land Registry address list (reads shortened and misspelt streets), then a map look-up. Runs in the background.</p>
          </section>
        </div>
      ) : null}

      {!rows.length ? (
        <section className="card card-pad lic-empty">
          <h2>Start your licensing register</h2>
          <ol>
            <li><b>Import your current list</b> from Excel or Numbers (saved as CSV), or add properties one at a time.</li>
            <li>The portal looks up each property’s <b>council and ward</b> from its postcode and works out whether it needs a selective or HMO licence.</li>
            <li>Add each licence’s <b>number and expiry date</b>, plus gas, EICR and EPC dates. You’ll be reminded well before anything runs out.</li>
          </ol>
          <div className="actions" style={{ marginTop: 14 }}><Link className="btn btn-gold" href="/admin/licensing/import">Import a spreadsheet</Link><Link className="btn btn-ghost" href="/admin/licensing/new">Add a property</Link></div>
        </section>
      ) : (
        <>
          <div className="lic-tiles">
            {BUCKETS.map((b) => (
              <Link key={b.value} href={link({ b: sp.b === b.value ? undefined : b.value })} className={`lic-tile t-${b.tone}${sp.b === b.value ? ' on' : ''}${count(b.value) ? '' : ' zero'}`} title={b.about}>
                <b>{count(b.value)}</b><span>{b.label}</span>
              </Link>
            ))}
            <Link href={link({ cert: sp.cert ? undefined : '1' })} className={`lic-tile t-amber${sp.cert ? ' on' : ''}${rows.filter(certBad).length ? '' : ' zero'}`} title="Gas safety or EICR expired, due within 30 days or not on file; EPC expired or below E.">
              <b>{rows.filter(certBad).length}</b><span>Certificates missing or due</span>
            </Link>
          </div>

          <form className="lic-filters" action="/admin/licensing">
            <input className="input" name="q" defaultValue={sp.q} placeholder="Search address, landlord or licence number" aria-label="Search" />
            <select className="select" name="council" defaultValue={sp.council ?? ''} aria-label="Council"><option value="">All councils</option>{councils.map((c) => <option key={c} value={c}>{councilLabel(c)}</option>)}</select>
            <select className="select" name="ward" defaultValue={sp.ward ?? ''} aria-label="Ward"><option value="">All wards</option>{wards.map((w) => <option key={w}>{w}</option>)}</select>
            <select className="select" name="kind" defaultValue={sp.kind ?? ''} aria-label="Licence"><option value="">Any licence</option>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
            <select className="select" name="landlord" defaultValue={sp.landlord ?? ''} aria-label="Landlord"><option value="">All landlords</option>{landlords.map((l) => <option key={l}>{l}</option>)}</select>
            {sp.b ? <input type="hidden" name="b" value={sp.b} /> : null}
            {sp.cert ? <input type="hidden" name="cert" value="1" /> : null}
            <button className="btn btn-dark btn-sm" type="submit">Filter</button>
            {filtered ? <Link className="btn btn-ghost btn-sm" href="/admin/licensing">Clear</Link> : null}
          </form>

          <section className="card">
            <div className="table-wrap">
              <table className="list lic-table">
                <thead><tr><th>Property</th><th>Area</th><th>Needs</th><th>Status</th><th>Licence</th><th>Certificates</th><th>Landlord</th><th>Checked</th></tr></thead>
                <tbody>
                  {shown.map((r) => {
                    const b = bucketOf(r.a.bucket)
                    return (
                      <tr key={r.id} className={`tone-${b.tone}`}>
                        <td><Link className="addr-main" href={`/admin/licensing/${r.id}`}>{r.address}</Link><div className="addr-sub">{r.postcode ?? 'No postcode'}{r.postcode && (r.postcodeSource === 'land_registry' || r.postcodeSource === 'online') ? ' · found automatically' : ''}</div>{notListedIds.has(r.id) ? <div className="lic-notlisted">Not found on the council register</div> : onRegister.has(r.id) ? <div className="lic-listed">On the council register</div> : null}</td>
                        <td className="addr-sub">{r.council ? councilLabel(r.council) : '—'}{r.ward ? <><br />{r.ward}</> : null}</td>
                        <td className="addr-sub">{r.a.needed ? kindLabel(r.a.needed) : r.a.upcoming ? `${kindLabel(r.a.upcoming.kind)} from ${fmtDay(r.a.upcoming.scheme.startsOn)}` : 'None now'}</td>
                        <td>
                          <span className={`lic-pill t-${b.tone}`}>{b.label}</span>
                          {r.a.days != null && r.a.validUntil ? <div className="addr-sub">{fmtDay(r.a.validUntil)} · {inWords(r.a.days)}</div> : r.a.bucket === 'upcoming' && r.a.upcoming ? <div className="addr-sub">{inWords(r.a.upcoming.days)}</div> : null}
                        </td>
                        <td className="addr-sub">{r.a.licence?.number ?? (r.licences.length ? '—' : 'None on file')}</td>
                        <td><div className="lic-certs">{r.a.certs.map((c) => <span key={c.key} className={`lic-cert s-${c.state}`} title={`${c.label}: ${c.date ? `${c.days! < 0 ? 'expired' : 'until'} ${fmtDay(c.date)}` : 'not on file'}${c.note ? `. ${c.note}` : ''}`}>{c.key === 'eicr' ? 'EICR' : c.key === 'epc' ? 'EPC' : 'Gas'}</span>)}</div></td>
                        <td className="addr-sub">{r.landlordName ?? '—'}</td>
                        <td className="addr-sub">{r.lastCheckedAt ? new Date(r.lastCheckedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : 'Never'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!shown.length ? <p className="card-sub" style={{ padding: '6px 20px 20px' }}>Nothing matches. <Link href="/admin/licensing">Show everything</Link>.</p> : null}
          </section>

          <section className="card card-pad" style={{ marginTop: 18 }}>
            <h2>Licences running out, month by month</h2>
            <p className="card-sub" style={{ marginTop: 4 }}>The next 12 months, by the date each licence (or the scheme it’s under) ends.</p>
            <div className="lic-months">
              {byMonth.map(({ m, items }) => (
                <div key={m} className={`lic-month${items.length ? '' : ' empty'}`}>
                  <h3>{new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}<b>{items.length}</b></h3>
                  <ul>{items.slice(0, 6).map((r) => <li key={r.id}><Link href={`/admin/licensing/${r.id}`}>{r.address}</Link><span>{fmtDay(r.a.validUntil)}</span></li>)}{items.length > 6 ? <li className="more">+{items.length - 6} more</li> : null}</ul>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  )
}
