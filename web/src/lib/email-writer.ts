import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { desc, eq } from 'drizzle-orm'
import { db, ready } from '@/db/client'
import { contacts, enquiries, enquiryMessages, mailMessages, mailThreads } from '@/db/schema'
import { enquiryLabel, isValuation, sortEnquiry } from './enquiry-labels'
import { shareFor } from './booklet-share'
import { anthropicKey } from './anthropic-key'
import { enquiryWorkspace } from './enquiry-workspace'
import { COUNCIL_TAX_BANDS, FURNISHING, PROPERTY_TYPES, TENURES, labelFor } from './options'
import { displayAddressFor, getProperty, priceLabel, slugFor } from './properties'
import { knownBase } from './property-email-data'
import { roleLabel } from './crm-options'
import { AI_PLACES, factSheet, readerNotes, tidyFor, type AiPlace, type WriterHome } from './email-writer-rules'

// "Write with AI", wherever an email is written in the portal: campaigns, property emails, enquiry emails and replies,
// and inbox replies. Claude writes (or improves) the message from what it's about: the listing, the enquiry and its
// conversation, or the email thread, using only those facts. Staff check and edit it before sending.
// Needs ANTHROPIC_API_KEY.

const Draft = z.object({
  subject: z.string().describe('The subject line, under 70 characters, or an empty string if no subject is needed'),
  body: z.string().describe('The message, in the format described'),
  note: z.string().describe('One short sentence for our staff: who you wrote it for and what you focused on, e.g. "Written for families: led with the three bedrooms and 90ft garden."'),
})
export type WriterResult = { subject: string; body: string; note: string }

const SYSTEM = `You write emails for Preston Hill Estates, an independent estate agent at 271 Preston Road, Harrow HA3 0PS (phone 020 8904 9005, WhatsApp 07745 203146), in British English: emails about our homes, newsletters, and replies to buyers, tenants, sellers and landlords. Staff check every message before it goes.

When the email is about a home, make it as attractive as possible to the people it suits best, while staying strictly accurate. When it's a reply, answer what the person actually asked, helpfully and warmly, and move things forward (a viewing, a valuation visit, a call).

When writing about a home, work out who it suits best from the facts (unless you're told who): for example first-time buyers (an affordable, ready-to-move-into first home), families (bedrooms, garden, space to grow), investors and landlords (a home that's easy to let: practical layout, condition, transport, low upkeep, as the listing shows), downsizers (manageable size, low maintenance, convenience), professionals and couples (style, commute, low upkeep), or tenants. Then lead with what matters most to them, and put the features in the order they would care about.

Accuracy rules. These are not negotiable:
- Use only facts you're given (the fact sheet, the enquiry, the conversation, and what staff tell you). Never invent rooms, sizes, distances, walking times, schools, stations, transport links, condition, views, light, renovations, or anything about the area that isn't stated.
- Never state or estimate rents, yields, returns, value growth or comparisons with other homes. For investors, talk about what makes the home practical to let, as the listing describes it.
- No pressure or scarcity claims such as "won't last", "rare opportunity", "huge interest" or "act fast", and no superlatives you can't back up ("best", "perfect", "stunning") unless the listing itself says so.
- If the home is under offer, sold or let agreed, say so plainly and don't invite viewings; offer to send similar homes instead.
- State the price exactly as given. Where the fact sheet has them, include the material facts a buyer needs: tenure, council tax band and, for leasehold homes, the lease remaining and charges.
- Never make up things you don't know, such as viewing times, whether an offer was accepted, availability dates or prices. If the reply needs them and you don't have them, say we'll confirm, or ask the person.
- Describe who a home suits by what they need (space, a garden, a short commute, being easy to let). Never say or imply that anyone is unwelcome or unsuitable because of age, sex, religion, ethnicity, disability or any other personal characteristic.

Every email should be exemplary: the kind of email the best independent agent in London would be proud to send. Specific and generous with useful detail drawn from the facts you have (the home's best features, the rooms, local sold prices, their report, our reviews), never generic or templated. Use the facts; don't pad.

Writing:
- Warm, confident and specific. Short paragraphs. No clichés ("nestled", "boasting", "deceptively spacious", "early viewing highly recommended", "I hope this email finds you well"), no exclamation marks, no emoji.
- Open with a sentence that gives this reader a reason to keep reading.
- Where a list is allowed, a short list of 3 to 6 key points the reader cares about most, each on its own line starting with "- ". Bold at most one or two words with **two stars** where it really helps.
- End with one clear next step (reply, or call 020 8904 9005), unless it's a quick reply where that would be odd.
- Never write a sign-off ("Kind regards", a name, the office details): it's added automatically, unless the instructions for the place say otherwise. Don't include links unless staff give you one.
- Separate paragraphs with a blank line. Plain text only, apart from "- " bullet lines and **bold**.
- Follow the instructions for the place you're writing (length, greeting, subject line, lists).`

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

export type AiRequest = {
  place: AiPlace
  /** What it's about. Any of these may be given; the enquiry's own home is used when it has one. */
  propertyId: string | null
  enquiryId: string | null
  threadId: string | null
  contactId: string | null
  /** A line from the page itself, e.g. the campaign's subject, or why this person matched the home. */
  about: string
  /** What staff want it to say (optional). */
  instruction: string
  /** "write": the best version (from the preset or draft in the box, if any). "improve": change it as staff ask. */
  mode: 'write' | 'improve'
  subject: string
  draft: string
  /** Who's writing (for the enquiry's details). */
  staffName?: string
}

const clip = (t: string | null | undefined, n: number) => { const x = (t ?? '').replace(/\r/g, '').trim(); return x.length > n ? `${x.slice(0, n)}…` : x }
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })

/** The enquiry, in words: who, what kind, what they said, their report link, and the conversation so far. */
async function enquiryBrief(id: string, staffName: string): Promise<{ text: string; propertyId: string | null; contactId: string | null } | null> {
  const e = await db.query.enquiries.findFirst({ where: eq(enquiries.id, id) })
  if (!e) return null
  const side = sortEnquiry(e).side
  // The same facts the preset emails use: their home, sold prices near it, our figure and evidence, reviews.
  const ctx = (await enquiryWorkspace(id, { name: staffName }).catch(() => null))?.ctx ?? null
  const report = ctx?.report?.url ?? (isValuation(e) ? await shareFor(e.id).then(async (t) => `${await knownBase()}/report/${t}`).catch(() => null) : null)
  const review = ctx?.brand ? (side === 'lettings' ? ctx.brand.lettings : ctx.brand.sales) ?? ctx.brand.sales ?? ctx.brand.lettings : null
  const msgs = await db.select().from(enquiryMessages).where(eq(enquiryMessages.enquiryId, id)).orderBy(desc(enquiryMessages.sentAt)).limit(6)
  const lines = [
    `The enquiry: ${enquiryLabel(e)}${side ? ` (${side})` : ''}, from ${e.name}, received ${day(e.createdAt)}.`,
    e.message ? `What they sent us:\n${clip(e.message, 2000)}` : null,
    ctx?.address || ctx?.postcode ? `Their home${isValuation(e) ? ' (the one to value)' : ''}: ${[ctx.address, ctx.postcode].filter(Boolean).join(', ')}` : null,
    ctx?.sold?.length ? `Recent sales near them (HM Land Registry; you may quote these exactly):\n${ctx.sold.map((x) => `- ${x.where}: ${x.type}, ${x.price}, sold ${x.when}`).join('\n')}` : null,
    ctx?.figure ? `Our valuation figure: ${ctx.figure}` : null,
    ctx?.evidence?.length ? `The comparable homes behind our figure:\n${ctx.evidence.map((x) => `- ${x.where}: ${x.price} (${x.what})`).join('\n')}` : null,
    report ? `Their personal property report (a free report we prepared for their home, at a private link): ${report}` : null,
    ctx?.brand?.rating && ctx.brand.count && ctx.brand.count >= 5 ? `Our Google rating: ${ctx.brand.rating.toFixed(1)} from ${ctx.brand.count} reviews (you may mention this exactly).` : null,
    review ? `A real client review you may quote word for word (or not use): "${clip(review.text, 400)}" (${review.name})` : null,
    msgs.length ? `The email conversation so far, newest last:\n${msgs.reverse().map((m) => `--- ${m.direction === 'in' ? `From ${e.name}` : 'From us'}, ${day(m.sentAt)}${m.subject ? ` · ${m.subject}` : ''}\n${clip(m.body, 900)}`).join('\n')}` : null,
  ]
  return { text: lines.filter(Boolean).join('\n\n'), propertyId: e.propertyId, contactId: e.contactId }
}

/** An inbox conversation, newest last. */
async function threadBrief(id: string): Promise<string | null> {
  const t = await db.query.mailThreads.findFirst({ where: eq(mailThreads.id, id) })
  if (!t) return null
  const msgs = (await db.select().from(mailMessages).where(eq(mailMessages.threadId, id)).orderBy(desc(mailMessages.sentAt)).limit(6)).reverse()
  return [`The email conversation "${t.subject}" with ${t.counterpartName || t.counterpart || 'them'}, newest last:`,
    ...msgs.map((m) => `--- ${m.direction === 'in' ? `From ${m.fromName || m.fromAddr || 'them'}` : 'From us'}, ${day(m.sentAt)}\n${clip(m.body ?? m.snippet, 1500)}`)].join('\n')
}

/** The facts an email can be checked against: the enquiry, the home, the thread and the person's requirements. */
export async function emailFacts(r: { propertyId: string | null; enquiryId: string | null; threadId: string | null; contactId: string | null; staffName?: string }): Promise<string> {
  await ready()
  const enq = r.enquiryId ? await enquiryBrief(r.enquiryId, r.staffName ?? '').catch(() => null) : null
  const propertyId = r.propertyId ?? enq?.propertyId ?? null
  const home = propertyId ? await writerHome(propertyId).catch(() => null) : null
  const thread = r.threadId ? await threadBrief(r.threadId).catch(() => null) : null
  const contactId = r.contactId ?? enq?.contactId ?? null
  const c = contactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) }) : null
  const reader = c ? readerNotes({ role: c.roles ? roleLabel(c.roles.split(',')[0]).toLowerCase() : null, minBeds: c.minBeds, maxPrice: c.maxPrice, areas: c.areas, position: c.position }) : null
  return [enq?.text, thread, home ? `The home:\n${factSheet(home)}` : null, reader ? `What the reader told us they're looking for: ${reader}` : null].filter(Boolean).join('\n\n')
}

/** Writes (or improves) a message for one place in the portal. Returns the draft, or a plain-English error. */
export async function writeEmail(r: AiRequest): Promise<WriterResult | { error: string }> {
  const k = anthropicKey()
  if ('error' in k) return { error: k.error }
  const key = k.key
  await ready()
  const place = AI_PLACES[r.place]
  const enq = r.enquiryId ? await enquiryBrief(r.enquiryId, r.staffName ?? '').catch(() => null) : null
  const propertyId = r.propertyId ?? enq?.propertyId ?? null
  const home = propertyId ? await writerHome(propertyId).catch(() => null) : null
  const thread = r.threadId ? await threadBrief(r.threadId).catch(() => null) : null
  const contactId = r.contactId ?? enq?.contactId ?? null
  const c = contactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) }) : null
  const reader = c ? readerNotes({ role: c.roles ? roleLabel(c.roles.split(',')[0]).toLowerCase() : null, minBeds: c.minBeds, maxPrice: c.maxPrice, areas: c.areas, position: c.position }) : null
  if (r.mode === 'improve' && !r.draft.trim()) return { error: 'There’s nothing to change yet: press Write with AI first.' }
  if (!home && !enq && !thread && !r.instruction.trim() && !r.about.trim() && !r.draft.trim()) return { error: 'There’s nothing to write about yet: choose the property first (or type a few words in the box).' }
  const ask = [
    `You're writing ${place.what}. Aim for about ${place.words} words.`,
    place.subject ? 'Also write a subject line (under 70 characters).' : 'No subject line is needed: leave the subject empty.',
    place.greeting ? 'Start with a short greeting using their first name if you know it (e.g. "Hi Sam,"); in a newsletter use "Hello {first_name}," exactly, as it is filled in for each reader.' : 'Do not write a greeting.',
    place.bullets ? 'A short "- " list of key points is fine where it helps.' : 'No bullet points: paragraphs only.',
    enq ? enq.text : null,
    thread,
    home ? `The home:\n${factSheet(home)}` : null,
    reader ? `What this person told us they're looking for: ${reader} Make it relevant to them, without repeating their details back word for word.` : null,
    r.about.trim() ? `From the page: ${clip(r.about, 600)}` : null,
    r.mode === 'improve'
      ? `Here is the current message. Change it as our staff ask: ${clip(r.instruction, 800) || 'make it better'}. Keep everything else that works, and every fact in it.${place.subject ? ` Current subject: ${r.subject.trim() || '(none)'}` : ''}\nCurrent message:\n${clip(r.draft, 5000)}`
      : r.draft.trim()
        ? `Here is what's in the box now: usually our standard wording for this email, or staff's own notes. Treat it as the brief. Keep its purpose and every specific detail in it (dates, times, prices, figures, names, links) and anything personal, then write the best possible version: richer, more specific and more persuasive, using the facts above.${place.subject ? ` Current subject: ${r.subject.trim() || '(none)'}` : ''}${r.instruction.trim() ? `\nStaff also want: ${clip(r.instruction, 800)}` : ''}\nCurrent message:\n${clip(r.draft, 5000)}`
        : `Write the message.${r.instruction.trim() ? ` Staff want it to say (it's true; follow it): ${clip(r.instruction, 800)}` : ''}`,
  ].filter(Boolean).join('\n\n')

  // A key pasted with a space or line break around it still works.
  const client = new Anthropic({ apiKey: key })
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
    if (res.stop_reason === 'refusal') return { error: 'The AI couldn’t write this one. Try again, or change what you asked for.' }
    if (res.stop_reason === 'max_tokens') return { error: 'The AI ran out of room. Ask for something shorter.' }
    const out = res.parsed_output
    if (!out || !out.body.trim()) return { error: 'The AI didn’t return a message. Try again.' }
    return { subject: place.subject ? out.subject.trim().slice(0, 140) : '', body: tidyFor(r.place, out.body), note: out.note.trim().slice(0, 240) }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: 'The ANTHROPIC_API_KEY on the server isn’t valid. Check it in Render’s environment settings.' }
    if (e instanceof Anthropic.PermissionDeniedError) return { error: 'The AI account can’t be used right now (check its credit and spending limit at console.anthropic.com).' }
    if (e instanceof Anthropic.RateLimitError) return { error: 'Too many requests just now. Wait a minute and try again.' }
    if (e instanceof Anthropic.BadRequestError) return { error: /credit|balance|billing/i.test(e.message) ? 'The AI account is out of credit. Top it up at console.anthropic.com.' : `The AI request couldn’t be sent (${e.message.slice(0, 160)}).` }
    if (e instanceof Anthropic.APIError) return { error: `The AI service had a problem (${e.status ?? 'no answer'}). Try again in a minute.` }
    console.error('AI writing failed', e)
    return { error: 'The AI couldn’t write this one. Try again.' }
  }
}
