import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { RentalForm } from '../RentalForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Add a rented property' }

export default async function NewRental() {
  await requireAdmin()
  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/licensing" style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← Licensing register</Link>
          <h1 style={{ marginTop: 6 }}>Add a rented property</h1>
          <p className="sub">Add the address and postcode and the portal works out the council, the ward and whether it needs a licence. You can add the licence itself on the next page.</p>
        </div>
      </div>
      <section className="card card-pad"><RentalForm /></section>
    </>
  )
}
