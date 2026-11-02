import Link from 'next/link'
import { and, desc, eq, like, or, sql, type SQL } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins, contacts, tasks } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { CALLER_TYPES, moneyShort, normPhone, roleLabel, rolesOf } from '@/lib/crm-options'
import { dayLabel, isoToLondon, todayLondon } from '@/lib/time'
import { LogCallButton } from '../LogCallButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Contacts' }

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; todo?: string; archived?: string }> }) {
  const me = await requireAdmin()
  await ready()
  const sp = await searchParams
  const q = (sp.q ?? '').trim().slice(0, 80)
  const role = CALLER_TYPES.some((c) => c.value === sp.role) ? sp.role! : ''
  const where: SQL[] = [eq(contacts.archived, sp.archived === '1' && me.role === 'admin')]
  if (q) {
    const digits = normPhone(q)
    const t = `%${q.toLowerCase()}%`
    where.push(or(
      like(sql`lower(${contacts.name})`, t), like(contacts.emailNorm, t), like(sql`lower(coalesce(${contacts.address}, ''))`, t),
      like(sql`lower(coalesce(${contacts.areas}, ''))`, t),
      ...(digits.length >= 3 ? [like(contacts.phoneNorm, `%${digits}%`)] : []),
    )!)
  }
  if (role) where.push(like(contacts.roles, `%${role}%`))
  const openCount = sql<number>`(select count(*) from ${tasks} where ${tasks.contactId} = ${contacts.id} and ${tasks.doneAt} is null)`
  if (sp.todo === '1') where.push(sql`${openCount} > 0`)
  const rows = await db.select({ c: contacts, owner: admins.name, open: openCount }).from(contacts)
    .leftJoin(admins, eq(contacts.ownerId, admins.id))
    .where(and(...where)).orderBy(desc(contacts.lastContactAt)).limit(300)
  const today = todayLondon()
  const href = (p: Record<string, string>) => `/admin/contacts?${new URLSearchParams({ ...(q ? { q } : {}), ...(role ? { role } : {}), ...(sp.todo ? { todo: sp.todo } : {}), ...p })}`

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Contacts</h1>
          <p className="sub">Everyone who has called, walked in or enquired on the website. One record per person, matched by phone number or email.</p>
        </div>
        <div className="actions"><LogCallButton className="btn btn-gold" /></div>
      </div>

      <form className="filters" action="/admin/contacts">
        <div className="field"><label htmlFor="c-q">Search</label><input className="input" id="c-q" name="q" defaultValue={q} placeholder="Name, number, email, street or area" /></div>
        {role ? <input type="hidden" name="role" value={role} /> : null}
        <button className="btn btn-dark" type="submit">Search</button>
        <div className="seg" role="group" aria-label="Type">
          <Link className={!role ? 'on' : undefined} href={href({ role: '' })}>All</Link>
          {CALLER_TYPES.map((t) => <Link key={t.value} className={role === t.value ? 'on' : undefined} href={href({ role: t.value })}>{t.label}s</Link>)}
        </div>
        <Link className={`btn btn-sm ${sp.todo === '1' ? 'btn-dark' : 'btn-ghost'}`} href={href({ todo: sp.todo === '1' ? '' : '1' })}>With callbacks to do</Link>
        {me.role === 'admin' ? <Link className="btn btn-ghost btn-sm" href={href({ archived: sp.archived === '1' ? '' : '1' })}>{sp.archived === '1' ? 'Back to current' : 'Archived'}</Link> : null}
      </form>

      <section className="card">
        {rows.length === 0 ? (
          <div className="empty">{q || role ? 'Nobody matches that.' : 'No contacts yet. Log your first call with the button above, or press N.'}</div>
        ) : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Name</th><th>Type</th><th>Looking for / owns</th><th>Last contact</th><th>Looked after by</th><th></th></tr></thead>
              <tbody>
                {rows.map(({ c, owner, open }) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/admin/contacts/${c.id}`} style={{ textDecoration: 'none' }}>
                        <div className="addr-main">{c.name}</div>
                        <div className="addr-sub">{[c.phone, c.email].filter(Boolean).join(' · ')}</div>
                      </Link>
                    </td>
                    <td>{rolesOf(c.roles).map((r) => <span key={r} className="pill" style={{ marginRight: 4 }}>{roleLabel(r)}</span>)}</td>
                    <td className="addr-sub" style={{ maxWidth: 280 }}>
                      {c.address ? c.address : [c.minBeds != null ? (c.minBeds === 0 ? 'Studio' : `${c.minBeds}+ bed`) : '', c.areas, c.maxPrice ? `up to ${moneyShort(c.maxPrice)}` : ''].filter(Boolean).join(' · ')}
                    </td>
                    <td className="num addr-sub">{c.lastContactAt ? dayLabel(isoToLondon(c.lastContactAt).date, today) : ''}</td>
                    <td className="addr-sub">{owner ?? ''}</td>
                    <td style={{ textAlign: 'right' }}>{Number(open) > 0 ? <span className="pill gold">{open} to do</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
