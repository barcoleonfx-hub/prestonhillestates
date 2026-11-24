import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { guidesToUpload, recentActions, todaysLetters, type Check } from '@/lib/agents'
import { heldItems } from '@/lib/agent-queue'
import { monthSpend } from '@/lib/ai-usage'
import HeldCard from './HeldCard'
import { saveBudget } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Agents' }

const ago = (iso: string) => { const m = Math.floor((Date.now() - Date.parse(iso)) / 60e3); const d = Math.floor(m / 1440); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : d === 1 ? 'yesterday' : `${d} days ago` }
const AGENT: Record<string, string> = { valuation: 'Valuation agent', followup: 'Follow-ups', outreach: 'Seller outreach', marketing: 'Marketing', director: 'Director' }
const STATUS: Record<string, string> = { done: 'Done', held: 'Waiting for approval', blocked: 'Blocked', prompted: 'Prompted', rejected: 'Rejected', sending: 'Sending' }
const gbp = (n: number) => `£${n.toFixed(2)}`

/** The agents' desk: what's waiting on staff (OnTheMarket guides, today's letters) and everything the agents did. */
export default async function AgentsPage() {
  await requireAdmin()
  const [guides, letters, actions, held, spend] = await Promise.all([guidesToUpload(), todaysLetters(), recentActions(40), heldItems(), monthSpend()])
  const missing = guides.filter((g) => g.report.state === 'none')
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Agents</h1>
          <p className="sub">The agents work your valuation leads and report every morning. Nothing goes to a client without the OnTheMarket guide and a sense-check. What needs a person is here.</p>
        </div>
      </div>

      <section className="card fu-list ag-sec" id="approve">
        <div className="fu-head"><h2>Needs approval <span>{held.filter((h) => !h.expired).length}</span></h2>
          <p>Emails the sense-check wasn’t sure of: nothing has been sent. Approve it as it is, edit it and send, or reject it. Some rules can’t be overridden: anyone who asked us to stop, and any valuation figure or report without a finalised OnTheMarket guide.</p></div>
        {held.length ? held.map((h) => (
          <HeldCard key={h.id} id={h.id} title={h.title} to={h.payload.to} subject={h.payload.subject} text={h.payload.text} checks={h.checks} when={ago(h.createdAt)} expired={h.expired} enquiryHref={h.enquiryId ? `/admin/enquiries/${h.enquiryId}` : null} />
        )) : <p className="fu-empty">✓ Nothing waiting. Everything the agents sent passed every check.</p>}
      </section>

      <section className="card fu-list ag-sec" id="guides">
        <div className="fu-head"><h2>OnTheMarket guides to upload <span>{guides.length}</span></h2>
          <p>Each valuation lead needs its Market Appraisal Guide from OnTheMarket before its report, guide price or letter can go out. Upload it, set the guide price and finalise: the letter is then prepared for today’s post.</p></div>
        {guides.length ? guides.map((g) => (
          <div key={g.id} className="fu-row ag-row">
            <span className="fu-main"><b>{g.home}</b><small>{g.name} · asked {ago(g.createdAt)}</small></span>
            <span className={`vl-flag ${g.report.state === 'final' ? 'warn' : 'bad'}`}>{g.report.state === 'none' ? 'Guide needed' : g.report.state === 'draft' ? 'Uploaded: set the price and finalise' : `Guide from ${g.report.madeOn}: get a new one`}</span>
            <span className="fu-acts">
              {g.report.state === 'none' ? <a className="btn btn-ghost btn-sm" href="https://www.onthemarket.com/" target="_blank" rel="noreferrer">Open OnTheMarket</a> : null}
              <Link className="btn btn-gold btn-sm" href={`/admin/booklet/${g.id}`}>{g.report.state === 'none' ? 'Upload the guide' : 'Open the report'}</Link>
            </span>
          </div>
        )) : <p className="fu-empty">✓ Every live valuation lead has a finalised report.</p>}
        {missing.length ? <p className="ag-note">The agent reminds you every 4 office hours while a guide is missing.</p> : null}
      </section>

      <section className="card fu-list ag-sec" id="letters">
        <div className="fu-head"><h2>Today’s letters</h2><p>Prepared by the agent as each report is finalised. Print double-sided, fold and post today, then press “They’re in the post”.</p></div>
        {letters.length ? letters.map((b) => (
          <div key={b.id} className="fu-row ag-row">
            <span className="fu-main"><b>{b.count} letter{b.count === 1 ? '' : 's'} ready</b><small>Started {ago(b.createdAt)}</small></span>
            <span className="fu-acts"><Link className="btn btn-gold btn-sm" href={`/admin/letters-print/${b.id}`}>Print today’s letters</Link></span>
          </div>
        )) : <p className="fu-empty">No letters waiting today.</p>}
      </section>

      <section className="card fu-list ag-sec" id="budget">
        <div className="fu-head"><h2>AI spend this month</h2><p>The second read by Claude on every agent email. The agents stop using AI once they reach the budget: fixed-wording emails still go after passing every rule, and anything else waits for approval. Approximate, at Anthropic’s list prices: the exact bill is on console.anthropic.com.</p></div>
        <div className="ag-spend">
          <span className="fu-main"><b>{gbp(spend.agentsGbp)} of {gbp(spend.budgetGbp)} by the agents{spend.over ? ': budget reached' : ''}</b><small>Plus {gbp(spend.staffGbp)} from staff tools (email writer and checker) · {spend.calls} calls</small></span>
          <span className="ag-bar" aria-hidden><i style={{ width: `${Math.min(100, spend.budgetGbp ? (spend.agentsGbp / spend.budgetGbp) * 100 : 100)}%` }} /></span>
          <form action={saveBudget}><label htmlFor="ag-budget">Monthly budget £</label><input id="ag-budget" name="budget" inputMode="numeric" defaultValue={spend.budgetGbp} /><button className="btn btn-ghost btn-sm">Save</button></form>
        </div>
      </section>

      <section className="card fu-list ag-sec">
        <div className="fu-head"><h2>What the agents did</h2><p>Every action with its sense-check. Blocked or waiting for approval means a check failed, so nothing was sent.</p></div>
        {actions.length ? actions.map((a) => {
          let checks: Check[] = []
          try { checks = a.checks ? JSON.parse(a.checks) : [] } catch { /* none */ }
          const failed = checks.filter((c) => !c.ok)
          return (
            <div key={a.id} className="fu-row ag-row">
              <span className="fu-main"><b>{a.title}</b><small>{AGENT[a.agent] ?? a.agent} · {ago(a.createdAt)}{a.detail ? ` · ${a.detail}` : ''}{checks.length ? ` · sense-check: ${failed.length ? failed.map((c) => c.name.charAt(0).toLowerCase() + c.name.slice(1)).join('; ') : `${checks.length} of ${checks.length} passed`}` : ''}</small></span>
              <span className={`vl-flag ${a.status === 'done' ? 'ok' : a.status === 'held' || a.status === 'blocked' || a.status === 'rejected' ? 'bad' : 'warn'}`}>{STATUS[a.status] ?? a.status}</span>
              {a.enquiryId ? <span className="fu-acts"><Link className="btn btn-ghost btn-sm" href={`/admin/enquiries/${a.enquiryId}`}>Open</Link></span> : null}
            </div>
          )
        }) : <p className="fu-empty">Nothing yet.</p>}
      </section>
    </>
  )
}
