import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { todayLondon } from '@/lib/time'
import { BookingForm, type BookingDefaults } from '../BookingForm'
import { bookingData } from '../booking-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Book an appointment' }

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireAdmin()
  await ready()
  const sp = await searchParams
  const data = await bookingData()
  const enquiry = sp.enquiry ? await db.query.enquiries.findFirst({ where: eq(enquiries.id, sp.enquiry) }) : undefined

  const propertyId = sp.property && data.props.some((p) => p.id === sp.property) ? sp.property : enquiry?.propertyId && data.props.some((p) => p.id === enquiry.propertyId) ? enquiry.propertyId : ''
  const kind = enquiry?.kind === 'valuation' ? 'valuation' : sp.kind === 'valuation' || sp.kind === 'other' ? sp.kind : 'viewing'
  const defaults: BookingDefaults = {
    kind,
    propertyId,
    address: enquiry?.kind === 'valuation' && enquiry.postcode ? enquiry.postcode : '',
    date: sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayLondon(),
    time: sp.time && /^\d{2}:\d{2}$/.test(sp.time) ? sp.time : '',
    durationMin: kind === 'valuation' ? 60 : 30,
    staffId: data.staff.some((s) => s.id === me.id) ? me.id : '',
    contactName: enquiry?.name ?? '',
    contactPhone: enquiry?.phone ?? '',
    contactEmail: enquiry?.email ?? '',
    notes: enquiry?.message ?? '',
    reminderMin: 30,
    enquiryId: enquiry?.id,
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumb"><Link href="/admin/diary">Diary</Link></p>
          <h1>Book an appointment</h1>
          <p className="sub">{enquiry ? `From ${enquiry.name}’s website ${enquiry.kind === 'valuation' ? 'valuation request' : 'enquiry'}. ` : ''}Everyone gets an alert and an email as soon as it’s booked.</p>
        </div>
      </div>
      <BookingForm staff={data.staff} props={data.props} busy={data.busy} defaults={defaults} meId={me.id} />
    </>
  )
}
