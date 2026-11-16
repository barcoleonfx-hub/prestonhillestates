import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { trackOf } from '@/lib/followups'
import { statusLabel } from '@/lib/lead-rules'
import { knownBase } from '@/lib/property-email-data'
import { displayAddressFor } from '@/lib/properties'
import { MAX_BATCH, QUIET_DAYS, REPEAT_DAYS, reconnectWhatsApp } from '@/lib/reconnect-rules'
import { buildReconnect, leadRow, newListings, reconnectHistory, reconnectLists, type ReconnectRow } from '@/lib/reconnect'
import { fmtWhen } from '@/lib/time'
import { quietEnds, quietReason } from '@/lib/whatsapp'
import { waFor } from '@/lib/whatsapp-data'
import { addressOf } from '@/lib/followups'
import { cancelReconnects, queueReconnectAction } from '../../lead-actions'
import { WhatsAppButton } from '../WhatsAppButton'
import { SendButton, TickAll } from './TickAll'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reconnect' }

const TRACK = { 'sales-valuation': 'Sales valuation', 'lettings-valuation': 'Rental valuation', buyer: 'Buyer', tenant: 'Tenant' } as const
const PAGE = 80

function ago(iso: string) {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5)
  return d < 60 ? `${d} days ago` : `${Math.round(d / 30.4)} months ago`
}
const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' })

export default async function ReconnectPage({ searchParams }: { searchParams: Promise<{ preview?: string; queued?: string; skipped?: string; all?: string; msg?: string }> }) {
  const me = await requireAdmin()
  const sp = await searchParams
  const [{ valuations, seekers }, fresh, history, base] = await Promise.all([reconnectLists(), newListings(), reconnectHistory(), knownBase()])
  const queuedCount = [...valuations, ...seekers].filter((r) => r.queued).length
  const sent30 = history.filter((h) => h.x.status === 'sent' && Date.parse(h.x.createdAt) > Date.now() - 30 * 864e5).length
  const preview = sp.preview ? await leadRow(sp.preview) : null
  const mail = preview ? await buildReconnect(preview, base) : null
  const quiet = quietReason()

  const List = async ({ id, title, sub, rows }: { id: string; title: string; sub: string; rows: ReconnectRow[] }) => {
    const shown = sp.all === id ? rows : rows.slice(0, PAGE)
    const was = await Promise.all(shown.map(async (r) => (r.c?.whatsappOptInAt && !r.c?.whatsappStoppedAt ? { id: r.e.id, wa: await waFor({ enquiry: r.e, contact: r.c, me: me.name }) } : null)))
    return (
      <section className="card fu-list" id={id}>
        <div className="fu-head rc-head"><div><h2>{title} <span>{rows.length}</span></h2><p>{sub}</p></div>{rows.some((r) => !r.block && !r.queued) ? <TickAll group={id} /> : null}</div>
        {shown.length ? shown.map((r, i) => {
          const { address, postcode } = addressOf(r)
          const what = r.p ? displayAddressFor(r.p) : [address, postcode].filter(Boolean).join(', ')
          const wa = was[i]?.wa
          const track = trackOf(r)
          return (
            <div key={r.e.id} className={`fu-row${r.block ? ' off' : ''}`}>
              <label className="rc-pick">
                <input type="checkbox" name="id" value={r.e.id} data-group={id} disabled={!!r.block || r.queued} />
                <span className="fu-main"><b><Link href={`/admin/enquiries/${r.e.id}?back=/admin/reconnect`}>{r.e.name}</Link></b>
                  <small>{TRACK[track]}{what ? ` · ${what}` : ''} · last in touch {ago(r.touch)} · {statusLabel(r.e.status)}{r.queued ? ' · in the queue' : r.block ? ` · ${r.block.toLowerCase()}` : ''}</small></span>
              </label>
              <span className="fu-acts">
                <Link className="btn btn-ghost btn-sm" href={`/admin/reconnect?preview=${r.e.id}#preview`} scroll={false}>See the email</Link>
                {wa && !wa.blocked ? <WhatsAppButton wa={{ ...wa, templates: [{ key: 'reconnect', label: 'Reconnect', text: reconnectWhatsApp(track, wa.first, me.name, monthYear(r.e.createdAt)), marketing: false }, ...wa.templates] }} className="btn btn-wa btn-sm" /> : null}
                {r.e.phone && !r.c?.doNotContact ? <a className="btn btn-ghost btn-sm" href={`tel:${r.e.phone.replace(/\s/g, '')}`}>Call</a> : null}
              </span>
            </div>
          )
        }) : <p className="fu-empty">Nobody here right now.</p>}
        {rows.length > PAGE ? <p className="fu-empty"><Link href={`/admin/reconnect?all=${sp.all === id ? '' : id}#${id}`}>{sp.all === id ? `Show the first ${PAGE} only` : `Show all ${rows.length}`}</Link></p> : null}
      </section>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reconnect</h1>
          <p className="sub">People who enquired, went quiet for at least {QUIET_DAYS} days and haven’t been lost or won. Tick the ones worth a nudge and we’ll send each a short personal email from the office mailbox: for owners, what’s sold near them (Land Registry); for buyers and tenants, the homes we have now. Nobody is emailed twice within {REPEAT_DAYS} days, and anyone who unsubscribed or asked not to be contacted is left out.</p>
        </div>
      </div>

      {sp.queued ? <p className="notice ok" style={{ marginBottom: 14 }}>{Number(sp.queued) ? `${sp.queued} email${sp.queued === '1' ? '' : 's'} queued. ${quiet ? `${quiet}: they’ll go ${quietEnds()}.` : 'They’ll go out over the next few minutes.'}` : 'Nothing was queued.'}{Number(sp.skipped) ? ` ${sp.skipped} couldn’t be (already queued, or no longer suitable).` : ''}</p> : null}
      {sp.msg === 'none' ? <p className="notice warn" style={{ marginBottom: 14 }}>Tick at least one person first.</p> : null}

      <section className="card card-pad fu-switch">
        <div>
          <h2>{queuedCount ? `${queuedCount} email${queuedCount === 1 ? '' : 's'} waiting to go` : 'Nothing waiting to go'}</h2>
          <p className="card-sub">{sent30} sent in the last 30 days. Emails go a few at a time{quiet ? `; ${quiet.toLowerCase()}, so the next ones go ${quietEnds()}` : ''}. Replies come back to the enquiry like any other email.</p>
        </div>
        {queuedCount ? <form action={cancelReconnects}><button className="btn btn-ghost" type="submit">Cancel the waiting ones</button></form> : null}
      </section>

      {fresh.length ? (
        <section className="card fu-list">
          <div className="fu-head"><h2>New homes to tell past applicants about <span>{fresh.length}</span></h2><p>Listed in the last 3 weeks. Each one shows the past buyers or tenants it suits, and emails them in one go.</p></div>
          {fresh.map((p) => (
            <div key={p.id} className="fu-row">
              <span className="fu-main"><b>{displayAddressFor(p)}</b><small>{p.ref} · {p.channel === 'let' ? 'To let' : 'For sale'}{p.publishedAt ? ` · listed ${ago(p.publishedAt)}` : ''}</small></span>
              <span className="fu-acts"><Link className="btn btn-gold btn-sm" href={`/admin/properties/${p.id}/email`}>See who it suits</Link></span>
            </div>
          ))}
        </section>
      ) : null}

      {mail ? (
        <section className="card card-pad fu-preview" id="preview">
          <h2>The email to {preview!.e.name}</h2>
          <p className="card-sub">Exactly as it would go now. <Link href="/admin/reconnect" scroll={false}>Close</Link></p>
          <div className="fu-mail"><div className="fu-mail-h"><b>Subject:</b> {mail.subject}</div><pre>{mail.text}</pre></div>
        </section>
      ) : null}

      <form action={queueReconnectAction}>
        <List id="valuations" title="Owners who went quiet" sub="Sales and rental valuations. The email shows what’s sold near them in the last year and offers an up-to-date valuation." rows={valuations} />
        <List id="seekers" title="Buyers and tenants who went quiet" sub="The email lists the homes we have now nearest their budget." rows={seekers} />
        <div className="rc-bar"><span>Up to {MAX_BATCH} at a time.</span><SendButton /></div>
      </form>

      <section className="card fu-list">
        <div className="fu-head"><h2>What’s happened</h2><p>Reconnect emails queued, sent or skipped.</p></div>
        {history.length ? history.map(({ x, name, by }) => (
          <div key={x.id} className="fu-row">
            <span className="fu-main"><b><Link href={`/admin/enquiries/${x.enquiryId}`}>{name}</Link></b><small><span className={`fu-st ${x.status}`}>{({ queued: 'Waiting to go', sent: 'Sent', skipped: 'Skipped', failed: 'Failed' } as Record<string, string>)[x.status] ?? x.status}</span>{x.detail ? ` · ${x.detail}` : ''}{by ? ` · chosen by ${by}` : ''}</small></span>
            <span className="fu-when">{fmtWhen(x.sentAt ?? x.createdAt)}</span>
          </div>
        )) : <p className="fu-empty">Nothing yet.</p>}
      </section>
    </>
  )
}
