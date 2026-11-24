import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { guidesToUpload, recentActions, todaysLetters, type Check } from '@/lib/agents'
import { heldItems } from '@/lib/agent-queue'
import { agentSettings, monthSpend } from '@/lib/ai-usage'
import { lastReport } from '@/lib/director'
import SendReportButton from './SendReportButton'
import HeldCard from './HeldCard'
import { moveToPlan, saveBriefings, saveBudget, saveDirector, startRecentPlans } from './actions'
import SendBriefingButton from './SendBriefingButton'
import { briefingPeople, lastBriefings } from '@/lib/staff-briefing'
import { agentStatus } from '@/lib/agent-status'
import { followupBoard } from '@/lib/followups'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Agents' }

const ago = (iso: string) => { const m = Math.floor((Date.now() - Date.parse(iso)) / 60e3); const d = Math.floor(m / 1440); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : d === 1 ? 'yesterday' : `${d} days ago` }
const AGENT: Record<string, string> = { valuation: 'Valuation agent', followup: 'Follow-ups', outreach: 'Seller outreach', marketing: 'Marketing', director: 'Director' }
const STATUS: Record<string, string> = { done: 'Done', held: 'Waiting for approval', blocked: 'Blocked', prompted: 'Prompted', rejected: 'Rejected', sending: 'Sending', skipped: 'Already done' }
const gbp = (n: number) => `£${n.toFixed(2)}`

/** The agents' desk: what's waiting on staff (OnTheMarket guides, today's letters) and everything the agents did. */
export default async function AgentsPage() {
  await requireAdmin()
  const [guides, letters, actions, held, spend, cfg, last, board, status] = await Promise.all([guidesToUpload(), todaysLetters(), recentActions(40), heldItems(), monthSpend(), agentSettings(), lastReport(), followupBoard(), agentStatus()])
  const [people, briefed] = await Promise.all([briefingPeople(), lastBriefings()])
  const allOk = status.checks.every((c) => c.ok)
  const to = cfg.directorTo || 'info@prestonhillestates.com'
  const missing = guides.filter((g) => g.report.state === 'none')
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Agents</h1>
          <p className="sub">The agents work your valuation leads and report every morning. Nothing goes to a client without the OnTheMarket guide and a sense-check. What needs a person is here.</p>
        </div>
      </div>

      <section className="card fu-list ag-sec" id="status">
        <div className="fu-head"><h2>{allOk ? '✓ The agents are running' : 'The agents need something from you'}</h2><p>What the agents depend on. They act when something happens (a new valuation request, a report finalised, a follow-up falling due), so a quiet list below can just mean nothing was due yet.</p></div>
        {status.checks.map((c) => (
          <div key={c.name} className="fu-row ag-row">
            <span className="fu-main"><b>{c.name}</b><small>{c.detail}</small></span>
            <span className={`vl-flag ${c.ok ? 'ok' : 'bad'}`}>{c.ok ? 'OK' : 'Needs you'}</span>
            {c.href && !c.ok ? <span className="fu-acts"><Link className="btn btn-gold btn-sm" href={c.href}>Fix it</Link></span> : <span />}
          </div>
        ))}
        <div className="fu-row ag-row">
          <span className="fu-main"><b>Valuation leads from the last 30 days still waiting: {status.leads.total}</b><small>{status.leads.onPlan} on the Valuation agent’s plan · {status.leads.onOld} on the earlier follow-ups (they finish those) · {status.leads.never} never followed up{status.leads.other ? ` · ${status.leads.other} finished or stopped` : ''}</small></span>
          <span />
          <span className="fu-acts">
            {status.leads.onOld ? <form action={moveToPlan}><button className="btn btn-gold btn-sm">Move {status.leads.onOld} onto the plan</button></form> : null}
            {status.leads.never && status.followupsOn ? <form action={startRecentPlans}><button className="btn btn-gold btn-sm">Start the plan for {status.leads.never}</button></form> : null}
          </span>
        </div>
        {status.leads.onOld ? <p className="ag-note">“On the earlier follow-ups” started before the Valuation agent’s plan: they get a couple more emails and WhatsApps but no calls, report email or letter. Moving them carries each on from the day it has reached.</p> : null}
        {status.leads.never ? <p className="ag-note">“Never followed up” are valuation requests from before follow-ups were switched on. Starting the plan puts each on the call list today, then the report email (once its OnTheMarket guide is finalised), check-ins and a letter, all sense-checked.{status.followupsOn ? '' : ' Switch follow-ups on first.'}</p> : null}
      </section>

      <section className="card fu-list ag-sec" id="approve">
        <div className="fu-head"><h2>Needs approval <span>{held.filter((h) => !h.expired).length}</span></h2>
          <p>Emails the sense-check wasn’t sure of: nothing has been sent. Approve it as it is, edit it and send, or reject it. Some rules can’t be overridden: anyone who asked us to stop, and any valuation figure or report without a finalised OnTheMarket guide.</p></div>
        {held.length ? held.map((h) => (
          <HeldCard key={h.id} id={h.id} title={h.title} to={h.payload.to} subject={h.payload.subject} text={h.payload.text} checks={h.checks} when={ago(h.createdAt)} expired={h.expired} enquiryHref={h.enquiryId ? `/admin/enquiries/${h.enquiryId}` : null} />
        )) : <p className="fu-empty">✓ Nothing waiting. Everything the agents sent passed every check.</p>}
      </section>

      <section className="card fu-list ag-sec" id="calls">
        <div className="fu-head"><h2>Calls and WhatsApps due <span>{board.callsDue.length + board.waDue.length}</span></h2><p>The Valuation agent’s plan: a call and a WhatsApp the same day a request comes in, a second call on day 2, and calls after a visit. They’re listed with what to say on the Follow-ups page.</p></div>
        <div className="fu-row ag-row">
          <span className="fu-main"><b>{board.callsDue.length} call{board.callsDue.length === 1 ? '' : 's'} and {board.waDue.length} WhatsApp{board.waDue.length === 1 ? '' : 's'} to do</b><small>{board.callsDue.slice(0, 4).map((r) => r.e.name).join(', ') || 'No calls due'}</small></span>
          <span />
          <span className="fu-acts"><Link className="btn btn-gold btn-sm" href="/admin/follow-ups#calls">Open the list</Link></span>
        </div>
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
            <span className="fu-main"><b>{b.count} {b.followUp ? 'follow-up ' : ''}letter{b.count === 1 ? '' : 's'} ready</b><small>{b.followUp ? 'Two weeks on, no reply yet · ' : 'New valuation reports · '}started {ago(b.createdAt)}</small></span>
            <span className="fu-acts"><Link className="btn btn-gold btn-sm" href={`/admin/letters-print/${b.id}`}>Print {b.followUp ? 'the follow-up letters' : 'today’s letters'}</Link></span>
          </div>
        )) : <p className="fu-empty">No letters waiting today.</p>}
      </section>

      <section className="card fu-list ag-sec" id="director">
        <div className="fu-head"><h2>The Director’s daily report</h2><p>One email every morning at 7:30 to {to}: what each agent did, what came of it, what the sense-check stopped and what needs you today. The figures are counted by the system; Claude writes the short view on top, and it’s dropped if it quotes a figure that isn’t in the report.</p></div>
        <div className="ag-dir">
          <span className="fu-main"><b>{cfg.directorOff ? 'Switched off' : last ? (last.status === 'done' ? `Last sent ${ago(last.createdAt)}` : `Last one failed ${ago(last.createdAt)}: ${last.detail ?? ''}`) : 'Not sent yet: the first goes at 7:30 tomorrow'}</b><small>Seller outreach and Marketing agents join the report when they’re switched on.</small></span>
          <span className="ag-btns"><Link className="btn btn-ghost btn-sm" href="/admin/agents/report">Preview today’s</Link><SendReportButton to={to} /></span>
        </div>
        <div className="ag-dir">
          <form action={saveDirector}><label htmlFor="ag-to">Send to</label><input id="ag-to" name="to" type="email" defaultValue={to} /><label><input type="checkbox" name="on" defaultChecked={!cfg.directorOff} /> Send every morning</label><button className="btn btn-ghost btn-sm">Save</button></form>
        </div>
      </section>

      <section className="card fu-list ag-sec" id="briefings">
        <div className="fu-head"><h2>Daily staff briefings at 10am</h2><p>One email each: what they sent and did yesterday, the emails for them, everything that came into the office mailbox, and what’s outstanding for them, most urgent first. An email is theirs if it’s to them, names them, or (sent from Apple Mail) is signed with their name. Claude writes the summaries; any point that doesn’t match the emails and records is removed.{cfg.briefingsOff ? ' Switched off.' : ''}</p></div>
        {people.map((p) => {
          const last = briefed.get(p.name)
          return (
            <div key={p.name} className="fu-row ag-row">
              <span className="fu-main"><b>{p.name}{p.off ? ' (off)' : ''}</b><small>Emails naming {p.aliases.join(' or ')} · sent to {p.to}{last ? ` · last ${last.ok ? 'sent' : 'failed'} ${ago(last.at)}` : ' · not sent yet'}</small></span>
              <span />
              <span className="fu-acts"><Link className="btn btn-ghost btn-sm" href={`/admin/agents/briefing?who=${encodeURIComponent(p.name)}`}>Preview</Link><SendBriefingButton name={p.name} to={p.to} /></span>
            </div>
          )
        })}
        <details className="ag-edit-people">
          <summary>Change who gets one</summary>
          <form action={saveBriefings} className="ag-people">
            <div className="ag-people-h"><span>Name</span><span>Emails that name (commas between)</span><span>Send to</span><span>On</span></div>
            {[...people, { name: '', aliases: [], to: '', off: false }, { name: '', aliases: [], to: '', off: false }].slice(0, 6).map((p, i) => (
              <div key={i} className="ag-people-r">
                <input name={`name_${i}`} defaultValue={p.name} placeholder="Name" aria-label="Name" />
                <input name={`aliases_${i}`} defaultValue={p.aliases.join(', ')} placeholder="e.g. Fred, Ferdous" aria-label="Names that count as theirs" />
                <input name={`to_${i}`} type="email" defaultValue={p.to} placeholder="name@prestonhillestates.com" aria-label="Send to" />
                <input name={`on_${i}`} type="checkbox" defaultChecked={!p.off} aria-label="Send it" />
              </div>
            ))}
            <label className="ag-note-in"><input type="checkbox" name="all" defaultChecked={!cfg.briefingsOff} /> Send the briefings every morning at 10am</label>
            <button className="btn btn-ghost btn-sm">Save</button>
          </form>
        </details>
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
