import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { previewBriefing } from '@/lib/staff-briefing'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Briefing preview' }

/** One person's 10am briefing exactly as it would go now, with Claude's summary (nothing is sent). */
export default async function BriefingPreview({ searchParams }: { searchParams: Promise<{ who?: string; fresh?: string }> }) {
  await requireAdmin()
  const { who, fresh } = await searchParams
  const m = who ? await previewBriefing(who, fresh === '1') : null
  if (!m) notFound()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{m.person.name}’s briefing</h1>
          <p className="sub"><b>To:</b> {m.person.to} · <b>Subject:</b> {m.subject}</p>
          <p className="sub">Exactly what would be sent now, with Claude’s summary. Nothing is sent from here. It’s kept for 30 minutes, so looking again costs nothing.</p>
        </div>
        <span className="ag-btns"><Link className="btn btn-ghost btn-sm" href={`/admin/agents/briefing?who=${encodeURIComponent(m.person.name)}&fresh=1`}>Write it again</Link><Link className="btn btn-ghost btn-sm" href="/admin/agents#briefings">Back to the agents</Link></span>
      </div>
      <section className="card ag-report" dangerouslySetInnerHTML={{ __html: m.html }} />
    </>
  )
}
