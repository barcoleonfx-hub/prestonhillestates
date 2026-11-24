import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { z } from 'zod'
import { agentsMaySpend, recordUsage } from './ai-usage'
import { anthropicKey } from './anthropic-key'

/** One structured call to Claude for the agents (counted against their budget), or why it couldn't run. */
export async function askClaude<T>(model: string, system: string, schema: z.ZodType<T>, content: string, purpose: string, effort: 'low' | 'medium' = 'medium'): Promise<{ out: T } | { why: string }> {
  const k = anthropicKey()
  if ('error' in k) return { why: 'the Claude API key isn’t set' }
  if (!(await agentsMaySpend())) return { why: 'this month’s AI budget is used up' }
  try {
    const client = new Anthropic({ apiKey: k.key })
    const res = await client.beta.messages.parse({
      model, max_tokens: 12000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system,
      output_config: { effort, format: betaZodOutputFormat(schema) }, messages: [{ role: 'user', content }],
    })
    await recordUsage(model, res.usage, purpose, true)
    if (res.stop_reason === 'refusal' || !res.parsed_output) return { why: 'Claude couldn’t write it' }
    return { out: res.parsed_output as T }
  } catch (e) {
    if (!(e instanceof Anthropic.APIError)) console.error(`${purpose} failed`, e)
    return { why: 'Claude didn’t answer' }
  }
}
