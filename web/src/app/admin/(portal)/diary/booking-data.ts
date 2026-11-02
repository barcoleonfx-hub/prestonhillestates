import 'server-only'
import { desc, ne } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { properties } from '@/db/schema'
import { activeStaff, fullAddress, listBetween } from '@/lib/appointments'
import { displayAddressFor } from '@/lib/properties'
import { addDays, londonToIso, todayLondon } from '@/lib/time'
import type { Busy, PropertyOption, StaffOption } from './BookingForm'

/** Everything the booking form needs: staff, properties to pick from, and existing bookings for the busy markers. */
export async function bookingData(): Promise<{ staff: StaffOption[]; props: PropertyOption[]; busy: Busy[] }> {
  await ready()
  const today = todayLondon()
  const [staff, rows, appts] = await Promise.all([
    activeStaff(),
    db.select().from(properties).where(ne(properties.status, 'withdrawn')).orderBy(desc(properties.updatedAt)).limit(400),
    listBetween(londonToIso(addDays(today, -1), '00:00')!, londonToIso(addDays(today, 120), '00:00')!),
  ])
  return {
    staff: staff.map((s) => ({ id: s.id, name: s.name, role: s.role })),
    props: rows.map((p) => ({ id: p.id, ref: p.ref, label: displayAddressFor(p) || 'Untitled', address: fullAddress(p, null), channel: p.channel })),
    busy: appts.map((a) => ({ id: a.id, staffId: a.staffId, startsAt: a.startsAt, durationMin: a.durationMin, kind: a.kind, location: a.location })),
  }
}
