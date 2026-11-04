import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq, or } from 'drizzle-orm'
import { db } from '@/db/client'
import { admins, contacts } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { AREAS, areaLabel } from '@/lib/mail-areas'
import { threadWithMessages } from '@/lib/mail-dashboard'
import { markThread, setThreadArea } from '../../../mail-actions'
import { ago } from '../MailRow'
import { ReplyForm } from './ReplyForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conversation' }

/** Splits off the quoted earlier email ("On … wrote:" / "> …") so the new text reads first. */
function split(body: string) {
  const lines = body.split('\n')
  const i = lines.findIndex((l, n) => /^(on .{6,120} wrote:|-{2,} ?original message|from: .+@.+)$/i.test(l.trim()) || (l.startsWith('>') && lines.slice(n, n + 2).every((x) => x.startsWith('>'))))
  return i > 0 ? { fresh: lines.slice(0, i).join('\n').trim(), quoted: lines.slice(i).join('\n').trim() } : { fresh: body.trim(), quoted: '' }
}

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const data = await threadWithMessages(id)
  if (!data) notFound()
  const { thread: t, messages } = data
  const staff = new Map((await db.select({ id: admins.id, name: admins.name }).from(admins)).map((a) => [a.id, a.name]))
  const lastIn = [...messages].reverse().find((m) => m.direction === 'in')
  const replyTo = lastIn?.replyTo || lastIn?.fromAddr || t.counterpart || ''
  const ccs = (lastIn?.ccAddrs ?? '').split(/,\s*/).filter((a) => a && !/@prestonhillestates\./i.test(a) && a !== replyTo).join(', ')
  const contact = t.counterpart ? await db.query.contacts.findFirst({ where: or(eq(contacts.emailNorm, t.counterpart), eq(contacts.email, t.counterpart)) }) : null
  const subject = /^\s*re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`
  const mailto = `mailto:${encodeURIComponent(replyTo)}?subject=${encodeURIComponent(subject)}${ccs ? `&cc=${encodeURIComponent(ccs)}` : ''}`
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <Link href="/admin/mail" style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← Inbox</Link>
          <h1 style={{ marginTop: 6, overflowWrap: 'anywhere' }}>{t.subject}</h1>
          <p className="sub">
            {t.counterpartName ? `${t.counterpartName} · ` : ''}{t.counterpart} · {messages.length} email{messages.length === 1 ? '' : 's'} · {areaLabel(t.area)}
            {t.status === 'pending' ? <> · <b style={{ color: '#A8442E' }}>waiting for us {ago(t.lastInAt)}</b></> : t.status === 'replied' ? ' · replied' : t.status === 'done' ? ' · dealt with' : ''}
            {contact ? <> · <Link href={`/admin/contacts/${contact.id}`}>Their contact record</Link></> : null}
          </p>
        </div>
        <div className="actions">
          <form action={setThreadArea} className="th-area">
            <input type="hidden" name="id" value={t.id} />
            <select className="select" name="area" defaultValue={t.area} aria-label="Part of the business">
              {AREAS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" type="submit">Move</button>
          </form>
          <form action={markThread}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="done" value={t.status === 'done' ? '0' : '1'} />
            <button className={`btn ${t.status === 'done' ? 'btn-ghost' : 'btn-dark'}`} type="submit">{t.status === 'done' ? 'Reopen' : 'Mark as dealt with'}</button>
          </form>
        </div>
      </div>

      <div className="th">
        {messages.map((m) => {
          const { fresh, quoted } = split(m.body ?? '')
          return (
            <article key={m.id} className={`th-msg ${m.direction}`}>
              <header>
                <b>{m.direction === 'out' ? (m.sentBy ? `${staff.get(m.sentBy) ?? 'Us'} (Preston Hill)` : 'Preston Hill Estates') : m.fromName || m.fromAddr}</b>
                <span>{m.direction === 'in' ? m.fromAddr : `to ${m.toAddrs}`}{m.ccAddrs ? ` · cc ${m.ccAddrs}` : ''}</span>
                <time>{when(m.sentAt)}</time>
                {m.direction === 'out' ? <span className="pill">{m.via === 'portal' ? 'Sent from the portal' : 'Sent from the mailbox'}</span> : null}
                {m.attachments ? <span className="pill">📎 {m.attachments} attachment{m.attachments === 1 ? '' : 's'} (open in Apple Mail)</span> : null}
              </header>
              <div className="th-body">{fresh || <i>(no text)</i>}</div>
              {quoted ? <details className="th-quote"><summary>Show earlier text</summary><div className="th-body">{quoted}</div></details> : null}
            </article>
          )
        })}
      </div>

      <section className="card card-pad" style={{ marginTop: 18 }}>
        <h2>Reply</h2>
        <ReplyForm threadId={t.id} to={replyTo} cc={ccs} mailto={mailto} />
      </section>
    </>
  )
}
