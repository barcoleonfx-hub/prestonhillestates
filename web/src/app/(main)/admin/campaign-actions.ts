'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { campaigns } from '@/db/schema'
import { requireAdmin, requireRole } from '@/lib/auth'
import { TEMPLATES, renderCampaign, type Audience, type Content, type Reader } from '@/lib/campaign'
import { audienceList, recipientList, audienceSummary, campaignLimits, campaignProgress, campaignShared, monthLabel, parseContent, queueCampaign, readerFor, setCampaignLimits } from '@/lib/campaign-data'
import { audit } from '@/lib/contacts'
import { bulkSender, mailboxStatus } from '@/lib/mailbox'
import { siteBase } from '@/lib/property-email-data'
import { now, uid } from '@/lib/util'

const clean = (a: Audience): Audience => ({
  roles: a.roles.filter((r) => ['buyer', 'tenant', 'landlord', 'seller', 'other'].includes(r)),
  areas: String(a.areas ?? '').slice(0, 200), activeMonths: a.activeMonths ? Math.max(1, Math.min(120, Math.round(a.activeMonths))) : null,
  exclude: [...new Set((a.exclude ?? []).map(String))].slice(0, 20_000),
})

export async function createCampaign(form: FormData) {
  const me = await requireAdmin()
  await ready()
  const t = TEMPLATES.find((x) => x.key === String(form.get('template'))) ?? TEMPLATES[0]
  const id = uid()
  await db.insert(campaigns).values({
    id, name: `${t.name} · ${monthLabel()}`, template: t.key, audience: JSON.stringify(t.audience), content: JSON.stringify(t.content(me.name)),
    status: 'draft', createdBy: me.id, createdAt: now(), updatedAt: now(),
  })
  redirect(`/admin/campaigns/${id}`)
}

export async function duplicateCampaign(form: FormData) {
  const me = await requireAdmin()
  await ready()
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, String(form.get('id'))) })
  if (!c) redirect('/admin/campaigns')
  const id = uid()
  const { base: _b, ...content } = parseContent(c) as Content & { base?: string }
  await db.insert(campaigns).values({ id, name: `${c.name} (copy)`, template: c.template, audience: c.audience, content: JSON.stringify(content), status: 'draft', createdBy: me.id, createdAt: now(), updatedAt: now() })
  redirect(`/admin/campaigns/${id}`)
}

export async function deleteCampaign(form: FormData) {
  await requireAdmin()
  await ready()
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, String(form.get('id'))) })
  if (c && c.status !== 'sending') await db.delete(campaigns).where(eq(campaigns.id, c.id))
  redirect('/admin/campaigns')
}

export async function saveCampaign(id: string, name: string, audience: Audience, content: Content): Promise<{ ok?: boolean; error?: string; savedAt?: string }> {
  await requireAdmin()
  await ready()
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) })
  if (!c) return { error: 'This campaign no longer exists.' }
  if (c.status !== 'draft') return { error: 'It has already started sending, so it can’t be changed. Duplicate it to make a new version.' }
  const body = JSON.stringify({ ...content, blocks: content.blocks.slice(0, 30) })
  if (body.length > 200_000) return { error: 'That’s too long for one email. Take something out.' }
  await db.update(campaigns).set({ name: name.trim().slice(0, 120) || c.name, audience: JSON.stringify(clean(audience)), content: body, updatedAt: now() }).where(eq(campaigns.id, id))
  return { ok: true, savedAt: now() }
}

export async function countAudience(audience: Audience) {
  await requireAdmin()
  const s = await audienceSummary(clean(audience))
  return { total: s.total, byRole: s.byRole }
}

/** Sends the email, as one reader would get it, to the member of staff. */
export async function testCampaign(id: string, content: Content, reader: Reader | null): Promise<{ ok?: boolean; error?: string; to?: string }> {
  const me = await requireAdmin()
  await ready()
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) })
  if (!c) return { error: 'This campaign no longer exists.' }
  const base = await siteBase()
  const tx = await bulkSender()
  if ('error' in tx) return { error: tx.error }
  try {
    const r: Reader = reader ?? { contactId: null, name: me.name, email: me.email, roles: ['other'], outward: null, areas: null, budget: null, minBeds: null, position: null, unsubscribeUrl: `${base}/unsubscribe` }
    const m = renderCampaign(content, { ...r, unsubscribeUrl: `${base}/unsubscribe` }, await campaignShared(base), { campaign: c.name, sender: { email: tx.user }, month: monthLabel() })
    const res = await tx.send({ to: me.email, subject: `[Test${reader ? ` as ${reader.name}` : ''}] ${m.subject}`, text: m.text, html: m.html })
    return res.ok ? { ok: true, to: me.email } : { error: res.error }
  } finally { tx.close() }
}

export async function startCampaign(id: string): Promise<{ ok?: boolean; error?: string; total?: number }> {
  const me = await requireRole('admin')
  await ready()
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) })
  if (!c) return { error: 'This campaign no longer exists.' }
  if (c.status !== 'draft') return { error: 'It has already been started.' }
  const content = parseContent(c)
  if (!content.subject.trim()) return { error: 'Add a subject line first.' }
  const box = await mailboxStatus()
  if (!box?.hasPassword) return { error: 'Connect the office mailbox in Email settings first. Campaigns are sent from it.' }
  const total = await queueCampaign(c, me.id, await siteBase())
  if (!total) {
    await db.update(campaigns).set({ status: 'draft' }).where(eq(campaigns.id, id))
    return { error: 'Nobody in this audience can be emailed.' }
  }
  await audit(me.id, 'campaign_start', 'campaign', id, `${total} people`)
  revalidatePath('/admin/campaigns', 'layout')
  return { ok: true, total }
}

export async function setCampaignStatus(id: string, to: 'paused' | 'sending' | 'cancelled') {
  const me = await requireRole('admin')
  await ready()
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) })
  if (!c) return
  const allowed = (c.status === 'sending' && (to === 'paused' || to === 'cancelled')) || (c.status === 'paused' && (to === 'sending' || to === 'cancelled'))
  if (!allowed) return
  await db.update(campaigns).set({ status: to, lastError: null, updatedAt: now(), ...(to === 'cancelled' ? { finishedAt: now() } : {}) }).where(eq(campaigns.id, id))
  await audit(me.id, `campaign_${to}`, 'campaign', id)
  revalidatePath('/admin/campaigns', 'layout')
}

export async function progressOf(id: string) {
  await requireAdmin()
  await ready()
  return campaignProgress(id)
}

export async function saveLimits(form: FormData) {
  await requireRole('admin')
  await ready()
  await setCampaignLimits({ perDay: Number(form.get('perDay')) || (await campaignLimits()).perDay })
  revalidatePath('/admin/campaigns')
}

export async function previewReader(contactId: string): Promise<Reader | null> {
  await requireAdmin()
  await ready()
  const c = await db.query.contacts.findFirst({ where: (t, { eq: e }) => e(t.id, contactId) })
  return c ? readerFor(c, await siteBase()) : null
}

/** A page of the people a draft would go to, for checking and taking people off. */
export async function listPeople(audience: Audience, q: string, page: number) {
  await requireAdmin()
  return audienceList(clean(audience), q.slice(0, 100), Math.max(0, Math.floor(page)))
}

/** A page of who a started campaign is going to, with each send's status. */
export async function listRecipients(id: string, status: string, q: string, page: number) {
  await requireAdmin()
  await ready()
  return recipientList(id, ['queued', 'sent', 'failed', 'skipped'].includes(status) ? status : '', q.slice(0, 100), Math.max(0, Math.floor(page)))
}
