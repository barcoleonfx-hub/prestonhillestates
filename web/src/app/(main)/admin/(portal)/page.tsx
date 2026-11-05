import Link from 'next/link'
import { and, count, eq, inArray, isNull, lt, lte, type SQL } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { properties, tasks } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { activityBetween, openEnquiryItems } from '@/lib/activity'
import { listBetween } from '@/lib/appointments'
import { kindLabel } from '@/lib/appointment-options'
import { addDays, dayLabel, endIso, fmtTime, isoToLondon, londonToIso, todayLondon } from '@/lib/time'
import { createProperty } from '../actions'
import { rentalRegister } from '@/lib/licensing'
import { bucketOf, fmtDay, inWords } from '@/lib/licensing-rules'
import { ActivityFeed } from './ActivityFeed'
import { LogCallButton } from './LogCallButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Dashboard' }

export default async function Dashboard() {
  const me = await requireAdmin()
  await ready()
  const today = todayLondon()
  const startToday = londonToIso(today, '00:00')!
  const endToday = londonToIso(addDays(today, 1), '00:00')!
  const nowIso = new Date().toISOString()

  const n = async (where?: SQL) => (await db.select({ c: count() }).from(properties).where(where))[0].c
  const [lic, open, activity, todays, [{ overdue }], [{ dueToday }], liveSale, liveLet, drafts, progressing] = await Promise.all([
    rentalRegister().catch(() => ({ rows: [] as Awaited<ReturnType<typeof rentalRegister>>['rows'] })),
    openEnquiryItems(),
    activityBetween(startToday, endToday),
    listBetween(startToday, endToday),
    db.select({ overdue: count() }).from(tasks).where(and(isNull(tasks.doneAt), lt(tasks.dueAt, nowIso))),
    db.select({ dueToday: count() }).from(tasks).where(and(isNull(tasks.doneAt), lte(tasks.dueAt, endToday))),
    n(and(eq(properties.published, true), eq(properties.channel, 'sale'))),
    n(and(eq(properties.published, true), eq(properties.channel, 'let'))),
    n(eq(properties.published, false)),
    n(and(eq(properties.published, true), inArray(properties.status, ['under_offer', 'sold_stc', 'let_agreed']))),
  ])
  const feed = activity.filter((i) => !(i.type === 'enquiry' && i.open))
  const liveAppts = todays.filter((a) => a.status !== 'cancelled')
  const h = Number(isoToLondon(nowIso).time.slice(0, 2))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, {me.name.split(' ')[0]}</h1>
          <p className="sub">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' })} · everything coming into the office, in one place.</p>
        </div>
        <div className="actions">
          <LogCallButton className="btn btn-gold" />
          <Link className="btn btn-dark" href="/admin/diary/new">Book appointment</Link>
        </div>
      </div>

      {lic.rows.length ? (() => {
        const act = lic.rows.filter((r) => ['unlicensed', 'expired', 'due30', 'due90', 'upcoming'].includes(r.a.bucket) || r.a.certs.some((c) => c.state === 'expired' || c.state === 'due30'))
        return (
          <section className={`card card-pad lic-dash${act.some((r) => ['unlicensed', 'expired', 'due30'].includes(r.a.bucket)) ? ' urgent' : ''}`} style={{ marginBottom: 18 }}>
            <div className="today-head">
              <div>
                <h2>Licensing{act.length ? ` · ${act.length} need attention` : ''}</h2>
                <p className="card-sub">{act.length ? 'Licences and certificates expired, due within 90 days, or a scheme starting soon.' : `All ${lic.rows.length} rented properties are licensed or don’t need one, with nothing due in the next 90 days.`}</p>
              </div>
              <Link className="btn btn-ghost btn-sm" href="/admin/licensing">Licensing register</Link>
            </div>
            {act.length ? (
              <ul className="lic-dash-list">
                {act.slice(0, 6).map((r) => {
                  const b = bucketOf(r.a.bucket), cert = r.a.certs.find((c) => c.state === 'expired' || c.state === 'due30')
                  const showCert = !['unlicensed', 'expired', 'due30', 'due90', 'upcoming'].includes(r.a.bucket) && cert
                  return (
                    <li key={r.id}>
                      <Link href={`/admin/licensing/${r.id}`}>{r.address}</Link>
                      <span className={`lic-pill t-${showCert ? 'amber' : b.tone}`}>{showCert ? `${cert.label} ${cert.days! < 0 ? 'expired' : 'due'}` : b.label}</span>
                      <span className="addr-sub">{showCert ? fmtDay(cert.date) : r.a.validUntil && r.a.days != null ? `${fmtDay(r.a.validUntil)} · ${inWords(r.a.days)}` : r.a.upcoming ? `from ${fmtDay(r.a.upcoming.scheme.startsOn)}` : ''}</span>
                    </li>
                  )
                })}
              </ul>
            ) : null}
            {act.length > 6 ? <Link className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} href="/admin/licensing">See all {act.length}</Link> : null}
          </section>
        )
      })() : null}

      <section className={`card card-pad inbox${open.length ? ' has-items' : ''}`} aria-labelledby="inbox-h">
        <div className="today-head">
          <div>
            <h2 id="inbox-h">New enquiries waiting for a reply{open.length ? ` · ${open.length}` : ''}</h2>
            <p className="card-sub">From the website. Calling them back or booking them in takes them off this list.</p>
          </div>
          <Link className="btn btn-ghost btn-sm" href="/admin/enquiries">All enquiries</Link>
        </div>
        {open.length === 0 ? <p className="card-sub" style={{ marginTop: 10 }}>All caught up.</p> : (
          <ActivityFeed items={open} meId={me.id} showDay={(iso) => dayLabel(isoToLondon(iso).date, today)} />
        )}
      </section>

      <div className="two">
        <section className="card card-pad">
          <div className="today-head">
            <h2>Today’s activity{feed.length ? ` · ${feed.length}` : ''}</h2>
            <Link className="btn btn-ghost btn-sm" href="/admin/activity">Full activity log</Link>
          </div>
          {feed.length === 0 ? <p className="card-sub" style={{ marginTop: 10 }}>Nothing logged yet today. Press <kbd>N</kbd> anywhere to log a call or email.</p> : <ActivityFeed items={feed.slice(0, 25)} meId={me.id} />}
          {feed.length > 25 ? <Link className="btn btn-ghost btn-sm" href="/admin/activity" style={{ marginTop: 10 }}>See all {feed.length}</Link> : null}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <section className="card card-pad">
            <div className="today-head">
              <h2>Today’s diary</h2>
              <Link className="btn btn-ghost btn-sm" href={`/admin/calendar?d=${today}`}>Calendar</Link>
            </div>
            {liveAppts.length === 0 ? <p className="card-sub" style={{ marginTop: 8 }}>Nothing booked for today.</p> : (
              <ul className="today-list">
                {liveAppts.map((a) => (
                  <li key={a.id} className={a.staffId === me.id ? 'mine' : undefined}>
                    <Link href={`/admin/diary/${a.id}`}>
                      <span className="num"><b>{fmtTime(a.startsAt)}</b> to {fmtTime(endIso(a.startsAt, a.durationMin))}</span>
                      <span>{kindLabel(a.kind)} · {a.location || 'No address'}</span>
                      <span className="who">{a.staffId === me.id ? 'You' : a.staffName}{a.status === 'completed' ? ' · done' : ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card card-pad">
            <div className="today-head">
              <h2>Callbacks</h2>
              <Link className="btn btn-ghost btn-sm" href="/admin/my-day?who=all">Whole office</Link>
            </div>
            <div className="mini-stats">
              <Link href="/admin/my-day?who=all" className={overdue ? 'warn' : undefined}><b>{overdue}</b><span>Overdue</span></Link>
              <Link href="/admin/my-day?who=all"><b>{dueToday}</b><span>Due by end of today</span></Link>
            </div>
          </section>

          <section className="card card-pad">
            <div className="today-head">
              <h2>Listings</h2>
              <Link className="btn btn-ghost btn-sm" href="/admin/properties">All properties</Link>
            </div>
            <div className="mini-stats">
              <Link href="/admin/properties?channel=sale&published=live"><b>{liveSale}</b><span>For sale</span></Link>
              <Link href="/admin/properties?channel=let&published=live"><b>{liveLet}</b><span>To let</span></Link>
              <Link href="/admin/properties?published=draft"><b>{drafts}</b><span>Drafts</span></Link>
              <div><b>{progressing}</b><span>Under offer / agreed</span></div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              <form action={createProperty}><input type="hidden" name="channel" value="sale" /><button className="btn btn-gold btn-sm" type="submit">Add property for sale</button></form>
              <form action={createProperty}><input type="hidden" name="channel" value="let" /><button className="btn btn-dark btn-sm" type="submit">Add property to let</button></form>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
