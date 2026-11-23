import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { statusLabel } from '@/lib/lead-rules'
import { letterCandidates, letterText, recentBatches } from '@/lib/postal-letters'
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
export default async function ValuationLettersPage({ searchParams }: { searchParams: Promise<{ days?: string; msg?: string }> }) {
  const me = await requireAdmin()
  const sp = await searchParams
  // A year by default: everyone who asked for a valuation in the last twelve months and hasn't been written to lately.
  const days = DAYS.includes(Number(sp.days)) ? Number(sp.days) : 365
  await ready()
  const [rows, text, batches, staff] = await Promise.all([letterCandidates(days), letterText(), recentBatches(), db.select({ name: admins.name }).from(admins).where(eq(admins.active, true))])
  const ticked = rows.filter((r) => r.tick).length
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

      <form action={printLettersAction}>
        <section className="card card-pad vl-words">
          <h2>The letter</h2>
          <p className="card-sub">Starts “Dear {'{first}'},” and the heading “Your free property report for {'{home}'}”. Use {'{first}'} for their first name, {'{home}'} for their house and street, {'{street}'} for their road and {'{area}'} for their area (e.g. Kenton). Beside the QR code each letter also prints the latest sold prices on their road (from HM Land Registry) and how many buyers or tenants have registered with us looking in their area. A blank line starts a new paragraph. “Write with AI” writes both parts as one letter, using what’s in the boxes, our Google reviews and what their property report holds.</p>
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
