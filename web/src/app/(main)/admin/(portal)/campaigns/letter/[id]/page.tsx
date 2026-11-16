import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { letters } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audienceOf, contentOf, filesOf, letterProperty, letterPropertyOptions, letterResults, type ToMode } from '@/lib/letters'
import { mailboxStatus } from '@/lib/mailbox'
import { knownBase } from '@/lib/property-email-data'
import { deleteLetter, duplicateLetter } from '../../../../letter-actions'
import { LetterEditor } from './LetterEditor'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Property email' }

export default async function LetterPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  await ready()
  const { id } = await params
  const l = await db.query.letters.findFirst({ where: eq(letters.id, id) })
  if (!l) notFound()
  const c = contentOf(l)
  const [box, base, properties, property, results] = await Promise.all([mailboxStatus(), knownBase(), letterPropertyOptions(), letterProperty(c.propertyId), l.status === 'draft' ? Promise.resolve([]) : letterResults(id)])
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })
  const label = { sent: 'Sent', sending: 'Failed', failed: 'Failed', skipped: 'Left out', queued: 'Waiting to go' } as Record<string, string>
  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumb"><Link href="/admin/campaigns#letters">Email campaigns</Link></p>
          <h1>{l.name}</h1>
          <p className="sub">A letter on your letterhead, in your own words. Add one of your homes as a short box of key details, attach files, and send it to one person, a list of addresses or groups of contacts.</p>
        </div>
        <div className="actions">
          <form action={duplicateLetter}><input type="hidden" name="id" value={l.id} /><button className="btn btn-ghost" type="submit">{l.status === 'draft' ? 'Make a copy' : 'Use again'}</button></form>
          {l.status !== 'sending' ? <form action={deleteLetter}><input type="hidden" name="id" value={l.id} /><button className="btn btn-ghost" type="submit">Delete</button></form> : null}
        </div>
      </div>
      {l.status !== 'draft' ? (
        <section className="card card-pad" style={{ marginBottom: 18 }}>
          <h2 className="cmp-h">{l.status === 'sending' ? `Sending: ${l.sent} of ${l.total} so far` : `Sent to ${l.sent} of ${l.total}`}</h2>
          {l.lastError ? <p className="notice warn">{l.lastError}</p> : null}
          <ul className="te-results">{results.slice(0, 200).map((r) => <li key={r.email} className={r.status === 'sent' ? 'ok' : r.status === 'queued' ? '' : 'bad'}><b>{label[r.status] ?? r.status}</b> {r.name ? `${r.name} · ` : ''}{r.email}{r.error ? <small> · {r.error}</small> : null}</li>)}</ul>
          {results.length > 200 ? <p className="card-sub">and {results.length - 200} more</p> : null}
        </section>
      ) : null}
      <LetterEditor
        id={l.id}
        initial={{ name: l.name, content: c, toMode: l.toMode as ToMode, one: { contactId: l.oneContactId, email: l.oneEmail ?? '', name: l.oneName ?? '' }, recipients: l.recipients, audience: audienceOf(l) }}
        files={filesOf(l)} properties={properties} property={property} base={base} senderEmail={box?.user ?? 'info@prestonhillestates.com'}
        sent={l.status !== 'draft'} canSend={!!box?.hasPassword} today={today}
      />
    </>
  )
}
