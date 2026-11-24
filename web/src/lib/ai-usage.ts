import 'server-only'
import { and, eq, gte, sql } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { aiUsage, settings } from '@/db/schema'
import { now, uid } from './util'

// What the Claude API costs us. Every call is recorded with its tokens; the agents stop using the API for the rest
// of the month once their spend reaches the budget (staff tools like the email writer are counted but never stopped).
// Prices are Anthropic's list prices in US dollars per million tokens; the real bill is on console.anthropic.com.

const RATES: Record<string, { in: number; out: number; cacheRead: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01 },
}
/** Roughly what a dollar is in pounds, for showing the budget. */
export const USD_TO_GBP = 0.79

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | null | undefined

/** What one call cost in dollars (thinking is billed as output, and included in output_tokens). */
export function callCost(model: string, u: Usage): number {
  const r = RATES[model] ?? RATES['claude-opus-5-5']
  if (!u) return 0
  const m = 1e6
  return ((u.input_tokens ?? 0) * r.in + (u.cache_creation_input_tokens ?? 0) * r.in * 1.25 + (u.cache_read_input_tokens ?? 0) * r.cacheRead + (u.output_tokens ?? 0) * r.out) / m
}

/** Records a call; never throws (a failed record mustn't lose the work). */
export async function recordUsage(model: string, usage: Usage, purpose: string, agent = false): Promise<void> {
  try {
    await ready()
    await db.insert(aiUsage).values({
      id: uid(), at: now(), model, purpose, agent: agent ? 1 : 0,
      inputTokens: (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0),
      outputTokens: usage?.output_tokens ?? 0, costUsd: callCost(model, usage),
    })
  } catch (e) { console.error('recording AI usage failed', e) }
}

const KEY = 'agents'
export type AgentSettings = { budgetGbp: number; /** Where the Director's daily report goes. */ directorTo?: string; directorOff?: boolean }
export async function agentSettings(): Promise<AgentSettings> {
  await ready()
  const r = await db.query.settings.findFirst({ where: eq(settings.key, KEY) })
  try { return { budgetGbp: 40, ...(r ? JSON.parse(r.value) : {}) } } catch { return { budgetGbp: 40 } }
}
export async function saveAgentSettings(change: Partial<AgentSettings>) {
  const value = JSON.stringify({ ...(await agentSettings()), ...change })
  await db.insert(settings).values({ key: KEY, value, updatedAt: now() }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now() } })
}

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString() }

export type Spend = { agentsGbp: number; staffGbp: number; budgetGbp: number; calls: number; over: boolean }
/** This month's spend so far, in pounds. */
export async function monthSpend(): Promise<Spend> {
  await ready()
  const [cfg, rows] = await Promise.all([
    agentSettings(),
    db.select({ agent: aiUsage.agent, usd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)`, n: sql<number>`count(*)` }).from(aiUsage).where(gte(aiUsage.at, monthStart())).groupBy(aiUsage.agent),
  ])
  const gbp = (a: number) => Math.round((rows.find((r) => r.agent === a)?.usd ?? 0) * USD_TO_GBP * 100) / 100
  const agentsGbp = gbp(1)
  return { agentsGbp, staffGbp: gbp(0), budgetGbp: cfg.budgetGbp, calls: rows.reduce((n, r) => n + Number(r.n), 0), over: agentsGbp >= cfg.budgetGbp }
}

/** Whether the agents may still call the API this month. */
export async function agentsMaySpend(): Promise<boolean> {
  return !(await monthSpend()).over
}

/** Today's agent calls, for the Director's report. */
export async function spendSince(iso: string): Promise<number> {
  await ready()
  const r = await db.select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)` }).from(aiUsage).where(and(gte(aiUsage.at, iso), eq(aiUsage.agent, 1)))
  return Math.round((r[0]?.usd ?? 0) * USD_TO_GBP * 100) / 100
}
