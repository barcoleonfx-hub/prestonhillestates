import Link from 'next/link'
import { enquiryLabel } from '@/lib/enquiry-labels'
import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { db } from '@/db/client'
import { admins, contacts, enquiries, tasks } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { listBetween } from '@/lib/appointments'
import { kindLabel } from '@/lib/appointment-options'
import { addDays, durationLabel, endIso, fmtTime, isoToLondon, londonToIso, todayLondon } from '@/lib/time'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Calendar' }

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

/** Monday on or before the 1st, through the Sunday on or after the last day: always whole weeks. */
function gridFor(month: string) {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const last = new Date(Date.UTC(y, m, 0))
  const start = addDays(first.toISOString().slice(0, 10), -((first.getUTCDay() + 6) % 7))
  const end = addDays(last.toISOString().slice(0, 10), 6 - ((last.getUTCDay() + 6) % 7))
  const days: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return { days, start, end }
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string; d?: string; who?: string; show?: string }> }) {
  const me = await requireAdmin()
  const sp = await searchParams
  const today = todayLondon()
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : (sp.d ?? today).slice(0, 7)
  const selected = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : today.startsWith(month) ? today : `${month}-01`
  const mine = sp.who === 'mine'
  const show = ['appointments', 'callbacks', 'enquiries'].includes(sp.show ?? '') ? sp.show! : 'all'
  const { days, start, end } = gridFor(month)
  const fromIso = londonToIso(start, '00:00')!
  const toIso = londonToIso(addDays(end, 1), '00:00')!

  const [allAppts, allCbs, allEnqs] = await Promise.all([
    listBetween(fromIso, toIso, { staffId: mine ? me.id : undefined }),
    db.select({ t: tasks, name: contacts.name, phone: contacts.phone, who: admins.name }).from(tasks)
      .innerJoin(admins, eq(tasks.assignedTo, admins.id)).leftJoin(contacts, eq(tasks.contactId, contacts.id))
        .where(and(gte(tasks.dueAt, fromIso), lt(tasks.dueAt, toIso), ...(mine ? [eq(tasks.assignedTo, me.id)] : []))).orderBy(asc(tasks.dueAt)),
    db.select().from(enquiries).where(and(gte(enquiries.createdAt, fromIso), lt(enquiries.createdAt, toIso))).orderBy(asc(enquiries.createdAt)),
  ])
  const appts = show === 'all' || show === 'appointments' ? allAppts : []
  const cbs = show === 'all' || show === 'callbacks' ? allCbs : []
  const enqs = show === 'all' || show === 'enquiries' ? allEnqs : []
  const dayOf = (iso: string) => isoToLondon(iso).date
  const byDay = new Map<string, { appts: typeof appts; cbs: typeof cbs; enqs: typeof enqs }>()
  const slot = (d: string) => byDay.get(d) ?? (byDay.set(d, { appts: [], cbs: [], enqs: [] }), byDay.get(d)!)
  for (const a of appts) slot(dayOf(a.startsAt)).appts.push(a)
  for (const c of cbs) slot(dayOf(c.t.dueAt)).cbs.push(c)
  for (const e of enqs) slot(dayOf(e.createdAt)).enqs.push(e)

  const [y, m] = month.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
  const title = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const href = (p: Record<string, string>) => `/admin/calendar?${new URLSearchParams(Object.entries({ m: month, ...(mine ? { who: 'mine' } : {}), ...(show !== 'all' ? { show } : {}), ...p }).filter(([, v]) => v))}`
  const sel = byDay.get(selected) ?? { appts: [], cbs: [], enqs: [] }
  const nowIso = new Date().toISOString()
  const selTitle = new Date(`${selected}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p className="sub">Appointments, callbacks and website enquiries for {mine ? 'you' : 'the whole office'}. Click a day to see everything on it.</p>
        </div>
        <div className="actions">
          <Link className="btn btn-gold" href={`/admin/diary/new?date=${selected >= today ? selected : today}`}>Book appointment</Link>
        </div>
      </div>

      <div className="filters cal-filters">
        <div className="cal-nav">
          <Link className="btn btn-ghost btn-sm" href={href({ m: prev, d: '' })} aria-label="Previous month">←</Link>
          <h2 className="cal-title">{title}</h2>
          <Link className="btn btn-ghost btn-sm" href={href({ m: next, d: '' })} aria-label="Next month">→</Link>
          {!today.startsWith(month) ? <Link className="btn btn-ghost btn-sm" href={href({ m: today.slice(0, 7), d: today })}>Today</Link> : null}
        </div>
        <div className="seg" role="group" aria-label="Show">
          {[['all', 'Everything'], ['appointments', 'Appointments'], ['callbacks', 'Callbacks'], ['enquiries', 'Website enquiries']].map(([v, l]) => (
            <Link key={v} className={show === v ? 'on' : undefined} href={href({ show: v === 'all' ? '' : v, d: selected })}>{l}</Link>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Whose">
          <Link className={!mine ? 'on' : undefined} href={href({ who: '', d: selected })}>Everyone</Link>
          <Link className={mine ? 'on' : undefined} href={href({ who: 'mine', d: selected })}>Just mine</Link>
        </div>
      </div>

      <div className="cal-wrap">
        <section className="card cal" aria-label={title}>
          <div className="cal-head">{WEEKDAYS.map((w) => <div key={w}>{w}</div>)}</div>
          <div className="cal-grid">
            {days.map((d) => {
              const s = byDay.get(d)
              const out = !d.startsWith(month)
              const live = s?.appts.filter((a) => a.status !== 'cancelled') ?? []
              return (
                <Link key={d} href={href({ d, m: month })} className={`cal-day${out ? ' out' : ''}${d === today ? ' today' : ''}${d === selected ? ' sel' : ''}`} aria-label={`${d}: ${live.length} appointments, ${s?.cbs.length ?? 0} callbacks, ${s?.enqs.length ?? 0} enquiries`}>
                  <span className="cal-num">{Number(d.slice(8))}</span>
                  {live.slice(0, 3).map((a) => (
                    <span key={a.id} className={`cal-ev k-${a.kind}${a.status === 'completed' ? ' done' : ''}`}>{fmtTime(a.startsAt)} {kindLabel(a.kind)} · {initials(a.staffName)}</span>
                  ))}
                  {live.length > 3 ? <span className="cal-more">+{live.length - 3} more</span> : null}
                  <span className="cal-badges">
                    {s?.cbs.length ? <span className="cal-badge cb" title="Callbacks">{s.cbs.length} callback{s.cbs.length === 1 ? '' : 's'}</span> : null}
                    {s?.enqs.length ? <span className="cal-badge enq" title="Website enquiries">{s.enqs.length} enquir{s.enqs.length === 1 ? 'y' : 'ies'}</span> : null}
                  </span>
                  <span className="cal-dots" aria-hidden="true">
                    {live.length ? <i className="a" /> : null}{s?.cbs.length ? <i className="c" /> : null}{s?.enqs.length ? <i className="e" /> : null}
                  </span>
                </Link>
              )
            })}
          </div>
        </section>

        <aside className="card card-pad cal-side" aria-label={selTitle}>
          <h2>{selTitle}</h2>
          {sel.appts.length + sel.cbs.length + sel.enqs.length === 0 ? <p className="card-sub" style={{ marginTop: 8 }}>Nothing on this day.</p> : null}
          {sel.appts.length ? (
            <>
              <h3 className="task-h">Appointments · {sel.appts.length}</h3>
              <ul className="cal-list">
                {sel.appts.map((a) => (
                  <li key={a.id} className={a.status === 'cancelled' ? 'cancelled' : undefined}>
                    <Link href={`/admin/diary/${a.id}`}>
                      <span className="num"><b>{fmtTime(a.startsAt)}</b>–{fmtTime(endIso(a.startsAt, a.durationMin))}</span>
                      <span><b>{kindLabel(a.kind)}</b>{a.contactName ? ` with ${a.contactName}` : ''} · {a.location || 'No address'} · {durationLabel(a.durationMin)}</span>
                      <span className="who">{a.staffId === me.id ? 'You' : a.staffName}{a.status === 'completed' ? ' · done' : a.status === 'cancelled' ? ' · cancelled' : ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {sel.cbs.length ? (
            <>
              <h3 className="task-h">Callbacks · {sel.cbs.length}</h3>
              <ul className="cal-list">
                {sel.cbs.map(({ t, name, phone, who }) => (
                  <li key={t.id} className={t.doneAt ? 'done' : t.dueAt < nowIso ? 'late' : undefined}>
                    <Link href={t.contactId ? `/admin/contacts/${t.contactId}` : '/admin/my-day'}>
                      <span className="num"><b>{fmtTime(t.dueAt)}</b></span>
                      <span><b>{name ?? t.title}</b>{phone ? ` · ${phone}` : ''}{t.doneAt ? ' · done' : t.dueAt < nowIso ? ' · overdue' : ''}</span>
                      <span className="who">{t.assignedTo === me.id ? 'You' : who}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {sel.enqs.length ? (
            <>
              <h3 className="task-h">Website enquiries · {sel.enqs.length}</h3>
              <ul className="cal-list">
                {sel.enqs.map((e) => (
                  <li key={e.id} className={e.handled ? 'done' : 'late'}>
                    <Link href={e.contactId ? `/admin/contacts/${e.contactId}` : '/admin/enquiries'}>
                      <span className="num"><b>{fmtTime(e.createdAt)}</b></span>
                      <span><b>{e.name}</b> · {e.kind === 'valuation' ? `Valuation, ${e.postcode}` : enquiryLabel(e)}{e.handled ? '' : ' · needs a reply'}</span>
                      <span className="who">{e.phone ?? ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {selected >= today ? <Link className="btn btn-ghost btn-sm" href={`/admin/diary/new?date=${selected}`}>Book on this day</Link> : null}
            <Link className="btn btn-ghost btn-sm" href={`/admin/activity?d=${selected <= today ? selected : today}`}>Activity log</Link>
          </p>
        </aside>
      </div>
    </>
  )
}
