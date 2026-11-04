import Link from 'next/link'
import { desc } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { campaigns } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { TEMPLATES } from '@/lib/campaign'
import { audienceSummary, campaignLimits, sentToday } from '@/lib/campaign-data'
import { mailboxStatus } from '@/lib/mailbox'
import { createCampaign, saveLimits } from '../../campaign-actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Email campaigns' }

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'draft' }, sending: { label: 'Sending', cls: 'gold' }, paused: { label: 'Paused', cls: 'warn' },
  sent: { label: 'Sent', cls: 'live' }, cancelled: { label: 'Stopped', cls: 'draft' },
}
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) : '—')

export default async function CampaignsPage() {
  const me = await requireAdmin()
  await ready()
  const [list, limits, today, box, everyone] = await Promise.all([
    db.select().from(campaigns).orderBy(desc(campaigns.updatedAt)).limit(100), campaignLimits(), sentToday(), mailboxStatus(),
    audienceSummary({ roles: ['buyer', 'tenant', 'landlord', 'seller', 'other'], areas: '', activeMonths: null }),
  ])
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Email campaigns</h1>
          <p className="sub">Newsletters, new listings, landlord and market updates to your contacts. Each person gets their own version: buyers see homes for sale in their budget, tenants see rentals, landlords get the landlord news.</p>
        </div>
      </div>
      {!box?.hasPassword ? <div className="notice err" style={{ marginBottom: 16 }}>Connect the office mailbox in <Link href="/admin/email-inbox">Email settings</Link> first. Campaigns are sent from it.</div> : null}

      <section className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="today-head">
          <div>
            <h2>Start a new campaign</h2>
            <p className="card-sub">{everyone.total.toLocaleString('en-GB')} contacts can be emailed: {[['buyer', 'buyers'], ['tenant', 'tenants'], ['landlord', 'landlords'], ['seller', 'sellers'], ['other', 'others']].map(([k, l]) => `${everyone.byRole[k as 'buyer'].toLocaleString('en-GB')} ${l}`).join(' · ')}. People who unsubscribed, are archived or marked “Do not call back” are always left out.</p>
          </div>
        </div>
        <div className="cmp-templates">
          {TEMPLATES.map((t) => (
            <form key={t.key} action={createCampaign} className="cmp-template">
              <input type="hidden" name="template" value={t.key} />
              <h3>{t.name}</h3>
              <p>{t.about}</p>
              <button className={`btn btn-sm ${t.key === 'newsletter' ? 'btn-gold' : 'btn-ghost'}`} type="submit">Use this</button>
            </form>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-pad" style={{ paddingBottom: 0 }}><h2>Your campaigns</h2></div>
        {list.length ? (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Name</th><th>Status</th><th>People</th><th>Sent</th><th>Started</th><th>Last change</th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td><Link className="addr-main" href={`/admin/campaigns/${c.id}`}>{c.name}</Link></td>
                    <td><span className={`pill ${STATUS[c.status]?.cls ?? ''}`}>{STATUS[c.status]?.label ?? c.status}</span></td>
                    <td className="num">{c.total ? c.total.toLocaleString('en-GB') : '—'}</td>
                    <td className="num">{c.total ? `${c.sent.toLocaleString('en-GB')}${c.failed ? ` · ${c.failed} not sent` : ''}` : '—'}</td>
                    <td className="addr-sub">{day(c.startedAt)}</td>
                    <td className="addr-sub">{day(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="card-sub" style={{ padding: '8px 22px 22px' }}>None yet. Pick a starting point above.</p>}
      </section>

      <section className="card card-pad">
        <h2>Sending limit</h2>
        <p className="card-sub" style={{ marginTop: 6 }}>
          Campaigns go out in the background from {box?.user ?? 'the office mailbox'}, about 12 every 2 minutes, up to a daily limit so the mail provider doesn’t treat the mailbox as a spammer.
          {' '}{today.toLocaleString('en-GB')} sent today (including property emails). If Fasthosts tells you about a lower limit, set it here.
        </p>
        {me.role === 'admin' ? (
          <form action={saveLimits} className="cmp-limit">
            <label htmlFor="perDay">Emails a day</label>
            <input id="perDay" name="perDay" type="number" min={20} max={5000} step={10} defaultValue={limits.perDay} className="input" />
            <button className="btn btn-ghost btn-sm" type="submit">Save</button>
          </form>
        ) : <p className="card-sub">Up to {limits.perDay} a day.</p>}
      </section>
    </>
  )
}
