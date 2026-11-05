import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'

// Reads screenshots of Google reviews (phone or computer) with Claude's vision, and returns each review word for
// word, for staff to check before it's added. Needs ANTHROPIC_API_KEY on the server.

const Read = z.object({
  reviews: z.array(z.object({
    author: z.string().describe('The reviewer’s name exactly as shown'),
    rating: z.number().int().describe('Number of filled stars, 1 to 5'),
    when: z.string().describe('The date exactly as shown, e.g. "2 months ago", "a year ago" or "14 March 2025"'),
    text: z.string().describe('The review’s words exactly as written, every line, with no corrections'),
    truncated: z.boolean().describe('True if the words are cut off (by "More", "…" or the edge of the screenshot)'),
  })),
})
export type ReadReview = z.infer<typeof Read>['reviews'][number] & { month: string | null }

const SYSTEM = `You read screenshots of Google reviews of an estate agent, Preston Hill Estates, and copy the reviews out exactly.
- Include every review whose reviewer name, stars and words are visible. Skip one that is only partly in view with no words visible.
- Copy the words exactly as written: same spelling, punctuation, emoji and line breaks. Never correct, shorten, summarise or translate.
- Leave out the owner's reply ("Response from the owner") and labels such as "Local Guide", "NEW", photo counts and "Like"/"Share".
- Count only the filled stars for the rating.
- If a review has no words (a rating only), skip it.`

/** "2 months ago" → the month it was written (YYYY-MM), from today. Absolute dates are read too. */
export function monthOf(when: string, now = new Date()): string | null {
  const w = when.toLowerCase().replace(/^edited\s+/, '').trim()
  const m = /^(a|an|\d+)\s+(day|week|month|year)s?\s+ago/.exec(w)
  const d = new Date(now)
  if (m) {
    const n = m[1] === 'a' || m[1] === 'an' ? 1 : Number(m[1])
    if (m[2] === 'day') d.setUTCDate(d.getUTCDate() - n)
    else if (m[2] === 'week') d.setUTCDate(d.getUTCDate() - 7 * n)
    else if (m[2] === 'month') d.setUTCMonth(d.getUTCMonth() - n)
    else d.setUTCFullYear(d.getUTCFullYear() - n)
    return d.toISOString().slice(0, 7)
  }
  if (/^(today|yesterday|just now|\d+\s+hours?\s+ago)/.test(w)) return d.toISOString().slice(0, 7)
  const t = Date.parse(when)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 7)
}

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
type ImageType = (typeof TYPES)[number]

/** Reads up to 6 screenshots in one go. Returns the reviews found, or a plain-English error. */
export async function readReviewScreenshots(images: { type: string; data: Buffer }[]): Promise<{ reviews: ReadReview[]; error?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { reviews: [], error: 'Screenshot reading isn’t switched on yet: add ANTHROPIC_API_KEY to the server’s environment settings on Render.' }
  const ok = images.filter((i) => (TYPES as readonly string[]).includes(i.type))
  if (!ok.length) return { reviews: [], error: 'Choose PNG, JPEG or WebP screenshots.' }
  if (ok.some((i) => i.data.length > 5 * 1024 * 1024)) return { reviews: [], error: 'One of the screenshots is over 5 MB. Crop it, or save it as a JPEG, and try again.' }
  const client = new Anthropic()
  try {
    const res = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // If a safety check declines the request, it's re-run on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'medium', format: betaZodOutputFormat(Read) },
      messages: [{
        role: 'user',
        content: [
          ...ok.slice(0, 6).map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.type as ImageType, data: i.data.toString('base64') } })),
          { type: 'text' as const, text: 'Copy out every review in these screenshots.' },
        ],
      }],
    })
    if (res.stop_reason === 'refusal') return { reviews: [], error: 'The screenshots couldn’t be read. Try a clearer screenshot of just the reviews.' }
    if (res.stop_reason === 'max_tokens') return { reviews: [], error: 'Too many reviews in one go: try fewer screenshots at a time.' }
    const out = res.parsed_output
    if (!out) return { reviews: [], error: 'The screenshots couldn’t be read. Try again with clearer screenshots.' }
    const now = new Date()
    return { reviews: out.reviews.filter((r) => r.author.trim() && r.text.trim() && r.rating >= 1 && r.rating <= 5).map((r) => ({ ...r, author: r.author.trim(), text: r.text.trim(), month: monthOf(r.when, now) })) }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { reviews: [], error: 'The ANTHROPIC_API_KEY on the server isn’t valid. Check it in Render’s environment settings.' }
    if (e instanceof Anthropic.RateLimitError) return { reviews: [], error: 'Too many requests just now. Wait a minute and try again.' }
    if (e instanceof Anthropic.BadRequestError) return { reviews: [], error: `The screenshots couldn’t be sent (${e.message.slice(0, 160)}).` }
    if (e instanceof Anthropic.APIError) return { reviews: [], error: `The reading service had a problem (${e.status ?? 'no answer'}). Try again in a minute.` }
    console.error('review screenshot reading failed', e)
    return { reviews: [], error: 'The screenshots couldn’t be read. Try again.' }
  }
}
