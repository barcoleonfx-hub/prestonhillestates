import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import * as schema from './schema'
import { MIGRATIONS } from './migrations'

const url = process.env.DATABASE_URL || 'file:./data/prestonhill.db'

function makeClient(): Client {
  if (url.startsWith('file:')) {
    mkdirSync(path.dirname(url.slice('file:'.length)), { recursive: true })
  }
  return createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined })
}

const globalForDb = globalThis as unknown as { __phClient?: Client; __phMigrated?: Promise<void> }

export const client = globalForDb.__phClient ?? makeClient()
globalForDb.__phClient = client

export const db = drizzle(client, { schema })

export async function migrate(c: Client = client): Promise<string[]> {
  await c.execute('PRAGMA foreign_keys = ON').catch(() => {})
  await c.execute('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const done = new Set((await c.execute('SELECT id FROM _migrations')).rows.map((r) => String(r.id)))
  const applied: string[] = []
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue
    await c.batch(
      [...m.sql, { sql: 'INSERT INTO _migrations (id, applied_at) VALUES (?, ?)', args: [m.id, new Date().toISOString()] }],
      'write',
    )
    applied.push(m.id)
  }
  return applied
}

/**
 * On a fresh install with no accounts, creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME,
 * so a hosted copy can be signed into without shell access. Does nothing once any account exists.
 */
async function bootstrapAdmin(c: Client = client) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) return
  if (password.length < 10) { console.warn('ADMIN_PASSWORD must be at least 10 characters; first admin not created.'); return }
  const { rows } = await c.execute('SELECT count(*) AS n FROM admins')
  if (Number(rows[0].n) > 0) return
  const { hash } = await import('bcryptjs')
  const { randomUUID } = await import('node:crypto')
  await c.execute({
    sql: "INSERT INTO admins (id, email, name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 'admin', 1, ?)",
    args: [randomUUID(), email, process.env.ADMIN_NAME?.trim() || 'Admin', await hash(password, 12), new Date().toISOString()],
  })
  console.log(`Created first admin ${email}`)
}

/** Ensures the schema exists before the first query in this process. */
export function ready(): Promise<void> {
  if (!globalForDb.__phMigrated) {
    globalForDb.__phMigrated = migrate().then(() => bootstrapAdmin()).then(() => undefined)
  }
  return globalForDb.__phMigrated
}
