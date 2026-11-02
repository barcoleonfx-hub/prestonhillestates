import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { listBetween, needingOutcome, type ApptRow } from '@/lib/appointments'
import { interestLabel, kindLabel, outcomeLabel } from '@/lib/appointment-options'
import { addDays, dayLabel, durationLabel, endIso, fmtTime, fmtWhen, isoToLondon, londonToIso, todayLondon } from '@/lib/time'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Diary' }

function groupByDay(rows: ApptRow[]) {
  const map = new Map<string, ApptRow[]>()
  for (const r of rows) {
    const d = isoToLondon(r.startsAt).date
    map.set(d, [...(map.get(d) ?? []), r])
  }
  return [...map.entries()]
}

export default async function DiaryPage({ searchParams }: { searchParams: Promise<{ who?: string; view?: string }> }) {
  const me = await requireAdmin()
  const sp = await searchParams
  const who = sp.who === 'mine' ? 'mine' : 'all'
  const view = sp.view === 'past' ? 'past' : 'upcoming'
  const today = todayLondon()
  const staffId = who === 'mine' ? me.id : undefined

  const overdue = await needingOutcome(me.role === 'admin' && who === 'all' ? undefined : me.id)
  const rows = view === 'upcoming'
    ? (await listBetween(londonToIso(today, '00:00')!, londonToIso(addDays(today, 60), '00:00')!, { staffId, includeCancelled: true }))
    : (await listBetween(londonToIso(addDays(today, -60), '00:00')!, new Date().toISOString(), { staffId, includeCancelled: true })).reverse()
  const days = groupByDay(rows)
  const href = (p: Record<string, string>) => `/admin/diary?${new URLSearchParams({ who, view, ...p })}`

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Diary</h1>
          <p className="sub">Viewings and valuations for the whole office. Everyone is alerted when something is booked, changed or about to start.</p>
        </div>
        <div className="actions">
          <Link className="btn btn-gold" href="/admin/diary/new">Book appointment</Link>
        </div>
      </div>

      {overdue.length ? (
        <section className="card card-pad overdue" aria-labelledby="od-h">
          <h2 id="od-h">Waiting for an outcome</h2>
          <p className="card-sub">These have finished. Whoever went needs to record what happened.</p>
          <ul className="od-list">
            {overdue.map((a) => (
              <li key={a.id}>
                <Link href={`/admin/diary/${a.id}`}>
                  <b>{kindLabel(a.kind)}</b> · {fmtWhen(a.startsAt)} · {a.location || 'No address'} · <span className="od-who">{a.staffId === me.id ? 'You' : a.staffName}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="filters diary-filters">
        <div className="seg" role="group" aria-label="Show">
          <Link className={view === 'upcoming' ? 'on' : undefined} href={href({ view: 'upcoming' })}>Coming up</Link>
          <Link className={view === 'past' ? 'on' : undefined} href={href({ view: 'past' })}>Past</Link>
        </div>
        <div className="seg" role="group" aria-label="Whose">
          <Link className={who === 'all' ? 'on' : undefined} href={href({ who: 'all' })}>Everyone</Link>
          <Link className={who === 'mine' ? 'on' : undefined} href={href({ who: 'mine' })}>Just mine</Link>
        </div>
      </div>

      {days.length === 0 ? (
        <section className="card"><div className="empty">{view === 'upcoming' ? 'Nothing booked yet. ' : 'Nothing in the last 60 days. '}<Link href="/admin/diary/new">Book an appointment</Link></div></section>
      ) : (
        <div className="diary">
          {days.map(([d, list]) => (
            <section key={d} className="card diary-day">
              <h2 className="diary-date">{(() => {
                const full = new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
                const rel = dayLabel(d, today)
                return ['Today', 'Tomorrow', 'Yesterday'].includes(rel) ? <><span>{rel}</span><small>{full}</small></> : <span>{full}</span>
              })()}</h2>
              <ul>
                {list.map((a) => (
                  <li key={a.id} className={`appt s-${a.status}${a.staffId === me.id ? ' mine' : ''}`}>
                    <Link href={`/admin/diary/${a.id}`}>
                      <span className="appt-time num">{fmtTime(a.startsAt)}<small>{fmtTime(endIso(a.startsAt, a.durationMin))}</small></span>
                      <span className="appt-main">
                        <span className="appt-title"><span className={`pill k-${a.kind}`}>{kindLabel(a.kind)}</span> {a.location || 'No address'}</span>
                        <span className="appt-sub">
                          {a.contactName ? `With ${a.contactName} · ` : ''}{durationLabel(a.durationMin)}
                          {a.status === 'completed' ? ` · ${outcomeLabel(a.outcome)}${a.outcomeInterest ? `, ${interestLabel(a.kind, a.outcomeInterest).toLowerCase()}` : ''}` : ''}
                          {a.status === 'cancelled' ? ` · Cancelled: ${a.cancelReason}` : ''}
                        </span>
                      </span>
                      <span className="appt-who"><span className="avatar" aria-hidden="true">{a.staffName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</span>{a.staffId === me.id ? 'You' : a.staffName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
