import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { admins, auditLog, consents } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { activeStaff } from '@/lib/appointments'
import { audit, getContact, openTasks, timelineFor } from '@/lib/contacts'
import { moneyShort, roleLabel, rolesOf } from '@/lib/crm-options'
import { fmtTime, fmtWhen, isoToLondon, dayLabel, todayLondon } from '@/lib/time'
import { archiveContact, setDoNotContact } from '../../../crm-actions'
import { erasePersonAction, stopConsent } from '../../../lead-actions'
import { LogCallButton } from '../../LogCallButton'
import { TaskDoneButton } from '../../TaskDoneButton'
import { AddCallbackForm, EditContactForm } from './ContactForms'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Contact' }

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erase?: string }> }) {
  const me = await requireAdmin()
  const { id } = await params
  const sp = await searchParams
  const c = await getContact(id)
  if (!c) notFound()
  await audit(me.id, 'view', 'contact', c.id)
  const [timeline, open, staff, history, consentLog] = await Promise.all([
    timelineFor(c),
    openTasks({ contactId: c.id }),
    activeStaff(),
    me.role === 'admin'
      ? db.select({ a: auditLog, name: admins.name }).from(auditLog).leftJoin(admins, eq(auditLog.adminId, admins.id))
        .where(and(eq(auditLog.entity, 'contact'), eq(auditLog.entityId, c.id))).orderBy(desc(auditLog.at)).limit(30)
      : Promise.resolve([]),
    db.select().from(consents).where(eq(consents.contactId, c.id)).orderBy(desc(consents.createdAt)).limit(20),
  ])
  const roles = rolesOf(c.roles)
  const today = todayLondon()
  const wants = [c.minBeds != null ? (c.minBeds === 0 ? 'Studio' : `${c.minBeds}+ bedrooms`) : '', c.areas ? `in ${c.areas}` : '', c.maxPrice ? `up to ${moneyShort(c.maxPrice)}` : ''].filter(Boolean).join(' ')
  const nowIso = new Date().toISOString()

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumb"><Link href="/admin/contacts">Contacts</Link></p>
          <h1>{c.name}{c.archived ? <span className="pill draft" style={{ marginLeft: 10, verticalAlign: 6 }}>Archived</span> : null}{c.doNotContact ? <span className="pill warn" style={{ marginLeft: 10, verticalAlign: 6 }}>Do not call back</span> : null}{c.marketingOptOut ? <span className="pill" style={{ marginLeft: 10, verticalAlign: 6 }} title="Unsubscribed from emails about new listings">No property emails</span> : null}</h1>
          <p className="sub contact-sub">
            {c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : null}
            {c.phone2 ? <a href={`tel:${c.phone2}`}>{c.phone2}</a> : null}
            {c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : null}
            {roles.map((r) => <span key={r} className="pill">{roleLabel(r)}</span>)}
          </p>
        </div>
        <div className="actions">
          <form action={setDoNotContact}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="on" value={c.doNotContact ? '0' : '1'} />
            <button className={`btn ${c.doNotContact ? 'btn-ghost' : 'btn-danger'}`} type="submit">{c.doNotContact ? 'Allow calls again' : 'Do not call back'}</button>
          </form>
          <LogCallButton prefill={{ contactId: c.id, direction: 'out' }} className="btn btn-gold" />
          <Link className="btn btn-ghost" href={`/admin/diary/new?contact=${c.id}&kind=viewing`}>Book viewing</Link>
          <Link className="btn btn-ghost" href={`/admin/diary/new?contact=${c.id}&kind=valuation`}>Book valuation</Link>
        </div>
      </div>

      <div className="two">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          {wants || c.position || c.address || c.notes ? (
            <section className="card card-pad facts-card">
              <dl className="facts">
                {wants ? <><dt>Looking for</dt><dd>{wants}</dd></> : null}
                {c.address ? <><dt>Their property</dt><dd>{c.address}</dd></> : null}
                {c.position ? <><dt>Position</dt><dd>{c.position}</dd></> : null}
                {c.ownerName ? <><dt>Looked after by</dt><dd>{c.ownerName}</dd></> : null}
                {c.source ? <><dt>Heard about us</dt><dd>{c.source}</dd></> : null}
                {c.notes ? <><dt>Notes</dt><dd className="pre">{c.notes}</dd></> : null}
              </dl>
            </section>
          ) : null}

          <section className="card card-pad">
            <h2>History</h2>
            <ol className="timeline">
              {timeline.map((t) => (
                <li key={t.id} className={`tl-${t.type}`}>
                  <span className="tl-dot" aria-hidden="true" />
                  <div>
                    <div className="tl-title">{t.href ? <Link href={t.href}>{t.title}</Link> : t.title}</div>
                    {t.body ? <p className="tl-body pre">{t.body}</p> : null}
                    <div className="tl-meta">{dayLabel(isoToLondon(t.at).date, today)} {fmtTime(t.at)}{t.by ? ` · ${t.by}` : ''}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <section className="card card-pad">
            <h2>Callbacks to do</h2>
            {open.length === 0 ? <p className="card-sub" style={{ marginTop: 6 }}>Nothing outstanding.</p> : (
              <ul className="task-list">
                {open.map((t) => (
                  <li key={t.id} className={`task ${t.dueAt < nowIso ? 'overdue' : 'today'}`}>
                    <span className="task-main"><span className="task-name">{t.title}</span><span className="task-note">{fmtWhen(t.dueAt)} · {t.assignedTo === me.id ? 'you' : t.assigneeName}</span></span>
                    <span className="task-actions"><TaskDoneButton id={t.id} /></span>
                  </li>
                ))}
              </ul>
            )}
            <details className="cb-add">
              <summary>Add a callback</summary>
              <AddCallbackForm contactId={c.id} staff={staff.map((s) => ({ id: s.id, name: s.name }))} meId={me.id} />
            </details>
          </section>

          <section className="card card-pad">
            <details>
              <summary className="det-sum">Edit details</summary>
              <EditContactForm
                staff={staff.map((s) => ({ id: s.id, name: s.name }))}
                c={{ id: c.id, name: c.name, phone: c.phone, phone2: c.phone2, email: c.email, roles, source: c.source, areas: c.areas, minBeds: c.minBeds, maxPrice: c.maxPrice, position: c.position, address: c.address, notes: c.notes, ownerId: c.ownerId }}
              />
            </details>
          </section>

          <section className="card card-pad" id="privacy">
            <h2>Consent &amp; privacy</h2>
            <dl className="consent-facts">
              {(['email', 'whatsapp'] as const).map((ch) => {
                const at = ch === 'email' ? c.emailOptInAt : c.whatsappOptInAt
                const stopped = ch === 'email' && !at && c.marketingOptOut
                return (
                  <div key={ch} className="consent-line">
                    <dt>{ch === 'email' ? 'Marketing emails' : 'WhatsApp'}</dt>
                    <dd>
                      {at ? <>Agreed {dayLabel(isoToLondon(at).date, today)}{c.consentSource ? <small> · {c.consentSource}</small> : null}</> : stopped ? 'Unsubscribed' : 'Not agreed'}
                      {at ? (
                        <form action={stopConsent} style={{ display: 'inline', marginLeft: 8 }}>
                          <input type="hidden" name="contactId" value={c.id} />
                          <input type="hidden" name="channel" value={ch} />
                          <button className="btn btn-ghost btn-sm" type="submit">They asked to stop</button>
                        </form>
                      ) : null}
                    </dd>
                  </div>
                )
              })}
            </dl>
            {consentLog.length ? (
              <details className="consent-log">
                <summary className="det-sum">Consent history ({consentLog.length})</summary>
                <ul className="audit">
                  {consentLog.map((x) => <li key={x.id}><b>{x.granted ? 'Agreed to' : 'Stopped'} {x.channel === 'email' ? 'emails' : 'WhatsApp'}</b> · {dayLabel(isoToLondon(x.createdAt).date, today)} {fmtTime(x.createdAt)}{x.source ? ` · ${x.source}` : ''}{x.wording ? <span className="consent-words">“{x.wording}”</span> : null}</li>)}
                </ul>
              </details>
            ) : null}
            <div className="actions" style={{ marginTop: 12 }}>
              <a className="btn btn-ghost btn-sm" href={`/admin/contacts/${c.id}/export`} download>Download their data (subject access request)</a>
            </div>
            {me.role === 'admin' ? (
              <details className="erase" open={sp.erase === 'confirm'}>
                <summary className="det-sum">Erase this person (right to be forgotten)</summary>
                <p className="card-sub">Deletes their record, enquiries, emails, notes, calls, callbacks, alerts and consent history for good. Diary appointments stay but lose their name and details. Download their data first if they asked for a copy.</p>
                <form action={erasePersonAction} className="erase-form">
                  <input type="hidden" name="contactId" value={c.id} />
                  <label>Type DELETE to confirm <input name="confirm" autoComplete="off" className="input" aria-invalid={sp.erase === 'confirm' || undefined} /></label>
                  {sp.erase === 'confirm' ? <p className="err" role="alert">Type DELETE in the box to erase them.</p> : null}
                  <button className="btn btn-danger btn-sm" type="submit">Erase everything about {c.name.split(/\s+/)[0]}</button>
                </form>
              </details>
            ) : null}
          </section>

          {me.role === 'admin' ? (
            <section className="card card-pad">
              <details>
                <summary className="det-sum">Who has opened or changed this record</summary>
                <ul className="audit">
                  {history.map(({ a, name }) => <li key={a.id}><b>{name ?? 'Unknown'}</b> {a.action === 'view' ? 'opened it' : a.action === 'log_call' ? 'logged a call' : a.action === 'update' ? 'edited details' : a.action} · {dayLabel(isoToLondon(a.at).date, today)} {fmtTime(a.at)}</li>)}
                </ul>
              </details>
              <form action={archiveContact} style={{ marginTop: 14 }}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="archived" value={c.archived ? '0' : '1'} />
                <button className="btn btn-danger btn-sm" type="submit">{c.archived ? 'Restore contact' : 'Archive contact'}</button>
              </form>
            </section>
          ) : null}
        </div>
      </div>
    </>
  )
}
