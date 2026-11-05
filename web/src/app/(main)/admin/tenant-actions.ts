'use server'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { settings, tenantAlerts } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { now } from '@/lib/util'

/** Turns the automatic "new homes to rent" emails on or off for everyone. */
export async function setTenantAlerts(f: FormData) {
  const me = await requireAdmin()
  await ready()
  const value = String(f.get('on')) === '1' ? 'on' : 'off'
  await db.insert(settings).values({ key: 'tenant_alerts', value, updatedAt: now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now() } })
  await audit(me.id, 'tenant_alerts', 'settings', 'tenant_alerts', value)
  revalidatePath('/admin/tenants')
}

/** Stops (or restarts) one tenant's emails, e.g. once they've found a home. */
export async function setTenantActive(f: FormData) {
  const me = await requireAdmin()
  await ready()
  const id = String(f.get('contactId') || '')
  const active = String(f.get('active')) === '1'
  await db.update(tenantAlerts).set({ active, updatedAt: now() }).where(eq(tenantAlerts.contactId, id))
  await audit(me.id, active ? 'tenant_alert_on' : 'tenant_alert_off', 'contact', id, '')
  revalidatePath('/admin/tenants')
}
