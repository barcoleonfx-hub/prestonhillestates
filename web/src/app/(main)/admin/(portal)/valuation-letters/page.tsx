import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { statusLabel } from '@/lib/lead-rules'
import { letterCandidates, letterText, recentBatches } from '@/lib/postal-letters'
import type { ReportState } from '@/lib/report-guide'
import { fmtWhen } from '@/lib/time'
import { printLettersAction } from '../../postal-actions'
import { TickAll } from '../reconnect/TickAll'
import { LetterCount } from './LetterCount'
import { LetterWords } from './LetterWords'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Valuation letters' }

const DAYS = [30, 90, 180, 365]
const ago = (iso: string) => { const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5); return d === 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : `${Math.round(d / 30.4)} months ago` }

/** A personal letter to everyone who asked for a valuation lately: their property report by QR code, and a free visit. */
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Whether their property report is ready to go out with a letter, and a link to fix it if not. */
function ReportFlag({ id, report }: { id: string; report: ReportState }) {
  const href = `/admin/booklet/${id}`
  if (report.state === 'none') return <Link className="vl-flag bad" href={href}>No OnTheMarket guide: upload it</Link>
  if (report.state === 'draft') return <Link className="vl-flag bad" href={href}>Report not finalised</Link>
  if (report.stale) return <Link className="vl-flag warn" href={href} title={`The guide was made on ${shortDate(report.madeOn!)}`}>Guide from {shortDate(report.madeOn!)}: get a new one</Link>
  return <Link className="vl-flag ok" href={href}>✓ Report £{report.asking?.toLocaleString('en-GB')}</Link>
}

export default async function ValuationLettersPage({ searchParams }: { searchParams: Promise<{ days?: string; msg?: string }> }) {
  const me = await requireAdmin()
  const sp = await searchParams
  // A year by default: everyone who asked for a valuation in the last twelve months and hasn't been written to lately.
  const days = DAYS.includes(Number(sp.days)) ? Number(sp.days) : 365
  await ready()
  const [rows, text, batches, staff] = await Promise.all([letterCandidates(days), letterText(), recentBatches(), db.select({ name: admins.name }).from(admins).where(eq(admins.active, true))])
  const ticked = rows.filter((r) => r.tick).length
  const flagged = rows.filter((r) => r.report.state !== 'final' || r.report.stale).length
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Valuation letters</h1>
          <p className="sub">A personal letter to people who asked for a valuation: a QR code that opens their own property report, and an invitation to a free visit. Print on A4, fold in three and it fits a DL window envelope. When someone scans the code you get an alert (“opened their property report”), which is the moment to call.</p>
        </div>
      </div>
      {sp.msg === 'none' ? <p className="notice warn" style={{ marginBottom: 14 }}>Tick at least one person first.</p> : null}
      {sp.msg === 'words' ? <p className="notice warn" style={{ marginBottom: 14 }}>The letter needs some words before and after the code.</p> : null}
      {sp.msg === 'address' ? <p className="notice warn" style={{ marginBottom: 14 }}>None of the ticked people has a full address (a house number or name, and the postcode).</p> : null}

      {flagged ? (
        <p className="notice warn vl-flagged">
          <b>{flagged} of {rows.length} {rows.length === 1 ? 'person has' : 'people have'} a property report that isn’t ready to send.</b> Each letter prints a QR code to their report and its guide price, so the report should be finalised from an up-to-date OnTheMarket guide first. They’re flagged below and left unticked: open the report, upload the guide and finalise it, then tick them.
        </p>
      ) : null}

      <form action={printLettersAction}>
        <section className="card card-pad vl-words">
          <h2>The letter</h2>
          <p className="card-sub">Each letter is one A4 sheet printed on both sides. The front starts “Dear {'{first}'},” and “Thank you for getting in touch.”, then your words, their guide price from their finalised property report beside the QR code to the report, and your closing words. The back shows how we’ll sell (or let) their home, step by step, with a real Google review. Use {'{first}'} for their first name, {'{home}'} for their house and street, {'{street}'} for their road, {'{area}'} for their area (e.g. Kenton) and {'{sell}'} for “sell” or “let”. A blank line starts a new paragraph. “Write with AI” writes both parts as one letter, using what’s in the boxes, our Google reviews and what their property report holds.</p>
          <LetterWords before={text.before} after={text.after} />
          <label className="field vl-sender"><span className="flabel">Signed by</span>
            <select className="input" name="sender" defaultValue={me.name}>{staff.map((s) => <option key={s.name}>{s.name}</option>)}</select>
          </label>
        </section>

        <section className="card fu-list" id="people">
          <div className="fu-head rc-head">
            <div>
              <h2>Valuation enquiries <span>{rows.length}</span></h2>
              <p>From the last <span className="vl-days">{DAYS.map((d) => <Link key={d} href={`/admin/valuation-letters?days=${d}`} className={d === days ? 'on' : undefined}>{d === 365 ? 'year' : `${d} days`}</Link>)}</span>. {ticked} ticked to start with: everyone with a full address who isn’t booked in, instructed, lost, or written to in the last 30 days. Correct an address here and the letter uses it. People who asked not to be contacted, or said they’re not interested, aren’t listed.</p>
            </div>
            {rows.length ? <TickAll group="people" /> : null}
          </div>
          {rows.length ? rows.map((r) => (
            <div key={r.id} className={`fu-row vl-row${r.tick ? '' : ' off'}`}>
              <label className="rc-pick">
                <input type="checkbox" name="id" value={r.id} data-group="people" defaultChecked={r.tick} />
                <span className="fu-main"><b>{r.name}</b>
                  <small>{r.source} · asked {ago(r.createdAt)} · {statusLabel(r.status)}{r.lastLetterAt ? ` · last letter ${ago(r.lastLetterAt)}` : ''}{r.why ? ` · ${r.why.toLowerCase()}` : ''}</small></span>
              </label>
              <ReportFlag id={r.id} report={r.report} />
              <input className="input vl-addr" name={`addr_${r.id}`} defaultValue={r.address} placeholder="House number, street, town, postcode" aria-label={`Address for ${r.name}`} />
              <Link className="btn btn-ghost btn-sm" href={`/admin/enquiries/${r.id}?back=/admin/valuation-letters`}>Open</Link>
            </div>
          )) : <p className="fu-empty">No valuation enquiries in this time.</p>}
        </section>
        {rows.length ? <div className="rc-bar"><span>Opens the letters ready to print. Nothing is marked as sent until you say they’re posted.</span><LetterCount /></div> : null}
      </form>

      <section className="card fu-list">
        <div className="fu-head"><h2>Printed before</h2><p>Open one to print it again or mark it as posted.</p></div>
        {batches.length ? batches.map((b) => (
          <div key={b.id} className="fu-row">
            <span className="fu-main"><b><Link href={`/admin/letters-print/${b.id}`}>{b.count} letter{b.count === 1 ? '' : 's'}, signed by {b.sender}</Link></b><small>{b.postedAt ? `Posted ${fmtWhen(b.postedAt)}` : 'Printed, not marked as posted yet'}</small></span>
            <span className="fu-when">{fmtWhen(b.createdAt)}</span>
          </div>
        )) : <p className="fu-empty">Nothing yet.</p>}
      </section>
    </>
  )
}
