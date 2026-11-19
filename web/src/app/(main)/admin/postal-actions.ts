'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/contacts'
import { createBatch, markPosted } from '@/lib/postal-letters'

/** Print letters to the ticked people: saved as a batch, then opened ready to print. */
export async function printLettersAction(form: FormData) {
  const me = await requireAdmin()
  const ids = form.getAll('id').map(String).filter(Boolean).slice(0, 300)
  if (!ids.length) redirect('/admin/valuation-letters?msg=none')
  const items = ids.map((id) => ({ id, address: String(form.get(`addr_${id}`) ?? '').slice(0, 300) }))
  const before = String(form.get('before') ?? '').trim().slice(0, 2000)
  const after = String(form.get('after') ?? '').trim().slice(0, 3000)
  const sender = String(form.get('sender') ?? '').trim().slice(0, 80) || me.name
  if (!before || !after) redirect('/admin/valuation-letters?msg=words')
  const batch = await createBatch({ items, before, after, sender, by: me.id })
  if (!batch) redirect('/admin/valuation-letters?msg=address')
  await audit(me.id, 'printed valuation letters', 'letter_batch', batch, `${ids.length} chosen`)
  redirect(`/admin/letters-print/${batch}`)
}

/** The batch has gone in the post. */
export async function markPostedAction(form: FormData) {
  const me = await requireAdmin()
  const id = String(form.get('batch') ?? '')
  const n = await markPosted(id, me.id)
  if (n) await audit(me.id, 'posted valuation letters', 'letter_batch', id, `${n} letters`)
  revalidatePath('/admin/valuation-letters')
  redirect(`/admin/letters-print/${id}?posted=${n}`)
}
