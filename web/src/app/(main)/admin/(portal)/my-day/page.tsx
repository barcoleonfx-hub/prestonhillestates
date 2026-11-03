import Link from 'next/link'
import { and, count, desc, eq, gte } from 'drizzle-orm'
import { db } from '@/db/client'
import { admins, calls, contacts, enquiries, properties } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { listBetween } from '@/lib/appointments'
import { kindLabel } from '@/lib/appointment-options'
import { openTasks, type TaskRow } from '@/lib/contacts'
import { directionLabel, nextLabel, roleLabel } from '@/lib/crm-options'
import { addDays, dayLabel, endIso, fmtTime, isoToLondon, londonToIso, todayLondon } from '@/lib/time'
import { LogCallButton } from '../LogCallButton'
import { TaskDoneButton } from '../TaskDoneButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My day' }

function greeting() {
  const h = Number(isoToLondon(new Date().toISOString()).time.slice(0, 2))
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default async function MyDayPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const me = await requireAdmin()
  const who = (await searchParams).who === 'all' ? 'all' : 'mine'
  const mine = who === 'mine' ? me.id : undefined
  const today = todayLondon()
  const startToday = londonToIso(today, '00:00')!
  const endToday = londonToIso(addDays(today, 1), '00:00')!
  const weekAhead = londonToIso(addDays(today, 8), '00:00')!

  const [tasksAll, appts, leads, callsToday, recentCalls] = await Promise.all([
    openTasks({ assignedTo: mine, dueBefore: weekAhead }),
    listBetween(startToday, endToday, { staffId: mine }),
    db.select({ e: enquiries, ref: properties.ref, channel: properties.channel }).from(enquiries)
      .leftJoin(properties, eq(enquiries.propertyId, properties.id))
      .where(eq(enquiries.handled, false)).orderBy(desc(enquiries.createdAt)).limit(20),
    db.select({ n: count() }).from(calls).where(and(gte(calls.createdAt, startToday), ...(mine ? [eq(calls.createdBy, mine)] : []))),
    db.select({ c: calls, name: contacts.name, by: admins.name }).from(calls)
      .innerJoin(contacts, eq(calls.contactId, contacts.id)).innerJoin(admins, eq(calls.createdBy, admins.id))
      .where(and(gte(calls.createdAt, startToday), ...(mine ? [eq(calls.createdBy, mine)] : [])))
      .orderBy(desc(calls.createdAt)).limit(12),
  ])
  const nowIso = new Date().toISOString()
  const overdue = tasksAll.filter((t) => t.dueAt < nowIso)
  const dueToday = tasksAll.filter((t) => t.dueAt >= nowIso && t.dueAt < endToday)
  const later = tasksAll.filter((t) => t.dueAt >= endToday)

  const taskList = (list: TaskRow[], tone: string) => (
    <ul className="task-list">
      {list.map((t) => (
        <li key={t.id} className={`task ${tone}`}>
          <span className="task-when num">{tone === 'later' ? <>{dayLabel(isoToLondon(t.dueAt).date, today)}<br /></> : null}<b>{fmtTime(t.dueAt)}</b></span>
          <span className="task-main">
            {t.contactId ? <Link href={`/admin/contacts/${t.contactId}`} className="task-name">{t.contactName}</Link> : <span className="task-name">{t.title}</span>}
            {t.contactPhone ? <a className="task-phone" href={`tel:${t.contactPhone}`}>{t.contactPhone}</a> : null}
            {t.note ? <span className="task-note">{t.note}</span> : null}
          </span>
          {!mine ? <span className="task-who">{t.assignedTo === me.id ? 'You' : t.assigneeName}</span> : null}
          <span className="task-actions">
            {t.contactId ? <LogCallButton prefill={{ contactId: t.contactId, direction: 'out' }} label="Log the call" className="btn btn-dark btn-sm" /> : null}
            <TaskDoneButton id={t.id} />
          </span>
        </li>
      ))}
    </ul>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting()}, {me.name.split(' ')[0]}</h1>
          <p className="sub">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' })} · {callsToday[0].n} call{callsToday[0].n === 1 ? '' : 's'} logged today{mine ? ' by you' : ''}</p>
        </div>
        <div className="actions">
          <div className="seg" role="group" aria-label="Whose">
            <Link className={who === 'mine' ? 'on' : undefined} href="/admin/my-day">Mine</Link>
            <Link className={who === 'all' ? 'on' : undefined} href="/admin/my-day?who=all">Whole office</Link>
          </div>
          <LogCallButton className="btn btn-gold" />
        </div>
      </div>

      <div className="myday">
        <div className="myday-col">
          <section className="card card-pad">
            <h2>Callbacks</h2>
            {tasksAll.length === 0 ? <p className="card-sub" style={{ marginTop: 8 }}>No callbacks due this week. When you log a call with “Call back”, it lands here and pops up when it’s due.</p> : null}
            {overdue.length ? <><h3 className="task-h overdue-h">Overdue · {overdue.length}</h3>{taskList(overdue, 'overdue')}</> : null}
            {dueToday.length ? <><h3 className="task-h">Later today · {dueToday.length}</h3>{taskList(dueToday, 'today')}</> : null}
            {later.length ? <><h3 className="task-h">This week · {later.length}</h3>{taskList(later, 'later')}</> : null}
          </section>

          <section className="card card-pad">
            <h2>New website leads</h2>
            <p className="card-sub">Nobody has dealt with these yet. Logging a call takes them off this list.</p>
            {leads.length === 0 ? <p className="card-sub" style={{ marginTop: 8 }}>All caught up.</p> : (
              <ul className="lead-list">
                {leads.map(({ e, ref, channel }) => (
                  <li key={e.id}>
                    <span className="lead-main">
                      <b>{e.name}</b> <span className="pill">{e.kind === 'valuation' ? `Valuation · ${e.postcode}` : e.kind === 'buyer' ? 'Buyer registration' : `Viewing${ref ? ` · ${ref}` : ''}`}</span>
                      <span className="lead-meta">{[e.phone, e.email].filter(Boolean).join(' · ')} · {dayLabel(isoToLondon(e.createdAt).date, today)} {fmtTime(e.createdAt)}</span>
                    </span>
                    <LogCallButton
                      label="Call them"
                      className="btn btn-dark btn-sm"
                      prefill={{
                        name: e.name, phone: e.phone ?? undefined, email: e.email ?? undefined, enquiryId: e.id, direction: 'out',
                        propertyId: e.propertyId ?? undefined,
                        callerType: e.kind === 'valuation' ? (e.intent === 'letting' ? 'landlord' : 'seller') : channel === 'let' ? 'tenant' : 'buyer',
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="myday-col">
          <section className="card card-pad">
            <h2>{mine ? 'Your appointments today' : 'Appointments today'}</h2>
            {appts.filter((a) => a.status !== 'cancelled').length === 0 ? <p className="card-sub" style={{ marginTop: 8 }}>Nothing in the diary today.</p> : (
              <ul className="today-list">
                {appts.filter((a) => a.status !== 'cancelled').map((a) => (
                  <li key={a.id} className={a.staffId === me.id ? 'mine' : undefined}>
                    <Link href={`/admin/diary/${a.id}`}>
                      <span className="num"><b>{fmtTime(a.startsAt)}</b> to {fmtTime(endIso(a.startsAt, a.durationMin))}</span>
                      <span>{kindLabel(a.kind)} · {a.location || 'No address'}{a.contactName ? ` · ${a.contactName}` : ''}</span>
                      <span className="who">{a.staffId === me.id ? 'You' : a.staffName}{a.status === 'completed' ? ' · done' : ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card card-pad">
            <h2>Calls logged today</h2>
            {recentCalls.length === 0 ? <p className="card-sub" style={{ marginTop: 8 }}>None yet. Press <kbd>N</kbd> anywhere in the portal to log one.</p> : (
              <ul className="call-list">
                {recentCalls.map(({ c, name, by }) => (
                  <li key={c.id}>
                    <span className="num">{fmtTime(c.createdAt)}</span>
                    <span><Link href={`/admin/contacts/${c.contactId}`}><b>{name}</b></Link> · {roleLabel(c.callerType)} · {directionLabel(c.direction)} → {nextLabel(c.nextStep)}</span>
                    {!mine ? <span className="who">{by}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
