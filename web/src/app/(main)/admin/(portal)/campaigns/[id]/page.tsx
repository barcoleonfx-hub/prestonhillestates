import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { campaigns } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audienceSummary, campaignLimits, campaignShared, monthLabel, parseAudience, parseContent, readerFor, sentToday } from '@/lib/campaign-data'
import { mailboxStatus } from '@/lib/mailbox'
import { siteBase } from '@/lib/property-email-data'
import { deleteCampaign, duplicateCampaign } from '../../../campaign-actions'
import { CampaignEditor } from './CampaignEditor'
import { CampaignStatus } from './CampaignStatus'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Email campaign' }

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin()
  await ready()
  const { id } = await params
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) })
  if (!c) notFound()
  const base = await siteBase()
  const audience = parseAudience(c)
  const [shared, summary, box, limits, today] = await Promise.all([campaignShared(base), audienceSummary(audience), mailboxStatus(), campaignLimits(), sentToday()])
  const samples = summary.samples.map((s) => readerFor(s, base))
  const draft = c.status === 'draft'

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/campaigns" style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← All campaigns</Link>
          <h1 style={{ marginTop: 6 }}>{c.name}</h1>
          <p className="sub">{draft ? 'Build the email on the left and see it on the right, as each kind of reader will get it. It saves as you go.' : 'This campaign has started, so its content is fixed. Duplicate it to send a new version.'}</p>
        </div>
        <div className="actions">
          <form action={duplicateCampaign}><input type="hidden" name="id" value={c.id} /><button className="btn btn-ghost" type="submit">Duplicate</button></form>
          {c.status !== 'sending' ? <form action={deleteCampaign}><input type="hidden" name="id" value={c.id} /><button className="btn btn-danger" type="submit">Delete</button></form> : null}
        </div>
      </div>
      {!box?.hasPassword ? <div className="notice err" style={{ marginBottom: 14 }}>Connect the office mailbox in <Link href="/admin/email-inbox">Email settings</Link> before sending.</div> : null}
      {!draft ? <CampaignStatus id={c.id} isAdmin={me.role === 'admin'} initial={{ status: c.status, total: c.total, sent: c.sent, failed: c.failed, queued: Math.max(0, c.total - c.sent - c.failed), lastError: c.lastError }} perDay={limits.perDay} /> : null}
      <CampaignEditor
        id={c.id} readOnly={!draft} isAdmin={me.role === 'admin'} canSend={!!box?.hasPassword}
        initialName={c.name} initialAudience={audience} initialContent={parseContent(c)}
        shared={shared} samples={samples} summary={{ total: summary.total, byRole: summary.byRole }}
        sender={{ email: box?.user ?? 'info@prestonhillestates.com' }} month={monthLabel()} perDay={limits.perDay} sentToday={today}
      />
    </>
  )
}
