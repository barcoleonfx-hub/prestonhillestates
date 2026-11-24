import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db, ready } from '@/db/client'
import { mailMessages, mailThreads, mailTriage } from '@/db/schema'
import { askClaude } from './staff-briefing-ai'
import { unquoted } from './staff-briefing-rules'
import { now } from './util'

// Real work, or a sales pitch or spam? Conversations with someone we know (a contact, or we've replied before) are
// real. The rest are read once by Claude and the verdict kept, so the briefings never count a broadband offer, a
// builder's cold email or spam as something to reply to.

const Verdicts = z.object({
  verdicts: z.array(z.object({
    id: z.string().describe('The conversation id exactly as given'),
    verdict: z.enum(['real', 'pitch', 'spam']).describe('"real": a client, applicant, tenant, landlord, seller, buyer, solicitor, council, supplier we use, or anyone with a genuine question for us. "pitch": unsolicited selling to us (services, software, marketing, photography, builders, partnerships, recruiters). "spam": scams, junk, gibberish.'),
    reason: z.string().describe('A few words'),
  })),
})

const SYSTEM = `You sort emails sent to an independent estate agent's office (Preston Hill Estates, Harrow). For each conversation, say whether it is real work for the agency, an unsolicited sales pitch, or spam. When unsure, say "real": a real client wrongly hidden is far worse than a pitch shown.`

/** The conversations (by id) that are pitches or spam. Unknown ones are judged now (once); known ones are real. */
export async function junkThreads(threadIds: string[]): Promise<Set<string>> {
  await ready()
  const ids = [...new Set(threadIds)]
  if (!ids.length) return new Set()
  const [threads, known] = await Promise.all([
    db.select().from(mailThreads).where(inArray(mailThreads.id, ids)),
    db.select().from(mailTriage).where(inArray(mailTriage.threadId, ids)),
  ])
  const junk = new Set(known.filter((k) => k.verdict !== 'real').map((k) => k.threadId))
  const decided = new Set(known.map((k) => k.threadId))
  // Someone we know: linked to a contact, or we've written to them in this conversation.
  const todo = threads.filter((t) => !decided.has(t.id) && !t.contactId && !t.lastOutAt).slice(0, 80)
  if (!todo.length) return junk
  const firsts = await db.select().from(mailMessages).where(and(inArray(mailMessages.threadId, todo.map((t) => t.id)), eq(mailMessages.direction, 'in'))).orderBy(desc(mailMessages.sentAt))
  const lines = todo.map((t) => {
    const m = firsts.find((x) => x.threadId === t.id)
    const body = unquoted(m?.body ?? m?.snippet ?? '').replace(/\s+/g, ' ').slice(0, 450)
    return `[${t.id}] From: ${m?.fromName ?? ''} <${m?.fromAddr ?? t.counterpart ?? ''}>\nSubject: ${t.subject}\n${body}`
  }).join('\n\n')
  const r = await askClaude('claude-sonnet-5-5', SYSTEM, Verdicts, lines, 'mail triage', 'low')
  if ('why' in r) return junk
  const valid = new Set(todo.map((t) => t.id))
  for (const v of r.out.verdicts.filter((x) => valid.has(x.id))) {
    await db.insert(mailTriage).values({ threadId: v.id, verdict: v.verdict, reason: v.reason.slice(0, 120), at: now() }).onConflictDoNothing()
    if (v.verdict !== 'real') junk.add(v.id)
  }
  return junk
}
