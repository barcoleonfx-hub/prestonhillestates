'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins } from '@/db/schema'
import { checkPassword, hashPassword, requireAdmin, requireRole } from '@/lib/auth'
import { now, uid } from '@/lib/util'

export type StaffState = { ok?: boolean; error?: string; email?: string; password?: string }

const ROLES = ['admin', 'negotiator']
const tempPassword = () => randomBytes(9).toString('base64url')

export async function addStaff(_prev: StaffState, form: FormData): Promise<StaffState> {
  await requireRole('admin')
  await ready()
  const name = String(form.get('name') || '').trim().slice(0, 120)
  const email = String(form.get('email') || '').trim().toLowerCase().slice(0, 200)
  const phone = String(form.get('phone') || '').trim().slice(0, 40) || null
  const role = ROLES.includes(String(form.get('role'))) ? String(form.get('role')) : 'negotiator'
  if (!name) return { error: 'Add the person’s name.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Add a valid email address. It’s their login and where reminders go.' }
  if (await db.query.admins.findFirst({ where: eq(admins.email, email) })) return { error: 'Someone already has an account with that email.' }
  const password = tempPassword()
  await db.insert(admins).values({
    id: uid(), email, name, phone, role, active: true, passwordHash: await hashPassword(password), createdAt: now(),
  })
  revalidatePath('/admin/staff')
  return { ok: true, email, password }
}

export async function resetStaffPassword(_prev: StaffState, form: FormData): Promise<StaffState> {
  await requireRole('admin')
  await ready()
  const id = String(form.get('id') || '')
  const user = await db.query.admins.findFirst({ where: eq(admins.id, id) })
  if (!user) return { error: 'That account no longer exists.' }
  const password = tempPassword()
  await db.update(admins).set({ passwordHash: await hashPassword(password) }).where(eq(admins.id, id))
  return { ok: true, email: user.email, password }
}

export async function setStaffActive(form: FormData) {
  const me = await requireRole('admin')
  await ready()
  const id = String(form.get('id') || '')
  const active = form.get('active') === '1'
  if (id === me.id && !active) return // you can't switch yourself off
  await db.update(admins).set({ active }).where(eq(admins.id, id))
  revalidatePath('/admin/staff')
}

export async function setStaffRole(form: FormData) {
  const me = await requireRole('admin')
  await ready()
  const id = String(form.get('id') || '')
  const role = String(form.get('role') || '')
  if (!ROLES.includes(role) || id === me.id) return // keeps at least the current admin in place
  await db.update(admins).set({ role }).where(eq(admins.id, id))
  revalidatePath('/admin/staff')
}

export async function changeOwnPassword(_prev: StaffState, form: FormData): Promise<StaffState> {
  const me = await requireAdmin()
  const current = String(form.get('current') || '')
  const next = String(form.get('next') || '')
  const confirm = String(form.get('confirm') || '')
  if (!(await checkPassword(me.id, current))) return { error: 'Your current password isn’t right.' }
  if (next.length < 10) return { error: 'Use at least 10 characters for the new password.' }
  if (next !== confirm) return { error: 'The two new passwords don’t match.' }
  await db.update(admins).set({ passwordHash: await hashPassword(next) }).where(eq(admins.id, me.id))
  return { ok: true }
}
