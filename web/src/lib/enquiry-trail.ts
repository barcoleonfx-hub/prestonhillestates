import 'server-only'
import { desc, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { admins, calls, enquiryNotes } from '@/db/schema'

export type TrailItem = { id: string; at: string; by: string | null; kind: 'note' | 'call'; text: string }

const CALL_WORD: Record<string, string> = { in: 'They called', out: 'We called', walk_in: 'Came in', email_in: 'They emailed', email_out: 'We emailed' }

/**
 * What the team has said and done about each enquiry: comments left on it, plus calls logged
 * with that person about the same property (or, if it isn't linked to one, since they enquired).
 */
export async function trailFor(list: { id: string; contactId: string | null; propertyId: string | null; createdAt: string }[]): Promise<Record<string, TrailItem[]>> {
  const out: Record<string, TrailItem[]> = {}
  if (!list.length) return out
  const ids = list.map((e) => e.id)
  const people = [...new Set(list.map((e) => e.contactId).filter((c): c is string => !!c))]
  // In chunks, to stay well inside SQLite's limit on query parameters.
  const chunks = <T,>(a: T[]) => Array.from({ length: Math.ceil(a.length / 400) }, (_, i) => a.slice(i * 400, i * 400 + 400))
  const [noteSets, callSets, staff] = await Promise.all([
    Promise.all(chunks(ids).map((c) => db.select().from(enquiryNotes).where(inArray(enquiryNotes.enquiryId, c)).orderBy(desc(enquiryNotes.createdAt)))),
    Promise.all(chunks(people).map((c) => db.select().from(calls).where(inArray(calls.contactId, c)).orderBy(desc(calls.createdAt)).limit(4000))),
    db.select({ id: admins.id, name: admins.name }).from(admins),
  ])
  const notes = noteSets.flat(), callRows = callSets.flat()
  const who = new Map(staff.map((a) => [a.id, a.name]))
  for (const e of list) out[e.id] = []
  for (const n of notes) out[n.enquiryId]?.push({ id: n.id, at: n.createdAt, by: who.get(n.createdBy) ?? null, kind: 'note', text: n.body })
  for (const e of list) {
    if (!e.contactId) continue
    for (const c of callRows) {
      if (c.contactId !== e.contactId) continue
      const same = e.propertyId ? c.propertyId === e.propertyId : !c.propertyId && c.createdAt >= e.createdAt
      if (!same) continue
      out[e.id].push({ id: c.id, at: c.createdAt, by: who.get(c.createdBy) ?? null, kind: 'call', text: [CALL_WORD[c.direction] ?? 'Call', c.notes].filter(Boolean).join(': ') })
    }
    out[e.id].sort((a, b) => (a.at < b.at ? 1 : -1))
  }
  return out
}
