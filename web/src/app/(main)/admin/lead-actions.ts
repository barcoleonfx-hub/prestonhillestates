'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, leadEvents } from '@/db/schema'
import { requireAdmin, requireRole } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { isLeadStatus, toE164 } from '@/lib/lead-rules'
import { contactLeadEvent, leadEvent, setLeadOwner, setLeadStatus, withdrawConsent } from '@/lib/leads'
import { now, uid } from '@/lib/util'
import { isStop, waBlocked } from '@/lib/whatsapp'
import { erasePerson } from '@/lib/personal-data'
import { advance, completeStaffStep, completeWhatsAppStep, followupSettings, saveFollowupSettings, startFollowups, stepOf } from '@/lib/followups'
import { queueReconnects } from '@/lib/reconnect'
import { reconnects } from '@/db/schema'
import { followupLog } from '@/db/schema'

/** Staff move a lead along (or back) by hand. */
export async function updateLeadStatus(form: FormData) {
  const me = await requireAdmin()
  const id = String(form.get('id') ?? '')
  const status = String(form.get('status') ?? '')
  if (!id || !isLeadStatus(status)) return
  await setLeadStatus(id, status, me.id)
  revalidatePath(`/admin/enquiries/${id}`)
  revalidatePath('/admin/enquiries')
}

/** Who looks after a lead ('' for nobody). "Take it" sends the person's own id. */
export async function updateLeadOwner(form: FormData) {
  const me = await requireAdmin()
  const id = String(form.get('id') ?? '')
  const owner = String(form.get('owner') ?? '')
  if (!id) return
  await setLeadOwner(id, owner || null, me.id)
  revalidatePath(`/admin/enquiries/${id}`)
  revalidatePath('/admin/enquiries')
}

/** They asked us (by phone, in person) to stop emails or WhatsApp messages. */
export async function stopConsent(form: FormData) {
  const me = await requireAdmin()
  const contactId = String(form.get('contactId') ?? '')
  const channel = String(form.get('channel') ?? '')
  if (!contactId || (channel !== 'email' && channel !== 'whatsapp')) return
  await withdrawConsent(contactId, channel, `asked us (noted by ${me.name})`, me.id)
  await audit(me.id, `stopped ${channel} consent`, 'contact', contactId)
  revalidatePath(`/admin/contacts/${contactId}`)
}

/** Erase someone completely (their right to erasure). Admins only, and they must type DELETE to confirm. */
export async function erasePersonAction(form: FormData) {
  const me = await requireRole('admin')
  const contactId = String(form.get('contactId') ?? '')
  if (!contactId) return
  if (String(form.get('confirm') ?? '').trim().toUpperCase() !== 'DELETE') redirect(`/admin/contacts/${contactId}?erase=confirm#privacy`)
  const r = await erasePerson(contactId)
  // The audit log keeps only that it happened, not who it was.
  if (r.ok) await audit(me.id, 'erased personal data', 'contact', contactId, Object.entries(r.counts ?? {}).map(([k, v]) => `${k}: ${v}`).join(', '))
  revalidatePath('/admin/contacts')
  revalidatePath('/admin/enquiries')
  redirect('/admin/contacts?erased=1')
}

/**
 * A WhatsApp message staff have just opened to send (from their phone or WhatsApp on the computer): noted on the
 * lead's timeline, and it counts as contacting them. Refused if they've said STOP or asked not to be contacted, or
 * for a marketing message without their consent.
 */
export async function logWhatsApp(input: { enquiryId: string | null; contactId: string | null; label: string; text: string; marketing: boolean }): Promise<{ ok?: boolean; error?: string }> {
  const me = await requireAdmin()
  await ready()
  const text = String(input.text ?? '').trim().slice(0, 2000)
  if (!text) return { error: 'Write a message first.' }
  const e = input.enquiryId ? await db.query.enquiries.findFirst({ where: eq(enquiries.id, input.enquiryId) }) : null
  const contactId = input.contactId ?? e?.contactId ?? null
  const c = contactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) }) : null
  if (!e && !c) return { error: 'This lead no longer exists.' }
  const blocked = waBlocked({ e164: c?.phoneE164 ?? toE164(e?.phone ?? c?.phone), doNotContact: c?.doNotContact, stoppedAt: c?.whatsappStoppedAt })
  if (blocked) return { error: blocked }
  if (input.marketing && !c?.whatsappOptInAt) return { error: 'They haven’t agreed to WhatsApp messages about other homes.' }
  const at = now()
  await db.insert(leadEvents).values({ id: uid(), enquiryId: e?.id ?? null, contactId, kind: 'whatsapp', detail: `WhatsApp sent: ${String(input.label).slice(0, 60)}\n${text}`, createdBy: me.id, createdAt: at })
  if (e) await completeWhatsAppStep(e.id, me.id).catch((x) => console.error('follow-up step', x))
  if (e) await leadEvent(e.id, 'outbound', { by: me.id, at, detail: 'WhatsApp message' })
  else if (contactId) await contactLeadEvent(contactId, 'outbound', { by: me.id, at, detail: 'WhatsApp message' })
  if (contactId) await db.update(contacts).set({ lastContactAt: at }).where(eq(contacts.id, contactId))
  if (e) revalidatePath(`/admin/enquiries/${e.id}`)
  if (contactId) revalidatePath(`/admin/contacts/${contactId}`)
  return { ok: true }
}

/** They replied on WhatsApp (noted, and the lead becomes Engaged), or said STOP (no more WhatsApp to them). */
export async function logWhatsAppReply(input: { enquiryId: string | null; contactId: string | null; note: string; stop: boolean }): Promise<{ ok?: boolean; error?: string; stopped?: boolean }> {
  const me = await requireAdmin()
  await ready()
  const note = String(input.note ?? '').trim().slice(0, 2000)
  const e = input.enquiryId ? await db.query.enquiries.findFirst({ where: eq(enquiries.id, input.enquiryId) }) : null
  const contactId = input.contactId ?? e?.contactId ?? null
  if (!e && !contactId) return { error: 'This lead no longer exists.' }
  const stop = input.stop || isStop(note)
  const at = now()
  if (stop) {
    if (!contactId) return { error: 'There’s no contact record to mark.' }
    await withdrawConsent(contactId, 'whatsapp', `replied STOP on WhatsApp (noted by ${me.name})`, me.id)
    await audit(me.id, 'stopped whatsapp (STOP reply)', 'contact', contactId)
  } else {
    await db.insert(leadEvents).values({ id: uid(), enquiryId: e?.id ?? null, contactId, kind: 'whatsapp', detail: `They replied on WhatsApp${note ? `\n${note}` : ''}`, createdBy: me.id, createdAt: at })
    if (e) await leadEvent(e.id, 'inbound', { by: me.id, at, detail: 'replied on WhatsApp' })
    else if (contactId) await contactLeadEvent(contactId, 'inbound', { by: me.id, at, detail: 'replied on WhatsApp' })
    if (contactId) await db.update(contacts).set({ lastContactAt: at }).where(eq(contacts.id, contactId))
  }
  if (e) revalidatePath(`/admin/enquiries/${e.id}`)
  if (contactId) revalidatePath(`/admin/contacts/${contactId}`)
  return { ok: true, stopped: stop }
}

/** Switch automatic follow-ups on or off (admins). On: leads from now (or the last few days) are followed up. */
export async function setFollowupsOn(form: FormData) {
  const me = await requireRole('admin')
  const on = form.get('on') === '1'
  const back = Math.min(14, Math.max(0, Number(form.get('backDays') ?? 0) || 0))
  const cur = await followupSettings()
  await saveFollowupSettings({ on, since: on ? (cur.on && cur.since ? cur.since : new Date(Date.now() - back * 864e5).toISOString()) : cur.since, by: me.id, at: now() })
  await audit(me.id, on ? 'switched follow-ups on' : 'switched follow-ups off', 'settings', 'followups', on ? `from ${back ? `${back} days ago` : 'now'}` : undefined)
  revalidatePath('/admin/follow-ups')
}

/** Pause, carry on, stop or start one lead's follow-ups; or skip the WhatsApp that's due. */
export async function followupAction(form: FormData) {
  const me = await requireAdmin()
  await ready()
  const id = String(form.get('id') ?? '')
  const what = String(form.get('what') ?? '')
  const e = id ? await db.query.enquiries.findFirst({ where: eq(enquiries.id, id) }) : null
  if (!e) return
  if (what === 'pause' && e.followupState === 'active') await db.update(enquiries).set({ followupState: 'paused', followupNote: `Paused by ${me.name}` }).where(eq(enquiries.id, id))
  else if (what === 'resume' && e.followupState === 'paused') {
    const due = e.followupNextAt && e.followupNextAt > now() ? e.followupNextAt : new Date(Date.now() + 3600_000).toISOString()
    await db.update(enquiries).set({ followupState: 'active', followupNextAt: due, followupNote: null }).where(eq(enquiries.id, id))
  } else if (what === 'stop' && (e.followupState === 'active' || e.followupState === 'paused')) await db.update(enquiries).set({ followupState: 'stopped', followupNextAt: null, followupNote: `Stopped by ${me.name}` }).where(eq(enquiries.id, id))
  else if (what === 'start') await startFollowups(id)
  else if (what === 'skip' && e.followupState === 'active' && stepOf(e)) {
    const step = stepOf(e)!
    await db.insert(followupLog).values({ id: uid(), enquiryId: id, step: step.key, channel: step.channel, status: 'skipped', detail: `Skipped by ${me.name}`, createdBy: me.id, createdAt: now() })
    await advance(e)
  } else if (what === 'called' && e.followupState === 'active') {
    const answered = String(form.get('answered') ?? '') === 'yes'
    await completeStaffStep(id, me.id, 'call', `${answered ? 'Spoke to them' : 'No answer'} (${me.name})`)
    await leadEvent(id, 'outbound', { by: me.id, at: now(), detail: answered ? 'Phone call' : 'Phone call, no answer' }).catch(() => {})
  } else return
  revalidatePath(`/admin/enquiries/${id}`)
  revalidatePath('/admin/follow-ups')
}

/** Reconnect with the leads ticked on the Reconnect page: queued, and sent in the background. */
export async function queueReconnectAction(form: FormData) {
  const me = await requireAdmin()
  const ids = form.getAll('id').map(String).filter(Boolean)
  if (!ids.length) redirect('/admin/reconnect?msg=none')
  const r = await queueReconnects(ids, me.id)
  await audit(me.id, 'queued reconnect emails', 'enquiries', String(r.queued), `${r.queued} queued, ${r.skipped} skipped`)
  revalidatePath('/admin/reconnect')
  redirect(`/admin/reconnect?queued=${r.queued}&skipped=${r.skipped}`)
}

/** Take queued reconnect emails back out before they go. */
export async function cancelReconnects() {
  const me = await requireAdmin()
  await ready()
  const r = await db.update(reconnects).set({ status: 'skipped', detail: `Cancelled by ${me.name}`, sentAt: now() }).where(eq(reconnects.status, 'queued'))
  await audit(me.id, 'cancelled queued reconnect emails', 'enquiries', String(r.rowsAffected))
  revalidatePath('/admin/reconnect')
}
