import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { AREAS } from '@/lib/mail-areas'
import { inboxDashboard } from '@/lib/mail-dashboard'
import { mailStoreCount, mailStoreState } from '@/lib/mail-store'
import { mailboxStatus } from '@/lib/mailbox'
import { MailRow, ago } from './MailRow'
import { Unsubscribe } from './Unsubscribe'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Inbox' }

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  await requireAdmin()
  const sp = await searchParams
  const [box, store, d, held] = await Promise.all([mailboxStatus(), mailStoreState(), inboxDashboard(7), mailStoreCount()])
  const area = AREAS.some((a) => a.id === sp.area) ? sp.area! : ''
  const waiting = area ? d.waiting.filter((t) => t.area === area) : d.waiting
  const oldest = d.waiting[0]
  const connected = !!box?.enabled && box.hasPassword

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="sub">Everything that matters in the office mailbox, sorted by part of the business: what came in this week, what’s been dealt with and what’s still waiting. Newsletters are kept out of the way. Reply here or in Apple Mail; either way the history shows here.</p>
        </div>
        <div className="actions"><Link className="btn btn-ghost" href="/admin/mail/all">All conversations</Link></div>
      </div>

      {!connected ? (
        <div className="notice err" style={{ marginBottom: 16 }}>The mailbox isn’t connected, so nothing new is coming in. <Link href="/admin/email-inbox">Connect it on the Email inbox page</Link>.</div>
      ) : store.lastError ? (
        <div className="notice err" style={{ marginBottom: 16 }}>The last attempt to read the mailbox failed: {store.lastError} It tries again every 2 minutes. If this stays, check the <Link href="/admin/email-inbox">Email settings</Link>.</div>
      ) : !store.backfilled ? (
        <div className="notice ok" style={{ marginBottom: 16 }}>
          {held ? <>Bringing in email, newest first: <b>{held.toLocaleString()}</b> so far{store.lastRunAt ? `, last batch at ${new Date(store.lastRunAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}` : ''}. It works back through the last 60 days in batches every couple of minutes; this week’s numbers are already counted.</>
            : <>Getting started: the first batch of email arrives within about 2 minutes of the portal starting up. Refresh this page in a moment.</>}
        </div>
      ) : null}

      <section className="au-tiles">
        <div className="card card-pad"><b>{d.received.toLocaleString()}</b><span>emails from people and businesses in the last 7 days</span></div>
        <div className="card card-pad"><b>{d.dealt.length}</b><span>conversations dealt with this week</span></div>
        <div className="card card-pad ib-warn"><b>{d.waiting.length}</b><span>waiting for a reply{oldest ? `, oldest ${ago(oldest.lastInAt)}` : ''}</span></div>
        <div className="card card-pad"><b>{d.leads}</b><span>portal and website leads, <Link href="/admin/enquiries">in Enquiries</Link></span></div>
      </section>

      <h2 className="ib-h">Last 7 days</h2>
      <div className="ib-areas">
        {d.areas.map((a) => (
          <section key={a.id} className="card card-pad ib-area">
            <div className="ib-area-head">
              <div><h3>{a.label}</h3><p className="card-sub">{a.hint}</p></div>
              <Link href={`/admin/mail/all?area=${a.id}`} className="ib-all">All</Link>
            </div>
            <div className="ib-nums">
              <span><b>{a.received}</b> in</span>
              <span><b>{a.dealt}</b> dealt with</span>
              <span className={a.waiting ? 'w' : ''}><b>{a.waiting}</b> waiting</span>
            </div>
            {a.top.length ? <div className="ib-top">{a.top.map((t) => <MailRow key={t.id} t={t} showArea={false} wait compact />)}</div> : <p className="card-sub" style={{ marginTop: 8 }}>Nothing this week.</p>}
          </section>
        ))}
      </div>

      <div className="ib-two">
        <section className="card card-pad" id="waiting">
          <div className="today-head"><div><h2>Waiting for a reply · {waiting.length}</h2><p className="card-sub">From real people and businesses, oldest first. Reply, or mark as dealt with if it was sorted by phone.</p></div></div>
          <div className="seg" role="group" aria-label="Area" style={{ margin: '10px 0' }}>
            <Link className={!area ? 'on' : undefined} href="/admin/mail#waiting">All</Link>
            {AREAS.map((a) => <Link key={a.id} className={area === a.id ? 'on' : undefined} href={`/admin/mail?area=${a.id}#waiting`}>{a.label}</Link>)}
          </div>
          {waiting.length ? <div className="ib-list">{waiting.slice(0, 60).map((t) => <MailRow key={t.id} t={t} wait />)}</div> : <p className="card-sub">Nothing waiting. 🎉</p>}
          {waiting.length > 60 ? <p style={{ marginTop: 10 }}><Link href={`/admin/mail/all?status=pending${area ? `&area=${area}` : ''}`}>See all {waiting.length}</Link></p> : null}
        </section>
        <section className="card card-pad">
          <div className="today-head"><div><h2>Dealt with this week · {d.dealt.length}</h2><p className="card-sub">Replied to, from the portal or Apple Mail, or marked as dealt with.</p></div></div>
          {d.dealt.length ? <div className="ib-list">{d.dealt.map((t) => <MailRow key={t.id} t={t} />)}</div> : <p className="card-sub">Nothing yet this week.</p>}
        </section>
      </div>

      <section className="card card-pad" style={{ marginTop: 18 }}>
        <div className="today-head"><div><h2>Newsletters and promotions</h2><p className="card-sub">{d.promoCount.toLocaleString()} this week, kept out of everything above. Unsubscribe from the ones you don’t need, or hide them here.</p></div></div>
        {d.senders.length ? (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Sender</th><th className="num">Last 60 days</th><th>Latest</th><th></th></tr></thead>
              <tbody>{d.senders.map((s) => (
                <tr key={s.sender}>
                  <td>{s.sender}</td><td className="num">{s.n}</td>
                  <td className="addr-sub" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.subject}</td>
                  <td><Unsubscribe sender={s.sender} canUnsub={!!s.unsubscribe} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="card-sub">None.</p>}
      </section>
    </>
  )
}
