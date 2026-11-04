import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { AREAS } from '@/lib/mail-areas'
import { threadList } from '@/lib/mail-dashboard'
import { MailRow } from '../MailRow'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'All conversations' }

export default async function AllMail({ searchParams }: { searchParams: Promise<{ area?: string; status?: string; q?: string }> }) {
  await requireAdmin()
  const sp = await searchParams
  const area = AREAS.some((a) => a.id === sp.area) ? sp.area! : ''
  const status = ['pending', 'dealt', 'info'].includes(sp.status ?? '') ? sp.status! : ''
  const q = (sp.q ?? '').trim().slice(0, 80)
  const rows = await threadList({ area, status, q, limit: 300 })
  const href = (p: Record<string, string>) => `/admin/mail/all?${new URLSearchParams(Object.entries({ ...(area ? { area } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}), ...p }).filter(([, v]) => v))}`
  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/mail" style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← Inbox</Link>
          <h1 style={{ marginTop: 6 }}>All conversations</h1>
          <p className="sub">{rows.length}{rows.length === 300 ? '+' : ''} conversation{rows.length === 1 ? '' : 's'}, newest first. Newsletters aren’t included.</p>
        </div>
      </div>
      <form className="filters" action="/admin/mail/all">
        <div className="field"><label htmlFor="ml-q">Search</label><input className="input" id="ml-q" name="q" defaultValue={q} placeholder="Subject, name or email address" /></div>
        {area ? <input type="hidden" name="area" value={area} /> : null}
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <button className="btn btn-dark" type="submit">Search</button>
        <div className="seg" role="group" aria-label="Area">
          <Link className={!area ? 'on' : undefined} href={href({ area: '' })}>All</Link>
          {AREAS.map((a) => <Link key={a.id} className={area === a.id ? 'on' : undefined} href={href({ area: a.id })}>{a.label}</Link>)}
        </div>
        <div className="seg" role="group" aria-label="Status">
          <Link className={!status ? 'on' : undefined} href={href({ status: '' })}>Any</Link>
          <Link className={status === 'pending' ? 'on' : undefined} href={href({ status: 'pending' })}>Waiting for us</Link>
          <Link className={status === 'dealt' ? 'on' : undefined} href={href({ status: 'dealt' })}>Dealt with</Link>
          <Link className={status === 'info' ? 'on' : undefined} href={href({ status: 'info' })}>For info</Link>
        </div>
      </form>
      <section className="card card-pad">
        {rows.length ? <div className="ib-list">{rows.map((t) => <MailRow key={t.id} t={t} wait />)}</div> : <p className="card-sub">Nothing matches.</p>}
      </section>
    </>
  )
}
