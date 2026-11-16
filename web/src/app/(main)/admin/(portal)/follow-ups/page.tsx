import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { STEPS, followupEmail, followupWhatsApp, type Track } from '@/lib/followup-rules'
import { followupBoard, followupSettings, trackOf, type BoardRow } from '@/lib/followups'
import { statusLabel } from '@/lib/lead-rules'
import { knownBase } from '@/lib/property-email-data'
import { fmtWhen } from '@/lib/time'
import { quietEnds, quietReason } from '@/lib/whatsapp'
import { waFor } from '@/lib/whatsapp-data'
import { followupAction, setFollowupsOn } from '../../lead-actions'
import { WhatsAppButton } from '../WhatsAppButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Follow-ups' }

const TRACK: Record<Track, string> = { 'sales-valuation': 'Sales valuation', 'lettings-valuation': 'Rental valuation', buyer: 'Buyer', tenant: 'Tenant' }

function age(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`
}

export default async function FollowupsPage() {
  const me = await requireAdmin()
  const [cfg, board, base] = await Promise.all([followupSettings(), followupBoard(), knownBase()])
  const quiet = quietReason()
  const isAdmin = me.role === 'admin'
  const act = (id: string, what: string, label: string, cls = 'btn btn-ghost btn-sm') => (
    <form action={followupAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="what" value={what} /><button className={cls} type="submit">{label}</button></form>
  )
  const waRows = await Promise.all(board.waDue.map(async (r) => {
    const wa = await waFor({ enquiry: r.e, contact: r.c, me: me.name })
    const step = STEPS[r.e.followupStep]
    const text = followupWhatsApp(trackOf(r), step.key, wa.first, me.name)
    return { r, step, wa: { ...wa, templates: [{ key: 'followup', label: step.label.replace(/^WhatsApp: /, ''), text, marketing: false }, ...wa.templates] } }
  }))
  const waitRows = await Promise.all(board.waiting.map(async (r) => ({ r, wa: await waFor({ enquiry: r.e, contact: r.c, me: me.name }) })))
  const name = (r: BoardRow) => <Link href={`/admin/enquiries/${r.e.id}?back=/admin/follow-ups`}>{r.e.name}</Link>
  const sample = { first: 'Sam', me: me.name, address: '12 Example Road', postcode: 'HA3 0PS', base, unsubscribeUrl: `${base}/unsubscribe?…` }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Follow-ups</h1>
          <p className="sub">New leads who haven’t replied get a few friendly emails from the office mailbox over two weeks, and you get a reminder to WhatsApp them. It all stops the moment they reply, a viewing or visit is booked, or you mark them lost. Nothing goes out on Sundays or before 9am or after 9pm.</p>
        </div>
      </div>

      <section className={`card card-pad fu-switch ${cfg.on ? 'on' : ''}`}>
        <div>
          <h2>{cfg.on ? 'Automatic follow-ups are on' : 'Automatic follow-ups are off'}</h2>
          <p className="card-sub">{cfg.on ? `Following up enquiries from ${cfg.since ? fmtWhen(cfg.since) : 'now'} onwards.${quiet ? ` ${quiet}: emails wait until ${quietEnds()} (10am).` : ''}` : 'Read the emails below first. When you switch on, only new enquiries are followed up (or the last few days, if you choose), never your older ones.'}</p>
        </div>
        {isAdmin ? (
          <form action={setFollowupsOn} className="fu-switch-form">
            <input type="hidden" name="on" value={cfg.on ? '0' : '1'} />
            {!cfg.on ? (
              <label>Start with
                <select name="backDays" className="input" defaultValue="0">
                  <option value="0">enquiries from now on</option>
                  <option value="3">enquiries from the last 3 days too</option>
                  <option value="7">enquiries from the last 7 days too</option>
                </select>
              </label>
            ) : null}
            <button className={`btn ${cfg.on ? 'btn-ghost' : 'btn-gold'}`} type="submit">{cfg.on ? 'Switch off' : 'Switch on'}</button>
          </form>
        ) : <p className="card-sub">An admin can switch this {cfg.on ? 'off' : 'on'}.</p>}
      </section>

      <section className="card fu-list">
        <div className="fu-head"><h2>Waiting for a first reply <span>{waitRows.length}</span></h2><p>New leads nobody has contacted yet, oldest first. The quicker the reply, the likelier they are to book.</p></div>
        {waitRows.length ? waitRows.map(({ r, wa }) => (
          <div key={r.e.id} className="fu-row">
            <span className="fu-main"><b>{name(r)}</b><small>{TRACK[trackOf(r)]} · waiting {age(r.e.createdAt)}</small></span>
            <span className="fu-acts">
              {r.e.phone && !r.c?.doNotContact ? <a className="btn btn-dark btn-sm" href={`tel:${r.e.phone.replace(/\s/g, '')}`}>Call</a> : null}
              {wa.e164 && !wa.blocked ? <WhatsAppButton wa={wa} className="btn btn-wa btn-sm" /> : null}
              <Link className="btn btn-ghost btn-sm" href={`/admin/enquiries/${r.e.id}?back=/admin/follow-ups#email`}>Email</Link>
            </span>
          </div>
        )) : <p className="fu-empty">Everyone new has been contacted. Nice work.</p>}
      </section>

      <section className="card fu-list">
        <div className="fu-head"><h2>WhatsApps to send <span>{waRows.length}</span></h2><p>The message is ready: open it, check it and press send. If you don’t send one within 3 days it’s skipped.</p></div>
        {waRows.length ? waRows.map(({ r, step, wa }) => (
          <div key={r.e.id} className="fu-row">
            <span className="fu-main"><b>{name(r)}</b><small>{TRACK[trackOf(r)]} · {step.label.replace(/^WhatsApp: /, '')} · due {fmtWhen(r.e.followupNextAt!)}</small></span>
            <span className="fu-acts"><WhatsAppButton wa={wa} className="btn btn-wa btn-sm" />{act(r.e.id, 'skip', 'Skip')}</span>
          </div>
        )) : <p className="fu-empty">{cfg.on ? 'None due right now.' : 'Switch follow-ups on to see these.'}</p>}
      </section>

      <section className="card fu-list">
        <div className="fu-head"><h2>Coming up <span>{board.upcoming.length}</span></h2><p>The next step for each lead being followed up.</p></div>
        {board.upcoming.length ? board.upcoming.map((r) => (
          <div key={r.e.id} className="fu-row">
            <span className="fu-main"><b>{name(r)}</b><small>{TRACK[trackOf(r)]} · {statusLabel(r.e.status)} · next: {STEPS[r.e.followupStep]?.label} · {fmtWhen(r.e.followupNextAt!)}</small></span>
            <span className="fu-acts">{act(r.e.id, 'pause', 'Pause')}{act(r.e.id, 'stop', 'Stop')}</span>
          </div>
        )) : <p className="fu-empty">Nothing scheduled.</p>}
      </section>

      <section className="card fu-list">
        <div className="fu-head"><h2>What’s happened</h2><p>The latest follow-ups sent, skipped or done.</p></div>
        {board.recent.length ? board.recent.map(({ l, name: who, by }) => (
          <div key={l.id} className="fu-row">
            <span className="fu-main"><b><Link href={`/admin/enquiries/${l.enquiryId}`}>{who}</Link></b><small>{STEPS.find((s) => s.key === l.step)?.label ?? l.step} · <span className={`fu-st ${l.status}`}>{({ sent: 'Sent', skipped: 'Skipped', failed: 'Failed', done: 'Sent on WhatsApp', missed: 'Not sent in time' } as Record<string, string>)[l.status] ?? l.status}</span>{l.detail && l.status !== 'done' ? ` · ${l.detail}` : ''}{by ? ` · ${by}` : ''}</small></span>
            <span className="fu-when">{fmtWhen(l.createdAt)}</span>
          </div>
        )) : <p className="fu-empty">Nothing yet.</p>}
      </section>

      <section className="card card-pad fu-preview">
        <h2>What the emails say</h2>
        <p className="card-sub">Each one is signed by whoever looks after the lead (or “The team”), comes from the office mailbox, and lands in the enquiry’s conversation, so replies come back to you. Shown here for an example lead, Sam at 12 Example Road, HA3 0PS.</p>
        {(Object.keys(TRACK) as Track[]).map((t) => (
          <details key={t}>
            <summary className="det-sum">{TRACK[t]}</summary>
            {STEPS.map((s) => {
              if (s.channel === 'whatsapp') return <div key={s.key} className="fu-mail wa"><div className="fu-mail-h"><b>Day {s.day} · WhatsApp (you send it)</b></div><pre>{followupWhatsApp(t, s.key, 'Sam', me.name)}</pre></div>
              const m = followupEmail(t, s.key, sample)!
              return <div key={s.key} className="fu-mail"><div className="fu-mail-h"><b>Day {s.day} · Email</b> · {m.subject}</div><pre>{m.text}</pre></div>
            })}
          </details>
        ))}
      </section>
    </>
  )
}
