import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ready } from '@/db/client'
import { requireAdmin } from '@/lib/auth'
import { mailboxStatus } from '@/lib/mailbox'
import { displayAddressFor, getProperty } from '@/lib/properties'
import { draftFor, type Sender } from '@/lib/property-email'
import { emailProperty, propertyEmailCandidates, sentHistory, siteBase } from '@/lib/property-email-data'
import { PropertyEmailer, type Row } from './PropertyEmailer'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Email past applicants' }

export default async function PropertyEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin()
  await ready()
  const { id } = await params
  const p = await getProperty(id)
  if (!p) notFound()
  const [base, box] = await Promise.all([siteBase(), mailboxStatus()])
  const sender: Sender = { name: me.name, phone: '020 8127 7001', email: box?.user ?? 'info@prestonhillestates.com' }
  const prop = emailProperty(p, base)
  const [{ ready: cands, skipped, alreadyAsked }, history] = await Promise.all([propertyEmailCandidates(p, base), sentHistory(p.id)])
  const failed = new Map(history.filter((h) => h.status === 'failed').map((h) => [h.contactId, h.error]))
  const rows: Row[] = cands.map((c) => ({
    recipient: c.recipient, draft: draftFor(prop, c.recipient, sender), score: c.match.score, reasons: c.match.reasons,
    lastAt: c.match.lastAt, sentAt: c.sentAt, lastError: c.sentAt ? null : failed.get(c.recipient.contactId) ?? null,
  }))
  const problems = [
    !p.published ? 'This property isn’t published yet. Publish it first, so the link in the email works.' : '',
    !box?.hasPassword ? 'The office mailbox isn’t connected. Connect it in Email settings; the emails are sent from it and saved in Sent.' : '',
    !prop.photos.length ? 'There are no photos yet. Emails with a photo get far more clicks.' : '',
  ].filter(Boolean)

  return (
    <>
      <div className="page-head">
        <div>
          <Link href={`/admin/properties/${p.id}#matches`} style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← Back to the property</Link>
          <h1 style={{ marginTop: 6 }}>Email past applicants</h1>
          <p className="sub">{displayAddressFor(p)} · {prop.priceText}. Each person gets their own email, written around what they asked us about. Check it, change anything you like, then send.</p>
        </div>
      </div>
      {problems.map((t) => <div key={t} className="notice err" style={{ marginBottom: 12 }}>{t}</div>)}
      <PropertyEmailer
        propertyId={p.id} prop={prop} sender={sender} rows={rows}
        skipped={{ ...skipped, alreadyAsked }} canSend={!!p.published && !!box?.hasPassword}
      />
    </>
  )
}
