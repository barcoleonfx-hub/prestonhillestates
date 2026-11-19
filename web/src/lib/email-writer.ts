import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts } from '@/db/schema'
import { COUNCIL_TAX_BANDS, FURNISHING, PROPERTY_TYPES, TENURES, labelFor } from './options'
import { displayAddressFor, getProperty, priceLabel, slugFor } from './properties'
import { knownBase } from './property-email-data'
import { roleLabel } from './crm-options'
import { AUDIENCES, LENGTHS, TONES, factSheet, readerNotes, tidyBody, type AudienceKey, type LengthKey, type ToneKey, type WriterHome } from './email-writer-rules'

// Writes (or improves) the body of a property email with Claude: it works out who the home suits best and writes for
// them, using only the facts on the listing. Staff check and edit it before sending. Needs ANTHROPIC_API_KEY.

const Draft = z.object({
  audience: z.string().describe('Who the home suits best, in 2 to 5 words, e.g. "First-time buyers" or "Families needing space"'),
  why: z.string().describe('One short sentence: which facts on the listing make it right for them'),
  subject: z.string().describe('The email subject line, under 70 characters'),
  body: z.string().describe('The email body, in the format described'),
})
export type WriterResult = { audience: string; why: string; subject: string; body: string }

const SYSTEM = `You write property emails for Preston Hill Estates, an independent estate agent at 271 Preston Road, Harrow HA3 0PS (phone 020 8904 9005), in British English. Each email is about one home and goes to buyers or tenants who have registered with us or asked about it.

Your job is to make the home as attractive as possible to the people it suits best, while staying strictly accurate.

Work out who the home suits best from the facts (unless you're told who): for example first-time buyers (an affordable, ready-to-move-into first home), families (bedrooms, garden, space to grow), investors and landlords (a home that's easy to let: practical layout, condition, transport, low upkeep, as the listing shows), downsizers (manageable size, low maintenance, convenience), professionals and couples (style, commute, low upkeep), or tenants. Then lead with what matters most to them, and put the features in the order they would care about.

Accuracy rules. These are not negotiable:
- Use only facts in the fact sheet. Never invent rooms, sizes, distances, walking times, schools, stations, transport links, condition, views, light, renovations, or anything about the area that isn't stated.
- Never state or estimate rents, yields, returns, value growth or comparisons with other homes. For investors, talk about what makes the home practical to let, as the listing describes it.
- No pressure or scarcity claims such as "won't last", "rare opportunity", "huge interest" or "act fast", and no superlatives you can't back up ("best", "perfect", "stunning") unless the listing itself says so.
- If the home is under offer, sold or let agreed, say so plainly and don't invite viewings; offer to send similar homes instead.
- State the price exactly as given. Where the fact sheet has them, include the material facts a buyer needs: tenure, council tax band and, for leasehold homes, the lease remaining and charges.
- Describe who a home suits by what they need (space, a garden, a short commute, being easy to let). Never say or imply that anyone is unwelcome or unsuitable because of age, sex, religion, ethnicity, disability or any other personal characteristic.

Writing:
- Warm, confident and specific. Short paragraphs. No clichés ("nestled", "boasting", "deceptively spacious", "early viewing highly recommended"), no exclamation marks, no emoji.
- Open with a sentence that gives this reader a reason to keep reading, not "I hope you are well".
- Include a short list of 3 to 6 key points the reader cares about most, each on its own line starting with "- ", and bold at most one or two words with **two stars** where it really helps.
- End with one clear next step: reply to this email or call 020 8904 9005 to arrange a viewing (or, if the home is no longer available, to hear about similar homes).
- Do not write a greeting ("Dear ...") or a sign-off ("Kind regards", a name). The email adds those. Do not include links; the email shows a box with the link below the message.
- Separate paragraphs with a blank line. Plain text only, apart from "- " bullet lines and **bold**.`

/** The listing in the writer's terms. */
async function writerHome(propertyId: string): Promise<WriterHome | null> {
  const p = await getProperty(propertyId)
  if (!p) return null
  const base = await knownBase()
  return {
    channel: p.channel === 'let' ? 'let' : 'sale', status: p.status, headline: p.headline, address: displayAddressFor(p), price: priceLabel(p),
    type: labelFor(PROPERTY_TYPES, p.propertyType) || null, bedrooms: p.bedrooms, bathrooms: p.bathrooms, receptions: p.receptions, floorAreaSqft: p.floorAreaSqft,
    tenure: p.channel === 'let' ? null : labelFor(TENURES, p.tenure) || null, leaseYears: p.leaseYearsRemaining, serviceCharge: p.serviceCharge, groundRent: p.groundRent,
    councilTax: p.councilTaxBand ? labelFor(COUNCIL_TAX_BANDS, p.councilTaxBand).replace(/^band\s*/i, '') || p.councilTaxBand : null, epc: p.epcCurrent,
    parking: p.parking, outside: p.outsideSpace, heating: p.heating, furnishing: p.channel === 'let' ? labelFor(FURNISHING, p.furnishing) || null : null,
    availableFrom: p.channel === 'let' ? p.availableFrom : null, deposit: p.channel === 'let' ? p.deposit : null, newBuild: !!p.newBuild,
    summary: p.summary, description: p.description, features: p.keyFeatures ?? [], rooms: p.rooms.map((r) => ({ name: r.name, dimensions: r.dimensions, description: r.description })),
    url: `${base}/properties/${slugFor(p)}`,
  }
}

export type WriteRequest = {
  propertyId: string | null
  audience: AudienceKey
  length: LengthKey
  tone: ToneKey
  notes: string
  /** "improve": rework the draft below; "write": start fresh. */
  mode: 'write' | 'improve'
  subject: string
  draft: string
  /** The one person it's to, if it's to one person on the contact list. */
  contactId: string | null
}

/** Writes the email. Returns the draft, or a plain-English error. */
export async function writePropertyEmail(r: WriteRequest): Promise<WriterResult | { error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { error: 'AI writing isn’t switched on yet: add ANTHROPIC_API_KEY to the server’s environment settings on Render.' }
  await ready()
  const home = r.propertyId ? await writerHome(r.propertyId).catch(() => null) : null
  if (!home && r.mode === 'write') return { error: 'Choose the property first (under “The property”), so there’s something to write about.' }
  if (r.mode === 'improve' && !r.draft.trim()) return { error: 'There’s no message to improve yet. Write something first, or use “Write it for me”.' }
  const c = r.contactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, r.contactId) }) : null
  const reader = c ? readerNotes({ role: c.roles ? roleLabel(c.roles.split(',')[0]).toLowerCase() : null, minBeds: c.minBeds, maxPrice: c.maxPrice, areas: c.areas, position: c.position }) : null
  const who = AUDIENCES.find((a) => a.key === r.audience)
  const ask = [
    home ? `The home:\n${factSheet(home)}` : 'There is no particular home: improve the message as a general note from the agency, keeping to its facts.',
    who && who.key !== 'auto' ? `Write for: ${who.label}.` : 'Work out who the home suits best, and write for them.',
    reader ? `This email is to one person. What they told us: ${reader} Make it relevant to them, without repeating their details back word for word.` : null,
    `Length: ${LENGTHS[r.length]}. Tone: ${TONES[r.tone]}.`,
    r.notes.trim() ? `Staff want this included (it's true; work it in naturally): ${r.notes.trim().slice(0, 600)}` : null,
    r.mode === 'improve' ? `Improve this draft. Keep its facts and anything personal in it, fix the order and wording, and make it more attractive to the right reader. Current subject: ${r.subject.trim() || '(none)'}\nCurrent message:\n${r.draft.trim().slice(0, 4000)}` : 'Write the subject line and the message.',
  ].filter(Boolean).join('\n\n')

  const client = new Anthropic()
  try {
    const res = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // If a safety check declines the request, it's re-run on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'medium', format: betaZodOutputFormat(Draft) },
      messages: [{ role: 'user', content: ask }],
    })
    if (res.stop_reason === 'refusal') return { error: 'The AI couldn’t write this one. Try again, or change the notes.' }
    if (res.stop_reason === 'max_tokens') return { error: 'The AI ran out of room. Try a shorter length.' }
    const out = res.parsed_output
    if (!out || !out.body.trim()) return { error: 'The AI didn’t return a message. Try again.' }
    return { audience: out.audience.trim().slice(0, 60), why: out.why.trim().slice(0, 240), subject: out.subject.trim().slice(0, 140), body: tidyBody(out.body) }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: 'The ANTHROPIC_API_KEY on the server isn’t valid. Check it in Render’s environment settings.' }
    if (e instanceof Anthropic.PermissionDeniedError) return { error: 'The AI account can’t be used right now (check its credit and spending limit at console.anthropic.com).' }
    if (e instanceof Anthropic.RateLimitError) return { error: 'Too many requests just now. Wait a minute and try again.' }
    if (e instanceof Anthropic.BadRequestError) return { error: /credit|balance|billing/i.test(e.message) ? 'The AI account is out of credit. Top it up at console.anthropic.com.' : `The AI request couldn’t be sent (${e.message.slice(0, 160)}).` }
    if (e instanceof Anthropic.APIError) return { error: `The AI service had a problem (${e.status ?? 'no answer'}). Try again in a minute.` }
    console.error('AI email writing failed', e)
    return { error: 'The AI couldn’t write this one. Try again.' }
  }
}
