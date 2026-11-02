import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { getAppointment } from '@/lib/appointments'
import { isoToLondon } from '@/lib/time'
import { BookingForm } from '../../BookingForm'
import { bookingData } from '../../booking-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Change appointment' }

export default async function EditAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin()
  const { id } = await params
  const a = await getAppointment(id)
  if (!a) notFound()
  if (a.status !== 'scheduled') redirect(`/admin/diary/${a.id}`)
  const data = await bookingData()
  // Keep the current person selectable even if their account was switched off since.
  if (!data.staff.some((s) => s.id === a.staffId)) data.staff.push({ id: a.staffId, name: a.staffName, role: 'negotiator' })
  const { date, time } = isoToLondon(a.startsAt)
  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumb"><Link href="/admin/diary">Diary</Link> / <Link href={`/admin/diary/${a.id}`}>Appointment</Link></p>
          <h1>Change appointment</h1>
          <p className="sub">Everyone is told what changed, by alert and email.</p>
        </div>
      </div>
      <BookingForm
        staff={data.staff} props={data.props} busy={data.busy} meId={me.id}
        defaults={{
          id: a.id, kind: a.kind, propertyId: a.propertyId ?? '', address: a.address ?? '', date, time,
          durationMin: a.durationMin, staffId: a.staffId, contactName: a.contactName ?? '', contactPhone: a.contactPhone ?? '',
          contactEmail: a.contactEmail ?? '', notes: a.notes ?? '', reminderMin: a.reminderMin,
        }}
      />
    </>
  )
}
