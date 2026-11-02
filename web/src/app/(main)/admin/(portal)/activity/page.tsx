import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { activityBetween, activityCounts, ACTIVITY_FILTERS } from '@/lib/activity'
import { activeStaff } from '@/lib/appointments'
import { addDays, dayLabel, londonToIso, todayLondon } from '@/lib/time'
import { ActivityFeed } from '../ActivityFeed'
import { LogCallButton } from '../LogCallButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Activity' }

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ d?: string; who?: string; type?: string }> }) {
  const me = await requireAdmin()
  const sp = await searchParams
  const today = todayLondon()
  const d = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) && sp.d <= today ? sp.d : today
  const staff = await activeStaff()
  const who = sp.who === 'mine' ? me.id : staff.some((s) => s.id === sp.who) ? sp.who! : ''
  const type = ACTIVITY_FILTERS.some((f) => f.value === sp.type) ? sp.type! : ''
  const all = await activityBetween(londonToIso(d, '00:00')!, londonToIso(addDays(d, 1), '00:00')!, { staffId: who || undefined })
  const items = type ? all.filter((i) => i.type === type || (type === 'call' && i.type === 'callback_done')) : all
  const counts = activityCounts(all)
  const href = (p: Record<string, string>) => `/admin/activity?${new URLSearchParams(Object.entries({ d, who: sp.who === 'mine' ? 'mine' : who, type, ...p }).filter(([, v]) => v))}`
  const full = new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="sub">Every call, email, walk-in, website enquiry and booking, day by day.</p>
        </div>
        <div className="actions"><LogCallButton className="btn btn-gold" /></div>
      </div>

      <div className="daynav card">
        <Link className="btn btn-ghost btn-sm" href={href({ d: addDays(d, -1) })} aria-label="Previous day">←</Link>
        <div className="daynav-mid">
          <b>{['Today', 'Yesterday'].includes(dayLabel(d, today)) ? `${dayLabel(d, today)}, ` : ''}{full}</b>
          <form action="/admin/activity" className="daynav-pick">
            {who ? <input type="hidden" name="who" value={sp.who === 'mine' ? 'mine' : who} /> : null}
            {type ? <input type="hidden" name="type" value={type} /> : null}
            <input className="input" type="date" name="d" defaultValue={d} max={today} aria-label="Pick a day" />
            <button className="btn btn-ghost btn-sm" type="submit">Go</button>
          </form>
        </div>
        {d < today ? <Link className="btn btn-ghost btn-sm" href={href({ d: addDays(d, 1) })} aria-label="Next day">→</Link> : <span className="btn btn-ghost btn-sm" aria-hidden="true" style={{ visibility: 'hidden' }}>→</span>}
      </div>

      <div className="counts">
        <div className="card stat"><div className="n">{counts.calls}</div><div className="k">Calls</div></div>
        <div className="card stat"><div className="n">{counts.emails}</div><div className="k">Emails</div></div>
        <div className="card stat"><div className="n">{counts.walkIns}</div><div className="k">Walk-ins</div></div>
        <div className="card stat"><div className="n">{counts.enquiries}</div><div className="k">Website enquiries</div></div>
        <div className="card stat"><div className="n">{counts.bookings}</div><div className="k">Bookings</div></div>
      </div>

      <div className="filters">
        <div className="seg" role="group" aria-label="Type">
          <Link className={!type ? 'on' : undefined} href={href({ type: '' })}>Everything</Link>
          {ACTIVITY_FILTERS.map((f) => <Link key={f.value} className={type === f.value ? 'on' : undefined} href={href({ type: f.value })}>{f.label}</Link>)}
        </div>
        <form action="/admin/activity" className="who-form">
          <input type="hidden" name="d" value={d} />
          {type ? <input type="hidden" name="type" value={type} /> : null}
          <select className="select" name="who" defaultValue={sp.who === 'mine' ? 'mine' : who} aria-label="Whose activity">
            <option value="">Whole office</option>
            <option value="mine">Just me</option>
            {staff.filter((s) => s.id !== me.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" type="submit">Show</button>
        </form>
      </div>

      <section className="card card-pad">
        {items.length === 0 ? <div className="empty">Nothing logged{type ? ' of this type' : ''} on this day.</div> : <ActivityFeed items={items} meId={me.id} />}
      </section>
    </>
  )
}
