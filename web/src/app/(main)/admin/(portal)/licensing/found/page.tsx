import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { rentalRegister } from '@/lib/licensing'
import { fmtDay } from '@/lib/licensing-rules'
import { bestOf, scanState, suggestionsFor } from '@/lib/licensing-scan'
import { AutoList } from './AutoList'
import { SuggestionReview, type Group } from './SuggestionReview'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Found in emails' }

export default async function FoundPage() {
  await requireAdmin()
  const [{ rows }, list, st, auto] = await Promise.all([rentalRegister(), suggestionsFor(), scanState(), suggestionsFor(undefined, 'auto')])
  const best = bestOf(list)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const groups: Group[] = [...new Set(best.map((s) => s.rentalId))].map((id) => {
    const r = byId.get(id)!
    const l = r?.a.licence
    return {
      rentalId: id, address: r?.address ?? 'Unknown',
      current: { licence: l ? `${l.number ?? 'licence'}${l.expiresOn ? ` until ${fmtDay(l.expiresOn)}` : ''}` : null, gas: r?.gasExpires ? fmtDay(r.gasExpires) : null, eicr: r?.eicrExpires ? fmtDay(r.eicrExpires) : null, epc: r?.epcExpires ? `${fmtDay(r.epcExpires)}${r.epcRating ? ` (${r.epcRating})` : ''}` : null },
      items: best.filter((s) => s.rentalId === id).sort((a, b) => a.kind.localeCompare(b.kind)),
    }
  }).filter((g) => byId.has(g.rentalId)).sort((a, b) => a.address.localeCompare(b.address))
  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/licensing" style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← Licensing register</Link>
          <h1 style={{ marginTop: 6 }}>Found in our emails</h1>
          <p className="sub">Licence numbers and dates, and gas, EICR and EPC dates, read from council emails and certificates in the mailbox and matched to properties by address. Nothing is added until you say so. The clear ones that fill a gap are ticked for you; check the rest against the email.</p>
        </div>
      </div>
      <section className="card card-pad">
        <p className="card-sub" style={{ marginBottom: 12 }}>{groups.length} properties with details to check · {st.docs.toLocaleString('en-GB')} relevant emails read{st.finishedAt ? ` · scan finished ${fmtDay(st.finishedAt.slice(0, 10))}` : ''}. Labels: <b>Clear</b> = the date is written in the email; <b>Worked out</b> = from the inspection date (gas 1 year, EICR 5, EPC 10); <b>Rough guess</b> = from the date the email was sent.</p>
        <SuggestionReview groups={groups} />
      </section>
      <section className="card card-pad" id="auto" style={{ marginTop: 18 }}>
        <h2>Filled in automatically · {auto.length}</h2>
        <p className="card-sub" style={{ margin: '4px 0 12px' }}>Clear details that filled a gap by themselves. If one is wrong, undo it: the licence it added is removed, or the old date put back.</p>
        <AutoList items={auto.map((s) => ({ id: s.id, rentalId: s.rentalId, address: rows.find((r) => r.id === s.rentalId)?.address ?? '', kind: s.kind, found: s.found, source: s.doc.subject ?? '', when: s.doc.sentAt, pdf: s.doc.pdfs[0]?.id ?? null }))} />
      </section>
    </>
  )
}
