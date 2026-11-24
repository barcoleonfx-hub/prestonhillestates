import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { morningPack } from '@/lib/night-shift'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Today’s pack' }

const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

/** The morning pack the night shift leaves ready: drafts, today's appointments with a brief each, promises due, calls, letters. */
export default async function PackPage() {
  await requireAdmin()
  const p = await morningPack()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Today’s pack</h1>
          <p className="sub">{dayName(p.today)}: ready from the night shift. Start at the top.</p>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/admin/agents">Back to the agents</Link>
      </div>

      <section className="card fu-list ag-sec">
        <div className="fu-head"><h2>Replies drafted overnight <span>{p.drafts.length}</span></h2><p>Read, fill in anything in [brackets], send or bin.</p></div>
        <div className="fu-row ag-row">
          <span className="fu-main"><b>{p.drafts.length ? `${p.drafts.length} ready to check` : 'None waiting'}</b><small>{p.drafts.slice(0, 5).map((d) => d.from).join(', ')}</small></span><span />
          {p.drafts.length ? <span className="fu-acts"><Link className="btn btn-gold btn-sm" href="/admin/agents/drafts">Check the drafts</Link></span> : <span />}
        </div>
      </section>

      <section className="card fu-list ag-sec">
        <div className="fu-head"><h2>Today’s appointments <span>{p.appointments.length}</span></h2><p>A brief for each: who they are, what’s happened so far, and for valuations, what’s sold nearby.</p></div>
        {p.appointments.length ? p.appointments.map((a) => (
          <div key={a.id} className="pk-appt">
            <div className="fu-main"><b>{a.time} · {a.kind === 'valuation' ? 'Valuation' : a.kind === 'viewing' ? 'Viewing' : 'Appointment'} with {a.who}</b><small>{a.where} · {a.staff} going</small></div>
            {a.brief.length ? <ul>{a.brief.map((l, i) => <li key={i}>{l}</li>)}</ul> : <p className="ag-note-in">Nothing else on file.</p>}
            <Link className="btn btn-ghost btn-sm" href={`/admin/diary/${a.id}`}>Open it</Link>
          </div>
        )) : <p className="fu-empty">No appointments today.</p>}
      </section>

      <section className="card fu-list ag-sec">
        <div className="fu-head"><h2>Promises due <span>{p.promises.length}</span></h2><p>Things we said we’d do in our emails, due today or before. They tick off once we’ve been back in touch.</p></div>
        {p.promises.length ? p.promises.map((x) => (
          <div key={x.id} className="fu-row ag-row">
            <span className="fu-main"><b>{x.promise}</b><small>{x.person ?? 'Someone'} promised {x.toName ?? 'them'} · due {x.dueDate}</small></span><span />
            <span className="fu-acts"><Link className="btn btn-ghost btn-sm" href={`/admin/mail/${x.threadId}`}>Open the email</Link></span>
          </div>
        )) : <p className="fu-empty">✓ No promises due.</p>}
      </section>

      <section className="card fu-list ag-sec">
        <div className="fu-head"><h2>Calls to make <span>{p.calls.length}</span></h2><p>New leads and follow-up calls, with what to know before you ring.</p></div>
        {p.calls.length ? p.calls.map((c) => (
          <div key={c.id} className="pk-appt">
            <div className="fu-main"><b>{c.name}{c.flags.map((f) => <em key={f} className="fu-flag">{f}</em>)}</b></div>
            {c.brief.length ? <ul>{c.brief.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
            <span className="ag-btns">{c.phone ? <a className="btn btn-dark btn-sm" href={`tel:${c.phone.replace(/\s/g, '')}`}>Call</a> : null}<Link className="btn btn-ghost btn-sm" href={`/admin/enquiries/${c.id}`}>Open</Link></span>
          </div>
        )) : <p className="fu-empty">No calls due.</p>}
      </section>

      <section className="card fu-list ag-sec">
        <div className="fu-head"><h2>Letters to print</h2></div>
        {p.letters.length ? p.letters.map((b) => (
          <div key={b.id} className="fu-row ag-row"><span className="fu-main"><b>{b.count} {b.followUp ? 'follow-up ' : ''}letter{b.count === 1 ? '' : 's'}</b></span><span /><span className="fu-acts"><Link className="btn btn-gold btn-sm" href={`/admin/letters-print/${b.id}`}>Print</Link></span></div>
        )) : <p className="fu-empty">No letters waiting.</p>}
      </section>
    </>
  )
}
