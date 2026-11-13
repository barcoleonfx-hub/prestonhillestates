'use server'

import { Readable } from 'node:stream'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import sharp, { type OutputInfo } from 'sharp'
import { db, ready } from '@/db/client'
import { emailImages, tailoredEmails } from '@/db/schema'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { bulkSender, mailboxStatus, sendFromMailbox } from '@/lib/mailbox'
import { siteBase } from '@/lib/property-email-data'
import { MAX_RECIPIENTS, TAILORED_TEMPLATES, gapsIn, normalise, parseRecipients, renderTailored, type EmailImage, type TailoredContent } from '@/lib/tailored-email'
import { isLocalStorage, writeLocal } from '@/lib/storage'
import { now, uid } from '@/lib/util'

export async function createTailored(form: FormData) {
  const me = await requireAdmin()
  await ready()
  const t = TAILORED_TEMPLATES.find((x) => x.key === String(form.get('template'))) ?? TAILORED_TEMPLATES[TAILORED_TEMPLATES.length - 1]
  const id = uid()
  await db.insert(tailoredEmails).values({ id, name: t.key === 'blank' ? 'New email' : t.name, template: t.key, recipients: '', content: JSON.stringify(t.content(me.name)), status: 'draft', createdBy: me.id, createdAt: now(), updatedAt: now() })
  redirect(`/admin/campaigns/tailored/${id}`)
}

export async function duplicateTailored(form: FormData) {
  const me = await requireAdmin()
  await ready()
  const src = await db.query.tailoredEmails.findFirst({ where: eq(tailoredEmails.id, String(form.get('id'))) })
  if (!src) redirect('/admin/campaigns')
  const id = uid()
  await db.insert(tailoredEmails).values({ id, name: `${src.name} (copy)`.slice(0, 120), template: src.template, recipients: '', content: src.content, status: 'draft', createdBy: me.id, createdAt: now(), updatedAt: now() })
  redirect(`/admin/campaigns/tailored/${id}`)
}

export async function deleteTailored(form: FormData) {
  await requireAdmin()
  await ready()
  await db.delete(tailoredEmails).where(eq(tailoredEmails.id, String(form.get('id'))))
  revalidatePath('/admin/campaigns')
  redirect('/admin/campaigns')
}

export async function saveTailored(id: string, name: string, recipients: string, content: TailoredContent): Promise<{ ok?: boolean; error?: string }> {
  await requireAdmin()
  await ready()
  const row = await db.query.tailoredEmails.findFirst({ where: eq(tailoredEmails.id, id) })
  if (!row) return { error: 'This email no longer exists.' }
  if (row.status === 'sent') return { error: 'This email has been sent. Use “Use again” to send it to someone else.' }
  await db.update(tailoredEmails).set({ name: name.trim().slice(0, 120) || 'Untitled email', recipients: recipients.slice(0, 5000), content: JSON.stringify(content), updatedAt: now() }).where(eq(tailoredEmails.id, id))
  return { ok: true }
}

/**
 * A picture for an email: made a sensible size (1200 px wide at most, a few hundred KB) and stored on our disk,
 * then served publicly at /email-img/<id>.jpg so it shows in people's inboxes.
 */
export async function uploadEmailImage(form: FormData): Promise<{ ok: true; image: EmailImage } | { ok: false; error: string }> {
  const me = await requireAdmin()
  await ready()
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) return { ok: false, error: 'Choose a picture first.' }
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: 'That picture is over 15 MB. Try a smaller one.' }
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) return { ok: false, error: 'Use a JPG, PNG or WebP picture.' }
  if (!isLocalStorage()) return { ok: false, error: 'Pictures can only be stored when uploads are kept on the server’s disk.' }
  let out: { data: Buffer; info: OutputInfo }
  try {
    const input = Buffer.from(await file.arrayBuffer())
    const img = sharp(input, { failOn: 'none' }).rotate().resize({ width: 1200, withoutEnlargement: true })
    // Logos and graphics with see-through parts stay PNG; photos become JPEG.
    const meta = await sharp(input).metadata()
    out = meta.hasAlpha && file.type === 'image/png'
      ? await img.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await img.flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true })
  } catch {
    return { ok: false, error: 'That file couldn’t be read as a picture.' }
  }
  const id = uid()
  const ext = out.info.format === 'png' ? 'png' : 'jpg'
  const key = `email-images/${id}.${ext}`
  await writeLocal(key, Readable.toWeb(Readable.from(out.data)) as ReadableStream<Uint8Array>, 20 * 1024 * 1024)
  await db.insert(emailImages).values({ id, storageKey: key, contentType: ext === 'png' ? 'image/png' : 'image/jpeg', width: out.info.width, height: out.info.height, sizeBytes: out.data.length, originalName: file.name.slice(0, 200), createdBy: me.id, createdAt: now() })
  const base = await siteBase()
  return { ok: true, image: { id, url: `${base}/email-img/${id}.${ext}`, alt: '' } }
}

/** Sends the email to the person signed in, as it will look (marked as a test, and not filed anywhere). */
export async function testTailored(content: TailoredContent): Promise<{ ok?: boolean; error?: string; to?: string }> {
  const me = await requireAdmin()
  const tx = await bulkSender()
  if ('error' in tx) return { error: tx.error }
  try {
    const base = await siteBase()
    const m = renderTailored(normalise(content, me.name), { email: me.email, name: '' }, { base, senderEmail: tx.user })
    const res = await tx.send({ to: me.email, subject: `[Test] ${m.subject}`, text: m.text, html: m.html })
    return res.ok ? { ok: true, to: me.email } : { error: res.error }
  } finally { tx.close() }
}

export type SendResult = { email: string; name: string; ok: boolean; error: string | null; at: string }

/**
 * Sends it: one email per person (nobody sees anyone else's address), each from the office mailbox, so a copy is
 * in Sent and in the portal's email history, and replies come back to the inbox like any other email.
 */
export async function sendTailored(id: string, name: string, recipients: string, content: TailoredContent): Promise<{ ok?: boolean; error?: string; results?: SendResult[] }> {
  const me = await requireAdmin()
  await ready()
  const row = await db.query.tailoredEmails.findFirst({ where: eq(tailoredEmails.id, id) })
  if (!row) return { error: 'This email no longer exists.' }
  if (row.status === 'sent') return { error: 'This email has already been sent. Use “Use again” to send it to someone else.' }
  const c = normalise(content, me.name)
  const { list, bad } = parseRecipients(recipients)
  if (bad.length) return { error: `These don’t look like email addresses: ${bad.slice(0, 3).join(', ')}` }
  if (!list.length) return { error: 'Add at least one email address in “Who it’s to”.' }
  if (list.length > MAX_RECIPIENTS) return { error: `That’s ${list.length} people. Send to ${MAX_RECIPIENTS} at most at a time; for more, use a campaign.` }
  if (!c.subject.trim()) return { error: 'Add a subject line.' }
  const gaps = gapsIn(c)
  if (gaps.length) return { error: `Fill in or delete these first: ${gaps.join(', ')}` }
  const box = await mailboxStatus()
  if (!box?.hasPassword) return { error: 'Connect the office mailbox in Email settings first.' }

  await db.update(tailoredEmails).set({ name: name.trim().slice(0, 120) || c.subject.slice(0, 120), recipients, content: JSON.stringify(c), updatedAt: now() }).where(eq(tailoredEmails.id, id))
  const base = await siteBase()
  const results: SendResult[] = []
  for (const r of list) {
    const m = renderTailored(c, r, { base, senderEmail: box.user ?? '' })
    const res = await sendFromMailbox({ to: [r.name ? `"${r.name.replace(/"/g, '')}" <${r.email}>` : r.email], subject: m.subject, text: m.text, html: m.html, by: me.id })
    results.push({ email: r.email, name: r.name, ok: res.ok, error: res.ok ? null : res.error, at: now() })
    // A fatal mailbox problem would fail every one: stop and say so.
    if (!res.ok && /password|connect the mailbox|couldn’t reach/i.test(res.error)) break
  }
  const sent = results.filter((x) => x.ok).length
  await db.update(tailoredEmails).set({
    status: sent ? 'sent' : 'draft', sent, failed: results.length - sent, results: JSON.stringify(results), sentAt: sent ? now() : null, updatedAt: now(),
  }).where(eq(tailoredEmails.id, id))
  await audit(me.id, 'sent tailored email', 'tailored_email', id, `${sent} of ${list.length}: ${c.subject}`)
  revalidatePath('/admin/campaigns')
  return sent ? { ok: true, results } : { error: results[0]?.error ?? 'Nothing was sent.', results }
}
