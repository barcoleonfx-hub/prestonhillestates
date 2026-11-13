import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { media, tailoredEmails } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { mailboxStatus } from '@/lib/mailbox'
import { FURNISHING, PROPERTY_TYPES, TENURES, labelFor } from '@/lib/options'
import { displayAddressFor, headlineFor, listPublished, priceLabel, slugFor, withUrl } from '@/lib/properties'
import { siteBase } from '@/lib/property-email-data'
import { normalise, type TailoredContent } from '@/lib/tailored-email'
import { deleteTailored, duplicateTailored, type SendResult } from '../../../../tailored-actions'
import { TailoredEditor, type ListingPick } from './TailoredEditor'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tailored email' }

export default async function TailoredPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin()
  await ready()
  const { id } = await params
  const row = await db.query.tailoredEmails.findFirst({ where: eq(tailoredEmails.id, id) })
  if (!row) notFound()
  const base = await siteBase()
  const box = await mailboxStatus()
  let content: TailoredContent
  try { content = normalise(JSON.parse(row.content) as TailoredContent, me.name) } catch { content = normalise(null, me.name) }
  const results = row.results ? (JSON.parse(row.results) as SendResult[]) : []

  // Our listings, to fill the property spotlight from: details, link and up to four photos each.
  const live = (await listPublished({}).catch(() => [])).slice(0, 60)
  const photos = live.length ? await db.query.media.findMany({ where: and(inArray(media.propertyId, live.map((p) => p.id)), eq(media.kind, 'photo'), eq(media.status, 'ready')), orderBy: [desc(media.isCover), asc(media.position)] }) : []
  const abs = (u: string) => (u.startsWith('/') ? `${base}${u}` : u)
  const listings: ListingPick[] = live.map((p) => ({
    id: p.id, label: `${displayAddressFor(p)} · ${priceLabel(p)}`, title: headlineFor(p), address: displayAddressFor(p), price: priceLabel(p), url: `${base}/properties/${slugFor(p)}`,
    facts: [p.bedrooms != null ? (p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} bedroom${p.bedrooms === 1 ? '' : 's'}`) : '', p.bathrooms ? `${p.bathrooms} bathroom${p.bathrooms === 1 ? '' : 's'}` : '',
      labelFor(PROPERTY_TYPES, p.propertyType), p.channel === 'let' ? labelFor(FURNISHING, p.furnishing) : labelFor(TENURES, p.tenure), ...(p.keyFeatures ?? []).slice(0, 3)].filter(Boolean).join('\n'),
    photos: photos.filter((m) => m.propertyId === p.id).slice(0, 4).map((m) => ({ id: m.id, url: abs(withUrl(m).url), alt: displayAddressFor(p) })),
  }))

  const sent = row.status === 'sent'
  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/campaigns" style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← Email campaigns</Link>
          <h1 style={{ marginTop: 6 }}>{row.name}</h1>
          <p className="sub">{sent ? `Sent ${new Date(row.sentAt!).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })} to ${row.sent} ${row.sent === 1 ? 'person' : 'people'}. Use it again to send it to someone else.` : 'Type who it’s to, write it on the left and see it on the right. Each person gets their own copy, sent from the office mailbox.'}</p>
        </div>
        <div className="actions">
          <form action={duplicateTailored}><input type="hidden" name="id" value={row.id} /><button className="btn btn-ghost" type="submit">{sent ? 'Use again' : 'Duplicate'}</button></form>
          <form action={deleteTailored}><input type="hidden" name="id" value={row.id} /><button className="btn btn-danger" type="submit">Delete</button></form>
        </div>
      </div>
      {!box?.hasPassword ? <div className="notice err" style={{ marginBottom: 14 }}>Connect the office mailbox in <Link href="/admin/email-inbox">Email settings</Link> before sending.</div> : null}
      <TailoredEditor id={row.id} sent={sent} initialName={row.name} initialRecipients={row.recipients} initialContent={content} initialResults={results}
        base={base} senderEmail={box?.user ?? 'info@prestonhillestates.com'} canSend={!!box?.hasPassword} listings={listings} />
    </>
  )
}
