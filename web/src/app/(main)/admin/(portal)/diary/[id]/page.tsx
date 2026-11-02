import Link from 'next/link'
import { notFound } from 'next/navigation'
import { inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { admins } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { getAppointment } from '@/lib/appointments'
import { interestLabel, kindLabel, outcomeLabel, REMINDERS } from '@/lib/appointment-options'
import { durationLabel, endIso, fmtTime, fmtWhen } from '@/lib/time'
import { OutcomeForm } from '../OutcomeForm'
import { CancelForm } from './CancelForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Appointment' }

const stamp = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })

export default async function AppointmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const me = await requireAdmin()
  const { id } = await params
  const { saved } = await searchParams
  const a = await getAppointment(id)
  if (!a) notFound()
  const people = await db.select({ id: admins.id, name: admins.name }).from(admins)
    .where(inArray(admins.id, [a.createdBy, a.outcomeBy].filter((x): x is string => !!x)))
  const nameOf = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? 'someone'

  const started = new Date(a.startsAt).getTime() <= Date.now()
  const canRecord = a.status === 'scheduled' && started && (a.staffId === me.id || me.role === 'admin')
  const mine = a.staffId === me.id
  const maps = a.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.location)}` : null

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumb"><Link href="/admin/diary">Diary</Link></p>
          <h1>{kindLabel(a.kind)}{a.contactName ? ` with ${a.contactName}` : ''}</h1>
          <p className="sub">
            {a.status === 'scheduled' ? (started ? <span className="pill warn">Outcome needed</span> : <span className="pill gold">Booked</span>) : null}
            {a.status === 'completed' ? <span className="pill live"><span className="dot" />Done</span> : null}
            {a.status === 'cancelled' ? <span className="pill draft">Cancelled</span> : null}
            {' '}Booked by {nameOf(a.createdBy)} on {stamp(a.createdAt)}
          </p>
        </div>
        {a.status === 'scheduled' ? (
          <div className="actions">
            <Link className="btn btn-ghost" href={`/admin/diary/${a.id}/edit`}>Change time or person</Link>
          </div>
        ) : null}
      </div>

      {saved ? <div className="notice ok" role="status" style={{ marginBottom: 18 }}>{saved === 'changed' ? 'Saved. Everyone has been told about the change.' : 'Booked. Everyone has been alerted and emailed.'}</div> : null}

      <div className="two">
        <section className="card card-pad">
          <dl className="facts">
            <dt>When</dt><dd><b>{fmtWhen(a.startsAt)}</b> to {fmtTime(endIso(a.startsAt, a.durationMin))} ({durationLabel(a.durationMin)})</dd>
            <dt>Where</dt><dd>{a.location || 'Not set'}{maps ? <> · <a href={maps} target="_blank" rel="noreferrer">Map</a></> : null}{a.propertyId ? <> · <Link href={`/admin/properties/${a.propertyId}`}>{a.propertyRef}</Link></> : null}</dd>
            <dt>Who’s going</dt><dd><b>{mine ? 'You' : a.staffName}</b>{a.staffPhone ? <> · <a href={`tel:${a.staffPhone}`}>{a.staffPhone}</a></> : null}</dd>
            <dt>Meeting</dt><dd>{a.contactName || 'Not set'}
              {a.contactPhone ? <> · <a href={`tel:${a.contactPhone}`}>{a.contactPhone}</a></> : null}
              {a.contactEmail ? <> · <a href={`mailto:${a.contactEmail}`}>{a.contactEmail}</a></> : null}</dd>
            {a.notes ? <><dt>Notes</dt><dd className="pre">{a.notes}</dd></> : null}
            <dt>Reminder</dt><dd>{REMINDERS.find((r) => r.value === a.reminderMin)?.label ?? `${a.reminderMin} min before`}{a.remindedAt ? ` · sent ${fmtTime(a.remindedAt)}` : ''}</dd>
            {a.status === 'cancelled' ? <><dt>Cancelled</dt><dd>{a.cancelReason} · {stamp(a.updatedAt)}</dd></> : null}
          </dl>
          {a.status === 'scheduled' ? <div style={{ marginTop: 20 }}><CancelForm id={a.id} /></div> : null}
        </section>

        <section className="card card-pad">
          <h2>Outcome</h2>
          {a.status === 'completed' ? (
            <dl className="facts" style={{ marginTop: 12 }}>
              <dt>Result</dt><dd><b>{outcomeLabel(a.outcome)}</b>{a.outcomeInterest ? ` · ${interestLabel(a.kind, a.outcomeInterest)}` : ''}</dd>
              <dt>Notes</dt><dd className="pre">{a.outcomeNotes}</dd>
              <dt>Next step</dt><dd>{a.outcomeNext}</dd>
              <dt>Recorded</dt><dd>{nameOf(a.outcomeBy)} · {a.outcomeAt ? stamp(a.outcomeAt) : ''}</dd>
            </dl>
          ) : a.status === 'cancelled' ? (
            <p className="card-sub">No outcome needed, it was cancelled.</p>
          ) : canRecord ? (
            <>
              <p className="card-sub">{mine ? 'You went, so this is yours to fill in. The portal locks 15 minutes after the end time until it’s done.' : `${a.staffName} went. As an admin you can fill this in for them.`}</p>
              <OutcomeForm id={a.id} kind={a.kind} />
            </>
          ) : started ? (
            <p className="card-sub">Waiting for {a.staffName} to record what happened.</p>
          ) : (
            <p className="card-sub">{mine ? 'You’ll' : `${a.staffName} will`} record what happened straight after. It’s required: the portal locks for {mine ? 'you' : 'them'} until it’s done.</p>
          )}
        </section>
      </div>
    </>
  )
}
