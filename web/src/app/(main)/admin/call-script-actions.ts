'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, gte, isNull } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { calls, contacts, enquiries, tasks } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit, upsertContact } from '@/lib/contacts'
import { callNotes, isCallOutcome, outcomeLabel } from '@/lib/call-script-rules'
import { callScriptFor, closeCallSession, saveCallSession } from '@/lib/call-script'
import { parseMoney } from '@/lib/crm-options'
import { completeStaffStep } from '@/lib/followups'
import { leadEvent, syncPhoneE164 } from '@/lib/leads'
import { londonToIso } from '@/lib/time'
import { now, uid } from '@/lib/util'

type Progress = { answers: Record<string, string>; ticks: string[]; notes: string }

/** Saves the call as they go (answers, ticks, notes). */
export async function saveCallProgress(enquiryId: string, p: Progress): Promise<{ ok?: boolean; error?: string; at?: string }> {
  const me = await requireAdmin()
  await ready()
  if (!(await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId), columns: { id: true } }))) return { error: 'This lead no longer exists.' }
  await saveCallSession(enquiryId, me.id, p)
  return { ok: true, at: now() }
}

export type FinishInput = Progress & { outcome: string; date?: string; time?: string; reason?: string; sells?: boolean }
export type FinishResult = { ok?: boolean; error?: string; go?: string; said?: string }

/**
 * Finishes the call: it goes in the call log (so the agents know we've spoken and don't email over it), the
 * follow-up call step is ticked off, the lead's status moves on, and whatever comes next is set up: a call back,
 * a check-in, the diary to book the visit, or the lead closed.
 */
export async function finishCall(enquiryId: string, input: FinishInput): Promise<FinishResult> {
  const me = await requireAdmin()
  await ready()
  const outcome = input.outcome
  if (!isCallOutcome(outcome)) return { error: 'Choose how the call ended.' }
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, enquiryId) })
  if (!e) return { error: 'This lead no longer exists.' }
  let dueAt: string | null = null
  if (outcome === 'callback' || outcome === 'later') {
    dueAt = londonToIso(String(input.date ?? ''), String(input.time ?? '') || '10:30')
    if (!dueAt) return { error: outcome === 'callback' ? 'Pick when to call them back.' : 'Pick when to check in with them.' }
    if (dueAt < new Date(Date.now() - 5 * 60e3).toISOString()) return { error: 'That time has already gone: pick a later one.' }
  }
  const sessionId = await saveCallSession(enquiryId, me.id, input)
  const data = await callScriptFor(enquiryId, me)
  if (!data) return { error: 'This lead no longer exists.' }
  const { script, facts } = data
  const answered = outcome !== 'no-answer'
  const reason = String(input.reason ?? '').trim().slice(0, 300)
  const when = dueAt ? new Date(dueAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : ''
  const extra = outcome === 'callback' || outcome === 'later' ? when : outcome === 'lost' && reason ? reason : undefined
  const notes = callNotes(script, input.answers ?? {}, input.notes ?? '', outcome, extra)

  // The person: the lead's contact, made now if the enquiry never had one.
  const callerType = facts.kind === 'valuation' ? (facts.letting ? 'landlord' : 'seller') : facts.kind
  let contactId = e.contactId
  if (!contactId) {
    contactId = await upsertContact({ name: e.name, phone: e.phone, email: e.email, role: callerType, source: e.source, by: me.id })
    await db.update(enquiries).set({ contactId }).where(eq(enquiries.id, e.id))
  }
  const c = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) })

  // What they told us, kept on their record for matching (only what's clear).
  const a = input.answers ?? {}
  const patch: Partial<typeof contacts.$inferInsert> = { lastContactAt: now(), updatedAt: now() }
  if (facts.kind !== 'valuation' && a.budget) {
    // A figure with a £ or a k/m, or a plain number big enough to be money (not "3 bed").
    const figs = [...a.budget.matchAll(/(£)?\s?(\d[\d,.]*)\s?(k|m)?\b/gi)].map((m) => ({ pound: !!m[1] || !!m[3], n: parseMoney(`${m[2]}${m[3] ?? ''}`) }))
    const n = (figs.find((f) => f.pound && f.n) ?? figs.find((f) => (f.n ?? 0) >= 300))?.n ?? null
    if (n && n >= 300) patch.maxPrice = n
    const beds = /(\d)\s*(?:\+\s*)?bed/i.exec(a.budget)?.[1]
    if (beds) patch.minBeds = Number(beds)
  }
  const position = [a.money, a.sell ?? a.now].filter((x) => x?.trim()).join('; ').slice(0, 80)
  if (position) patch.position = position
  if (facts.kind === 'valuation' && facts.address && !c?.address) patch.address = facts.address
  if (outcome === 'dnc') patch.doNotContact = true
  await db.update(contacts).set(patch).where(eq(contacts.id, contactId))
  await syncPhoneE164(contactId).catch(() => {})

  const callId = uid()
  const next = outcome === 'booked' ? (facts.kind === 'valuation' ? 'valuation' : 'viewing') : outcome === 'callback' || outcome === 'later' ? 'callback' : 'none'
  await db.insert(calls).values({ id: callId, contactId, direction: 'out', callerType, propertyId: e.propertyId, notes, nextStep: next, createdBy: me.id, createdAt: now() })

  // The follow-up plan's call step (if one's due) is done; the status moves on (a conversation makes them Engaged).
  await completeStaffStep(e.id, me.id, 'call', `${answered ? 'Spoke to them' : 'No answer'}, with the call script (${me.name})`).catch((x) => console.error('follow-up step', x))
  await leadEvent(e.id, 'outbound', { by: me.id, detail: answered ? 'Phone call' : 'Phone call, no answer' }).catch(() => {})
  if (answered && outcome !== 'dnc') await leadEvent(e.id, 'inbound', { by: me.id, detail: 'spoke on the phone' }).catch(() => {})

  if (dueAt) {
    await db.insert(tasks).values({
      id: uid(), contactId, callId, kind: 'callback', title: `${outcome === 'later' ? 'Check in with' : 'Call back'} ${e.name}`, dueAt, assignedTo: me.id, notifiedAt: null, createdBy: me.id, createdAt: now(),
    })
  }
  const enqPatch: Partial<typeof enquiries.$inferInsert> = {}
  if (answered) enqPatch.handled = true
  if (outcome === 'later') Object.assign(enqPatch, { outcome: 'open', outcomeAt: now(), outcomeBy: me.id })
  if (outcome === 'lost' || outcome === 'dnc') Object.assign(enqPatch, { outcome: outcome === 'dnc' ? 'do_not_call' : 'not_interested', outcomeAt: now(), outcomeBy: me.id })
  if (Object.keys(enqPatch).length) await db.update(enquiries).set(enqPatch).where(eq(enquiries.id, e.id))
  if (outcome === 'lost' || outcome === 'dnc') await leadEvent(e.id, 'lost', { by: me.id, detail: outcome === 'dnc' ? 'asked not to be contacted' : `not interested${reason ? `: ${reason}` : ''}` }).catch(() => {})

  // A buyer or tenant with a home to sell: a valuation lead of its own.
  let said = ''
  if (input.sells && facts.kind !== 'valuation') {
    const since = new Date(Date.now() - 30 * 864e5).toISOString()
    const open = await db.select({ id: enquiries.id }).from(enquiries).where(and(eq(enquiries.contactId, contactId), eq(enquiries.kind, 'valuation'), gte(enquiries.createdAt, since), isNull(enquiries.outcome))).limit(1)
    if (open[0]) said = ' They already have a valuation lead.'
    else {
      const id = uid()
      const message = ['Phone call (logged by staff)', `Has a home to sell, found on a call about ${facts.property ?? 'one of our homes'}.`, a.sell?.trim() ? `What they said: ${a.sell.trim()}` : ''].filter(Boolean).join('\n')
      await db.insert(enquiries).values({ id, propertyId: null, kind: 'valuation', intent: 'selling', name: e.name, phone: e.phone, email: e.email, message, contactId, source: 'phone', handled: false, ownerId: me.id, createdAt: now() })
      // We've spoken to them: Engaged (so no automatic "thanks for your request" email).
      await leadEvent(id, 'inbound', { by: me.id, detail: 'phone call' }).catch(() => {})
      said = ' Their home to sell is now a valuation lead.'
    }
  }

  await closeCallSession(sessionId, outcome, extra ?? null, callId)
  await audit(me.id, 'call_script', 'contact', contactId, `${outcome}${extra ? ` (${extra})` : ''}`)
  revalidatePath(`/admin/enquiries/${e.id}`)
  revalidatePath('/admin/follow-ups')
  revalidatePath('/admin/my-day')

  const slot = facts.slots[0]
  const go = outcome === 'booked'
    ? `/admin/diary/new?${new URLSearchParams({ enquiry: e.id, ...(facts.kind === 'valuation' ? { kind: 'valuation' } : {}), ...(input.date && input.time ? { date: input.date, time: input.time } : slot ? { date: slot.date, time: slot.time } : {}) })}`
    : undefined
  return { ok: true, go, said: `Saved: ${outcomeLabel(outcome).toLowerCase()}${when ? `, ${when}` : ''}.${said}` }
}
