import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { ImportRentals } from './ImportRentals'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Import a spreadsheet' }

export default async function ImportPage() {
  await requireAdmin()
  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/licensing" style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← Licensing register</Link>
          <h1 style={{ marginTop: 6 }}>Import a spreadsheet</h1>
          <p className="sub"><b>1. Rentman’s property list first:</b> every property with its exact address and postcode. <b>2. Then your licensing spreadsheet:</b> each row is matched to its Rentman property (even “369 Westcroft” or a misspelt street) and its licence details go onto it. You see every match before anything is saved.</p>
        </div>
      </div>
      <section className="card card-pad"><ImportRentals /></section>
    </>
  )
}
