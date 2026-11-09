import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { bookletInput } from '@/lib/booklet-data'
import { BookletEditor } from './BookletEditor'
import './booklet.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Valuation booklet' }

/**
 * The valuation booklet for an enquiry (or, with "a-" and an appointment's id, a valuation booked straight into the
 * diary): filled in, editable, and printable on A4. Outside the portal's frame so it prints cleanly.
 */
export default async function BookletPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin()
  const { id } = await params
  const data = await bookletInput(id, me)
  if (!data) notFound()
  const back = data.enquiryId
    ? { href: `/admin/enquiries/${data.enquiryId}`, label: 'Back to the enquiry' }
    : { href: `/admin/diary/${id.replace(/^a-/, '')}`, label: 'Back to the appointment' }
  return <BookletEditor key={`${data.id}|${data.defaults.kind}|${data.saved.kind ?? ''}`} data={data} back={back} />
}
