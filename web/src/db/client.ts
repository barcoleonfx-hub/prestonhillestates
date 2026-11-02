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

/** Ensures the schema exists before the first query in this process. */
export function ready(): Promise<void> {
  if (!globalForDb.__phMigrated) {
    globalForDb.__phMigrated = migrate().then(() => undefined)
  }
  return globalForDb.__phMigrated
}
