import 'server-only'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { lookupCache } from '@/db/schema'
import { now } from './util'

const DAY = 86400_000
/** Failures are remembered briefly (in memory), so a service that's down isn't asked on every page load. */
const failed = new Map<string, number>()

/**
 * The cached answer for `key` if it's younger than `days`, otherwise a fresh one from `load` (saved for next
 * time). If `load` fails, the last answer is used however old it is, or null.
 */
export async function cached<T>(key: string, days: number, load: () => Promise<T | null>): Promise<{ data: T | null; error: string | null; fresh: boolean }> {
  await ready()
  const hit = await db.query.lookupCache.findFirst({ where: eq(lookupCache.key, key) })
  const old = hit ? (JSON.parse(hit.data) as T) : null
  if (hit && Date.now() - new Date(hit.fetchedAt).getTime() < days * DAY) return { data: old, error: null, fresh: false }
  if ((failed.get(key) ?? 0) > Date.now() - 3600_000) return { data: old, error: 'tried recently', fresh: false }
  try {
    const data = await load()
    if (data !== null) {
      const v = JSON.stringify(data)
      await db.insert(lookupCache).values({ key, data: v, fetchedAt: now() }).onConflictDoUpdate({ target: lookupCache.key, set: { data: v, fetchedAt: now() } })
    }
    return { data: data ?? old, error: null, fresh: true }
  } catch (e) {
    failed.set(key, Date.now())
    return { data: old, error: (e as Error).name === 'TimeoutError' ? 'took too long to answer' : String((e as Error).message ?? e).slice(0, 160), fresh: false }
  }
}
