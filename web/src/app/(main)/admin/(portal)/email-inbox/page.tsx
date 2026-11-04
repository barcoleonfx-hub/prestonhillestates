import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { FASTHOSTS_IMAP, mailboxStatus } from '@/lib/mailbox'
import { mailboxCheckNow, mailboxForget, mailboxOnOff } from '../../mailbox-actions'
import { ConnectForm } from './ConnectForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Email inbox' }

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }) : 'never')

export default async function EmailInboxPage() {
  await requireRole('admin')
  const s = await mailboxStatus()
  const on = !!s?.enabled && s.hasPassword
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Email inbox</h1>
          <p className="sub">Connect the office mailbox and new Zoopla, OnTheMarket and website enquiries appear in the portal by themselves, under Needs a reply, with an alert for everyone.</p>
        </div>
      </div>

      {s ? (
        <section className={`card card-pad mb-status ${on ? (s.lastError ? 'warn' : 'on') : 'off'}`}>
          <div className="mb-dot" aria-hidden="true" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{!on ? 'Not checking' : s.lastError ? 'Connected, but the last check failed' : 'Checking every 2 minutes'}</h2>
            <p className="card-sub">
              {s.user} · last checked {when(s.lastCheckAt)}{s.lastOkAt && s.lastOkAt !== s.lastCheckAt ? ` · last worked ${when(s.lastOkAt)}` : ''}
              {' · '}{(s.totalFound ?? 0).toLocaleString()} enquir{s.totalFound === 1 ? 'y' : 'ies'} picked up since {when(s.connectedAt)}
            </p>
            {on && s.lastError ? <p className="notice err" style={{ marginTop: 10 }}>{s.lastError}</p> : null}
          </div>
          <div className="mb-actions">
            {on ? <form action={mailboxCheckNow}><button className="btn btn-dark btn-sm" type="submit">Check now</button></form> : null}
            <form action={mailboxOnOff}>
              <input type="hidden" name="on" value={on ? '0' : '1'} />
              <button className="btn btn-ghost btn-sm" type="submit" disabled={!s.hasPassword}>{on ? 'Pause' : 'Turn back on'}</button>
            </form>
            <form action={mailboxForget}><button className="btn btn-ghost btn-sm" type="submit">Disconnect</button></form>
          </div>
        </section>
      ) : null}

      <section className="card card-pad">
        <h2>{s ? 'Change the mailbox' : 'Connect your mailbox'}</h2>
        <p className="card-sub">Use the email address and password for the mailbox that receives your Zoopla, OnTheMarket and website enquiries. The password is stored encrypted and only used to read new mail.</p>
        <ConnectForm user={s?.user ?? 'info@prestonhillestates.com'} host={s?.host ?? FASTHOSTS_IMAP} port={s?.port ?? 993} includePeople={s?.includePeople ?? false} hasPassword={!!s?.hasPassword} />
      </section>

      {s?.hasPassword ? (
        <section className="card card-pad mb-audit">
          <div>
            <h2>Inbox audit</h2>
            <p className="card-sub">See what really arrives in this inbox (repairs, solicitors, rent, invoices, leads and more), month by month and who from, to plan what the team dashboard should show.</p>
          </div>
          <Link className="btn btn-dark" href="/admin/email-inbox/audit">Open the audit</Link>
        </section>
      ) : null}

      <section className="card card-pad mb-how">
        <h2>How it works</h2>
        <ul>
          <li>The portal looks for new emails every 2 minutes. It only reads: nothing is marked as read, moved or deleted, so your inbox in Apple Mail stays exactly as it is.</li>
          <li>Zoopla and OnTheMarket leads and website form emails become enquiries with the person’s name, phone, email and the property, and are linked to the listing when the street matches.</li>
          <li>Newsletters, automated emails and anything sent from your own address are ignored. Nothing is imported twice, including emails you already brought in with <Link href="/admin/import">Import emails</Link>.</li>
          <li>When you first connect, it also picks up the last 3 days, in case anything arrived before you set it up.</li>
        </ul>
      </section>
    </>
  )
}
