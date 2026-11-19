import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { batchView } from '@/lib/postal-letters'
import { LogoMark } from '@/components/Logo'
import { markPostedAction } from '../../postal-actions'
import { PrintButton } from './PrintButton'
import './letters.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Valuation letters to print' }

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })

/** A batch of valuation letters, one A4 page each: outside the portal's frame so it prints cleanly. */
export default async function LettersPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ posted?: string }> }) {
  await requireAdmin()
  const { id } = await params
  const sp = await searchParams
  const b = await batchView(id)
  if (!b) notFound()
  const date = today()
  return (
    <div className="pl-page">
      <div className="pl-bar">
        <Link href="/admin/valuation-letters">← Valuation letters</Link>
        <span><b>{b.letters.length} letter{b.letters.length === 1 ? '' : 's'}</b> · signed by {b.sender}{b.postedAt ? ' · posted' : ''}</span>
        <PrintButton />
        {b.postedAt
          ? <span className="pl-done">{sp.posted ? `Noted on ${sp.posted} lead${sp.posted === '1' ? '' : 's'}.` : 'Marked as posted.'}</span>
          : <form action={markPostedAction}><input type="hidden" name="batch" value={b.id} /><button className="pl-btn ghost" type="submit">They’re in the post</button></form>}
        <p>Print on plain A4 with “Background graphics” on and margins set to none. Fold in three, address side out, into a DL window envelope.</p>
      </div>
      {b.letters.map((l) => (
        <article key={l.id} className="pl-letter">
          <header className="pl-head">
            <div className="pl-brand"><LogoMark /><span><b>PRESTON HILL</b><i>ESTATES</i></span></div>
            <div className="pl-office">271 Preston Road, Harrow HA3 0PS<br />020 8904 9005 · WhatsApp 07745 203146<br />info@prestonhillestates.com · prestonhillestates.com</div>
          </header>
          <div className="pl-return">Preston Hill Estates, 271 Preston Road, Harrow HA3 0PS</div>
          <address className="pl-to">{[l.name, ...l.lines].map((x, i) => <span key={i}>{x}</span>)}</address>
          <div className="pl-date">{date}</div>
          <div className="pl-body">
            <p>Dear {l.first || 'Sir or Madam'},</p>
            <h2>Your free property report for {l.home ?? 'your home'}</h2>
            {l.before.map((p, i) => <p key={`b${i}`}>{p}</p>)}
            <div className="pl-qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.qr} alt="" />
              <div><b>Scan with your phone camera</b><span>to open your personal property report</span><small>or type: {l.reportShort}</small></div>
            </div>
            {l.after.map((p, i) => <p key={`a${i}`}>{p}</p>)}
            <p className="pl-sign">Yours sincerely,</p>
            <p className="pl-name"><b>{b.sender}</b><br />Preston Hill Estates</p>
          </div>
          <footer className="pl-foot">Preston Hill Estates · 271 Preston Road, Harrow HA3 0PS · 020 8904 9005. You’re receiving this because you asked us about a valuation. If you’d rather we didn’t write again, just let us know.</footer>
        </article>
      ))}
    </div>
  )
}
