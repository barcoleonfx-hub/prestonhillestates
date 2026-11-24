import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { previewReport } from '@/lib/director'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Daily report preview' }

/** Today's Director report as it stands now, exactly as the email looks (without sending it or using AI). */
export default async function ReportPreview() {
  await requireAdmin()
  const m = await previewReport()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Daily report preview</h1>
          <p className="sub"><b>Subject:</b> {m.subject}</p>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/admin/agents#director">Back to the agents</Link>
      </div>
      <section className="card ag-report" dangerouslySetInnerHTML={{ __html: m.html }} />
    </>
  )
}
