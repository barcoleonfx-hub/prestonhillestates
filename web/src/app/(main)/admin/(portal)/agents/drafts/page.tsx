import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { readyDrafts } from '@/lib/night-drafts'
import DraftCard from '../DraftCard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Replies drafted overnight' }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })

/** The night shift's drafted replies: read, fill in anything in [brackets], and send or bin each one. */
export default async function DraftsPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  await requireAdmin()
  const { who } = await searchParams
  const all = await readyDrafts()
  const people = [...new Set(all.map((d) => d.person ?? 'Anyone'))]
  const shown = who ? all.filter((d) => (d.person ?? 'Anyone') === who) : all
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Replies drafted overnight</h1>
          <p className="sub">The night shift drafted a reply to each email waiting on us (pitches and spam left out). Nothing has been sent. Read each one, change what you like, fill in anything in [square brackets], then send it or bin it.</p>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/admin/agents">Back to the agents</Link>
      </div>
      {people.length > 1 ? (
        <p className="dr-filter">
          <Link className={`btn btn-sm ${!who ? 'btn-gold' : 'btn-ghost'}`} href="/admin/agents/drafts">All ({all.length})</Link>
          {people.map((p) => <Link key={p} className={`btn btn-sm ${who === p ? 'btn-gold' : 'btn-ghost'}`} href={`/admin/agents/drafts?who=${encodeURIComponent(p)}`}>{p} ({all.filter((d) => (d.person ?? 'Anyone') === p).length})</Link>)}
        </p>
      ) : null}
      <section className="card fu-list">
        {shown.length ? shown.map((d) => (
          <DraftCard key={d.id} id={d.id} from={d.from} subject={d.subject} theirs={d.theirs} theirAt={when(d.theirAt)} body={d.body} check={d.checkNote} warnings={d.warnings.map((w) => `${w.name}${w.note ? `: ${w.note}` : ''}`)} person={d.person} href={`/admin/mail/${d.threadId}`} />
        )) : <p className="fu-empty">✓ No drafts waiting. The night shift drafts replies between 1am and 6am.</p>}
      </section>
    </>
  )
}
