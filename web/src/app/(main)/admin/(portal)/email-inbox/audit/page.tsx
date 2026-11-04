import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { CATEGORIES, auditState } from '@/lib/mail-audit'
import { mailboxStatus } from '@/lib/mailbox'
import { startMailAudit } from '../../../mailbox-actions'
import { Refresh } from './Refresh'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Inbox audit' }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const mon = (ym: string) => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short' })

export default async function AuditPage() {
  await requireRole('admin')
  const [box, s] = await Promise.all([mailboxStatus(), auditState()])
  const r = s.result
  const cats = r ? CATEGORIES.map((k) => ({ ...k, ...r.byCategory[k.id] })).filter((k) => k.n).sort((a, b) => b.n - a.n) : []
  const max = Math.max(1, ...cats.map((k) => k.n))
  const months = r ? [...new Set(cats.flatMap((k) => Object.keys(k.months)))].sort() : []
  const monthMax = Math.max(1, ...months.map((m) => cats.reduce((t, k) => t + (k.months[m] ?? 0), 0)))
  const dayMax = Math.max(1, ...(r?.byWeekday ?? [1]))

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/email-inbox" style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← Email inbox</Link>
          <h1 style={{ marginTop: 6 }}>Inbox audit</h1>
          <p className="sub">What actually arrives in the office inbox: every email sorted into a type, month by month, with who sends the most and how often we reply. Read-only; nothing in the mailbox changes and no emails are copied, only the totals and a few example subjects.</p>
        </div>
      </div>

      {!box?.hasPassword ? (
        <section className="card card-pad"><p>Connect the mailbox on the <Link href="/admin/email-inbox">Email inbox</Link> page first.</p></section>
      ) : (
        <section className="card card-pad au-run">
          {s.status === 'running' ? (
            <>
              <Refresh />
              <h2>Reading the inbox… {s.total ? `${(s.done ?? 0).toLocaleString()} of ${s.total.toLocaleString()} emails` : 'starting'}</h2>
              <div className="au-bar"><span style={{ width: `${s.total ? Math.round(((s.done ?? 0) / s.total) * 100) : 3}%` }} /></div>
              <p className="card-sub">A busy mailbox takes a few minutes. You can leave this page and come back.</p>
            </>
          ) : (
            <form action={startMailAudit} className="au-start">
              <div>
                <h2>{r ? 'Run it again' : 'Run the audit'}</h2>
                <p className="card-sub">{r ? `Last run ${new Date(s.finishedAt!).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}, covering ${r.months} months.` : 'Looks at the inbox and sent mail for the period you choose.'}</p>
                {s.status === 'error' ? <p className="notice err" style={{ marginTop: 8 }}>{s.error}</p> : null}
              </div>
              <select className="select" name="months" defaultValue={String(r?.months ?? 6)} aria-label="Period">
                <option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option>
              </select>
              <button className="btn btn-gold" type="submit">{r ? 'Run again' : 'Start the audit'}</button>
            </form>
          )}
        </section>
      )}

      {r ? (
        <>
          <section className="au-tiles">
            <div className="card card-pad"><b>{r.inbox.toLocaleString()}</b><span>emails received in {r.months} months</span></div>
            <div className="card card-pad"><b>{Math.round(r.inbox / (r.months * 4.33)).toLocaleString()}</b><span>a week on average</span></div>
            <div className="card card-pad"><b>{r.repliedShare == null ? '–' : `${r.repliedShare}%`}</b><span>of emails that need a person got a reply from this mailbox</span></div>
            <div className="card card-pad"><b>{r.replyHoursMedian == null ? '–' : r.replyHoursMedian < 24 ? `${r.replyHoursMedian} h` : `${Math.round(r.replyHoursMedian / 24)} days`}</b><span>typical time to reply</span></div>
          </section>

          <section className="card card-pad">
            <div className="today-head">
              <div><h2>What arrives</h2><p className="card-sub">Each email is put in one type, from who sent it and the words in the subject and opening lines. Open a type to see example subjects.</p></div>
              <a className="btn btn-ghost btn-sm" href="/api/admin/mail-audit">Download summary (.csv)</a>
            </div>
            <div className="au-cats">
              {cats.map((k) => (
                <details key={k.id} className="au-cat">
                  <summary>
                    <span className="au-name">{k.label}<small>{k.hint}</small></span>
                    <span className="au-track"><span style={{ width: `${(k.n / max) * 100}%` }} /></span>
                    <span className="au-n">{k.n.toLocaleString()}<small>{Math.round((k.n / r.inbox) * 100)}%{['automated', 'internal'].includes(k.id) ? '' : ` · ${k.n ? Math.round((k.replied / k.n) * 100) : 0}% replied`}</small></span>
                  </summary>
                  {k.samples.length ? <ul className="au-samples">{k.samples.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="card-sub">No examples.</p>}
                </details>
              ))}
            </div>
          </section>

          <div className="au-two">
            <section className="card card-pad">
              <h2>Month by month</h2>
              <div className="au-months">
                {months.map((m) => {
                  const total = cats.reduce((t, k) => t + (k.months[m] ?? 0), 0)
                  return <div key={m} className="au-month" title={`${total} emails`}><span style={{ height: `${(total / monthMax) * 100}%` }} /><small>{mon(m)}</small></div>
                })}
              </div>
              <h2 style={{ marginTop: 22 }}>Busiest days</h2>
              <div className="au-days">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => <div key={d}><span className="au-track"><span style={{ width: `${(r.byWeekday[d] / dayMax) * 100}%` }} /></span><small>{DAYS[d]} · {r.byWeekday[d].toLocaleString()}</small></div>)}
              </div>
            </section>
            <section className="card card-pad">
              <h2>Who sends the most</h2>
              <table className="list au-domains">
                <thead><tr><th>Sender</th><th className="num">Emails</th><th>Mostly</th></tr></thead>
                <tbody>{r.topDomains.slice(0, 20).map((d) => <tr key={d.domain}><td>{d.domain}</td><td className="num">{d.n.toLocaleString()}</td><td className="addr-sub">{CATEGORIES.find((k) => k.id === d.cat)?.label}</td></tr>)}</tbody>
              </table>
            </section>
          </div>
        </>
      ) : null}
    </>
  )
}
