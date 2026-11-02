import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { displayAddressFor, getProperty, slugFor } from '@/lib/properties'
import { deleteProperty } from '../../../actions'
import { PropertyEditor } from './PropertyEditor'
import { DeleteButton } from './DeleteButton'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Edit property' }

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const p = await getProperty(id)
  if (!p) notFound()
  const address = displayAddressFor(p)

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/admin/properties" style={{ fontSize: '0.84rem', color: 'var(--faint)', textDecoration: 'none' }}>← All properties</Link>
          <h1 style={{ marginTop: 6 }}>{address || 'New property'}</h1>
          <p className="sub">
            {p.ref} · {p.channel === 'let' ? 'To let' : 'For sale'} · Last saved{' '}
            {new Date(p.updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            {p.updatedBy ? ` by ${p.updatedBy}` : ''}
          </p>
        </div>
        <div className="actions">
          {p.published ? (
            <a className="btn btn-ghost" href={`/properties/${slugFor(p)}`} target="_blank" rel="noreferrer">View on website</a>
          ) : null}
          <form action={deleteProperty}>
            <input type="hidden" name="id" value={p.id} />
            <DeleteButton />
          </form>
        </div>
      </div>
      <PropertyEditor property={p} />
    </>
  )
}
