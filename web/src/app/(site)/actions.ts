'use server'

import { and, eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { enquiries, properties } from '@/db/schema'
import { now, uid } from '@/lib/util'

export type EnquiryState = { ok?: boolean; error?: string }

const recent = new Map<string, number[]>()

export async function sendEnquiry(_prev: EnquiryState, form: FormData): Promise<EnquiryState> {
  // Bots fill every field; people never see this one.
  if (String(form.get('company') || '')) return { ok: true }

  const name = String(form.get('name') || '').trim().slice(0, 120)
  const phone = String(form.get('phone') || '').trim().slice(0, 40)
  const email = String(form.get('email') || '').trim().slice(0, 200)
  const message = String(form.get('message') || '').trim().slice(0, 2000)
  const propertyId = String(form.get('propertyId') || '')

  if (!name) return { error: 'Please tell us your name.' }
  if (!phone && !email) return { error: 'Add a phone number or email so we can reply.' }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email address doesn’t look right.' }

  // Simple flood protection: at most 5 enquiries per contact detail per hour.
  const key = (phone || email).toLowerCase()
  const times = (recent.get(key) || []).filter((t) => t > Date.now() - 3600_000)
  if (times.length >= 5) return { error: 'We’ve already received your requests. The branch will be in touch shortly.' }
  recent.set(key, [...times, Date.now()])

  await ready()
  const property = propertyId
    ? await db.query.properties.findFirst({ where: and(eq(properties.id, propertyId), eq(properties.published, true)) })
    : null

  await db.insert(enquiries).values({
    id: uid(), propertyId: property?.id ?? null, kind: 'viewing',
    name, phone: phone || null, email: email || null, message: message || null, createdAt: now(),
  })
  return { ok: true }
}
