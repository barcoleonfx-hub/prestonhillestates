import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { admins } from '@/db/schema'
import { now } from './util'

const COOKIE = 'phe_session'
const SESSION_HOURS = 12

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s || s.length < 32) {
    throw new Error('AUTH_SECRET must be set to a random string of at least 32 characters')
  }
  return new TextEncoder().encode(s)
}

let dummyHash: string | undefined

export type SessionUser ={ id: string; email: string; name: string; role: string }

export async function verifyLogin(email: string, password: string): Promise<SessionUser | null> {
  await ready()
  const user = await db.query.admins.findFirst({ where: eq(admins.email, email.trim().toLowerCase()) })
  // Compare against a dummy hash when the user is unknown so timing doesn't reveal which emails exist.
  dummyHash ??= await bcrypt.hash('no-account-placeholder', 12)
  const ok = await bcrypt.compare(password, user?.passwordHash ?? dummyHash)
  if (!user || !ok) return null
  await db.update(admins).set({ lastLoginAt: now() }).where(eq(admins.id, user.id))
  return { id: user.id, email: user.email, name: user.name, role: user.role }
}

export async function startSession(user: SessionUser) {
  const token = await new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret())
  const jar = await cookies()
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  })
}

export async function endSession() {
  const jar = await cookies()
  jar.delete(COOKIE)
}

export async function currentAdmin(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    if (!payload.sub) return null
    await ready()
    // Re-check the account still exists so removed admins lose access immediately.
    const user = await db.query.admins.findFirst({ where: eq(admins.id, payload.sub) })
    if (!user) return null
    return { id: user.id, email: user.email, name: user.name, role: user.role }
  } catch {
    return null
  }
}

/** For pages and server actions: sends signed-out visitors to the login page. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await currentAdmin()
  if (!user) redirect('/admin/login')
  return user
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12)
}

// Basic brute-force protection: a few failed attempts per email lock it for 15 minutes.
const attempts = new Map<string, { count: number; until: number }>()
export function loginLocked(email: string): boolean {
  const a = attempts.get(email.toLowerCase())
  return !!a && a.count >= 5 && a.until > Date.now()
}
export function recordLoginFailure(email: string) {
  const key = email.toLowerCase()
  const a = attempts.get(key)
  const fresh = !a || a.until < Date.now()
  attempts.set(key, { count: fresh ? 1 : a!.count + 1, until: Date.now() + 15 * 60 * 1000 })
}
export function clearLoginFailures(email: string) {
  attempts.delete(email.toLowerCase())
}
