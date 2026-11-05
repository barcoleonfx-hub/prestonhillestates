import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { ImportRentals } from './ImportRentals'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Import licensing spreadsheet' }

export default async function ImportPage() {
  await requireAdmin()
  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/licensing" style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← Licensing register</Link>
          <h1 style={{ marginTop: 6 }}>Import your licensing spreadsheet</h1>
          <p className="sub">Bring in the list you check by hand today. You’ll see every row before anything is saved, and properties already in the register are skipped.</p>
        </div>
      </div>
      <section className="card card-pad"><ImportRentals /></section>
    </>
  )
}
