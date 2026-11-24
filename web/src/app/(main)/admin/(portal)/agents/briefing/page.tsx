import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { previewBriefing } from '@/lib/staff-briefing'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Briefing preview' }

/** One person's 10am briefing as it stands now, as the email looks (without Claude's summaries, nothing sent). */
export default async function BriefingPreview({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  await requireAdmin()
  const { who } = await searchParams
  const m = who ? await previewBriefing(who) : null
  if (!m) notFound()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{m.person.name}’s briefing</h1>
          <p className="sub"><b>To:</b> {m.person.to} · <b>Subject:</b> {m.subject}</p>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/admin/agents#briefings">Back to the agents</Link>
      </div>
      <section className="card ag-report" dangerouslySetInnerHTML={{ __html: m.html }} />
    </>
  )
}
