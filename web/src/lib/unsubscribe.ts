import 'server-only'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts } from '@/db/schema'
import { now } from './util'
import { checkUnsubscribe } from './property-email-data'

/** Stops property emails to one person. Calls and replies to their own emails carry on as normal. */
export async function optOut(contactId: string, token: string): Promise<boolean> {
  if (!contactId || !token || !checkUnsubscribe(contactId, token)) return false
  await ready()
  await db.update(contacts).set({ marketingOptOut: true, updatedAt: now() }).where(eq(contacts.id, contactId))
  return true
}
