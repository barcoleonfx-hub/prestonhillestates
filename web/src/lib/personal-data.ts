import 'server-only'
// Someone's right to see and to erase what we hold about them (UK GDPR articles 15 and 17): everything about a
// person in one JSON file, and erasing it.

import { eq, inArray, or } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import {
  appointments, bookletShares, booklets, calls, campaignRecipients, consents, contacts, enquiries, enquiryMessages, enquiryNotes,
  leadEvents, mailMessages, mailThreads, propertyEmails, tasks, tenantAlerts,
} from '@/db/schema'

async function gather(contactId: string) {
  await ready()
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) })
  if (!contact) return null
  const enq = await db.select().from(enquiries).where(eq(enquiries.contactId, contactId))
  const enqIds = enq.map((e) => e.id)
  const threads = await db.select().from(mailThreads).where(eq(mailThreads.contactId, contactId))
  const threadIds = threads.map((t) => t.id)
  const none = ['-']
  return {
    contact, enquiries: enq, enqIds, threads, threadIds,
    messages: await db.select().from(enquiryMessages).where(inArray(enquiryMessages.enquiryId, enqIds.length ? enqIds : none)),
    notes: await db.select().from(enquiryNotes).where(inArray(enquiryNotes.enquiryId, enqIds.length ? enqIds : none)),
    appointments: await db.select().from(appointments).where(or(eq(appointments.contactId, contactId), inArray(appointments.enquiryId, enqIds.length ? enqIds : none))),
    calls: await db.select().from(calls).where(eq(calls.contactId, contactId)),
    tasks: await db.select().from(tasks).where(eq(tasks.contactId, contactId)),
    tenantAlert: (await db.select().from(tenantAlerts).where(eq(tenantAlerts.contactId, contactId)))[0] ?? null,
    propertyEmails: await db.select().from(propertyEmails).where(eq(propertyEmails.contactId, contactId)),
    campaignEmails: await db.select().from(campaignRecipients).where(eq(campaignRecipients.contactId, contactId)),
    mailMessages: await db.select().from(mailMessages).where(inArray(mailMessages.threadId, threadIds.length ? threadIds : none)),
    consents: await db.select().from(consents).where(eq(consents.contactId, contactId)),
    leadEvents: await db.select().from(leadEvents).where(or(eq(leadEvents.contactId, contactId), inArray(leadEvents.enquiryId, enqIds.length ? enqIds : none))),
  }
}

/** Everything we hold about a person, ready to give them as a file. */
export async function exportPerson(contactId: string) {
  const g = await gather(contactId)
  if (!g) return null
  return {
    about: 'Personal data held by Preston Hill Estates (Company No. 05058532), 271 Preston Road, Harrow HA3 0PS.',
    exportedAt: new Date().toISOString(),
    person: g.contact,
    enquiries: g.enquiries.map((e) => ({ ...e, emails: g.messages.filter((m) => m.enquiryId === e.id), notes: g.notes.filter((n) => n.enquiryId === e.id) })),
    appointments: g.appointments,
    calls: g.calls,
    followUps: g.tasks,
    tenantAlerts: g.tenantAlert,
    propertyEmailsSent: g.propertyEmails,
    campaignEmailsSent: g.campaignEmails,
    emailConversations: g.threads.map((t) => ({ ...t, messages: g.mailMessages.filter((m) => m.threadId === t.id) })),
    consents: g.consents,
    timeline: g.leadEvents,
  }
}

/**
 * Erases a person: their record, enquiries, emails, notes, calls, follow-ups, alerts and consent history. Diary
 * appointments stay (they're the staff's diary) but lose the name, phone, email and notes. Returns how much went.
 */
export async function erasePerson(contactId: string): Promise<{ ok: boolean; counts?: Record<string, number> }> {
  const g = await gather(contactId)
  if (!g) return { ok: false }
  const ids = g.enqIds.length ? g.enqIds : ['-']
  const threadIds = g.threadIds.length ? g.threadIds : ['-']
  await db.delete(enquiryMessages).where(inArray(enquiryMessages.enquiryId, ids))
  await db.delete(enquiryNotes).where(inArray(enquiryNotes.enquiryId, ids))
  await db.delete(bookletShares).where(inArray(bookletShares.bookletId, ids))
  await db.delete(booklets).where(inArray(booklets.id, ids))
  await db.update(appointments).set({ contactName: 'Deleted person', contactPhone: null, contactEmail: null, notes: null, outcomeNotes: null, contactId: null, enquiryId: null })
    .where(or(eq(appointments.contactId, contactId), inArray(appointments.enquiryId, ids)))
  await db.delete(leadEvents).where(or(eq(leadEvents.contactId, contactId), inArray(leadEvents.enquiryId, ids)))
  await db.delete(consents).where(eq(consents.contactId, contactId))
  await db.delete(enquiries).where(inArray(enquiries.id, ids))
  await db.delete(tasks).where(eq(tasks.contactId, contactId))
  await db.delete(calls).where(eq(calls.contactId, contactId))
  await db.delete(tenantAlerts).where(eq(tenantAlerts.contactId, contactId))
  await db.delete(propertyEmails).where(eq(propertyEmails.contactId, contactId))
  await db.delete(campaignRecipients).where(eq(campaignRecipients.contactId, contactId))
  await db.delete(mailMessages).where(inArray(mailMessages.threadId, threadIds))
  await db.delete(mailThreads).where(inArray(mailThreads.id, threadIds))
  await db.delete(contacts).where(eq(contacts.id, contactId))
  return {
    ok: true,
    counts: { enquiries: g.enquiries.length, emails: g.messages.length + g.mailMessages.length, notes: g.notes.length, calls: g.calls.length, appointmentsAnonymised: g.appointments.length },
  }
}
