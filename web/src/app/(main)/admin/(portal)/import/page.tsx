import { requireRole } from '@/lib/auth'
import { RETENTION_MONTHS } from '@/lib/retention'
import { ImportEmails } from './ImportEmails'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Import emails' }

export default async function ImportPage() {
  await requireRole('admin')
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Import past email enquiries</h1>
          <p className="sub">Bring in enquiries from your inbox: Zoopla and OnTheMarket leads, old website forms and emails from people. You review everything before it’s saved.</p>
        </div>
      </div>
      <ImportEmails retentionYears={RETENTION_MONTHS / 12} />
    </>
  )
}
