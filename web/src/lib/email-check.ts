import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { recordUsage } from './ai-usage'
import { anthropicKey } from './anthropic-key'
import { emailFacts } from './email-writer'

// The check before an email goes: a careful read of the whole finished email (subject, preview line and every
// section, as the reader will see it), against the facts we hold, for anything that would let it down.

const Check = z.object({
  ready: z.boolean().describe('True if it can go as it is (nothing that must be fixed)'),
  summary: z.string().describe('One short sentence for staff, e.g. "Ready to send." or "Two things to fix before it goes."'),
  issues: z.array(z.object({
    severity: z.enum(['fix', 'consider']).describe('"fix": it would embarrass us or mislead the reader; "consider": would make it better'),
    where: z.string().describe('Where in the email, e.g. "Subject", "Getting about", "Second paragraph"'),
    problem: z.string().describe('What is wrong, in one plain sentence'),
    suggestion: z.string().describe('Exactly what to change, e.g. the corrected wording'),
  })).describe('At most 8, the most important first. Empty if there is nothing worth raising.'),
})
export type CheckResult = z.infer<typeof Check>

const SYSTEM = `You are the most careful senior editor at Preston Hill Estates, an independent estate agent at 271 Preston Road, Harrow. Before any email goes out, you read the finished email exactly as the reader will see it, and check it against the facts we hold. You only raise real problems, plainly, with the exact fix.

Check for:
- Personalisation: unfilled placeholders ({first_name}, {sender}, [Name]…), the wrong or an odd name, a line that starts oddly (e.g. "there, …"), the reader's own details repeated back awkwardly.
- Accuracy: anything that contradicts the facts (price, address, bedrooms, availability, dates, figures, names), or a claim the facts don't support.
- Things that look bad in a polished email: a "nearby" station or place that's far away (more than about a 20 minute walk), a list or section with only one weak point, an empty or repeated section, the same thing said twice, numbers or names that don't match between sections, odd or machine-like phrasing.
- Spelling, grammar and British English; tone (warm, professional, not pushy); no clichés or pressure claims ("won't last", "act fast").
- The subject line and preview line: clear, specific, not too long, and matching the email.
- A clear next step (a reply, a call on 020 8904 9005, a viewing), and nothing that would confuse the reader about what to do.
- For a home: the material facts a buyer or tenant needs where we have them (price, tenure, council tax band).

Don't raise taste preferences or rewrite things that are fine. If it's ready to send, say so and return no issues (or only one or two worthwhile "consider" points).`

export async function checkEmail(r: { what: string; subject: string; preheader: string; text: string; links: string[]; propertyId: string | null; enquiryId: string | null; contactId: string | null; staffName: string }): Promise<CheckResult | { error: string }> {
  const k = anthropicKey()
  if ('error' in k) return { error: k.error }
  const facts = await emailFacts({ propertyId: r.propertyId, enquiryId: r.enquiryId, threadId: null, contactId: r.contactId, staffName: r.staffName }).catch(() => '')
  const ask = [
    `The email: ${r.what}.`,
    `Subject: ${r.subject || '(none)'}`,
    r.preheader ? `Preview line (the grey text after the subject in an inbox): ${r.preheader}` : null,
    `The email as the reader will see it:\n${r.text.slice(0, 14000)}`,
    r.links.length ? `Its links:\n${r.links.slice(0, 25).join('\n')}` : null,
    facts ? `The facts we hold:\n${facts}` : 'We have no other facts for this email: check it on its own.',
  ].filter(Boolean).join('\n\n')
  const client = new Anthropic({ apiKey: k.key })
  try {
    const res = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'medium', format: betaZodOutputFormat(Check) },
      messages: [{ role: 'user', content: ask }],
    })
    await recordUsage('claude-opus-5-5', res.usage, 'email check')
    if (res.stop_reason === 'refusal' || !res.parsed_output) return { error: 'The check couldn’t run on this email. Try again.' }
    const out = res.parsed_output
    return { ready: out.ready && !out.issues.some((i) => i.severity === 'fix'), summary: out.summary.trim(), issues: out.issues.slice(0, 8) }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: 'The ANTHROPIC_API_KEY on the server isn’t valid. Check it in Render’s environment settings.' }
    if (e instanceof Anthropic.RateLimitError) return { error: 'Too many requests just now. Wait a minute and try again.' }
    if (e instanceof Anthropic.APIError) return { error: `The check couldn’t run (${e.status ?? 'no answer'}). Try again in a minute.` }
    console.error('email check failed', e)
    return { error: 'The check couldn’t run. Try again.' }
  }
}

// ---------- applying the fixes ----------

/** A part of the email staff can edit: its key, what it is, and what it says now (with any {placeholders}). */
export type EditableField = { key: string; label: string; value: string; note?: string }
export type FixIssue = CheckResult['issues'][number]

const Fixed = z.object({
  changes: z.array(z.object({
    key: z.string().describe('The key of the field you changed, exactly as given'),
    value: z.string().describe('The whole new text of that field'),
  })).describe('Only the fields you changed'),
  done: z.array(z.string()).describe('Each change you made, in a few plain words, e.g. "Subject now names Ealing Broadway"'),
  left: z.array(z.object({
    where: z.string().describe('Where in the email, as in the issue'),
    todo: z.string().describe('What staff should do instead, in one plain sentence, e.g. "Edit the listing’s title on its property page"'),
  })).describe('Issues that can’t be fixed by editing these fields (they come from the listing, our records or the layout)'),
})
export type FixResult = { changes: { key: string; value: string }[]; done: string[]; left: { where: string; todo: string }[] }

const FIX_SYSTEM = `You are the senior editor at Preston Hill Estates, an independent estate agent at 271 Preston Road, Harrow. A careful check of an email found the issues below. Your job is to make the fixes in the parts of the email staff can edit, and say plainly which issues can't be fixed there.

Rules:
- Change only what the issues need, and leave everything else in a field exactly as it was: the same wording, paragraphs, line breaks and formatting (**bold**, "- " bullets, *gold words* in headings).
- Keep every placeholder exactly as written: {first_name}, {name}, {first name}, {sender} and the like are filled in for each reader, so the check saw them already filled. If the issue is about how a placeholder reads, change the wording around it. The one exception is {spotlight} (it becomes the featured home's short title): you may replace it with better plain words when the issue is about it.
- Every fact must come from the facts we hold or the email itself. Never invent a figure, feature, distance, date or claim; if a fix needs a fact we don't hold, leave it and list it under "left".
- British English, warm and professional; no clichés or pressure ("won't last", "act fast").
- Make every "fix" you can; make a "consider" only when it clearly improves the email.
- Some parts are built automatically from our listings and records (property cards, the facts line under a price, sold prices, nearby stations and places, buttons). You can't edit those here: list each such issue under "left" with what staff should do instead (e.g. edit the listing on its property page, untick that property, or choose another home).`

export async function fixEmail(r: { what: string; issues: FixIssue[]; fields: EditableField[]; subject: string; text: string; propertyId: string | null; enquiryId: string | null; contactId: string | null; staffName: string }): Promise<FixResult | { error: string }> {
  const k = anthropicKey()
  if ('error' in k) return { error: k.error }
  if (!r.fields.length) return { changes: [], done: [], left: r.issues.map((i) => ({ where: i.where, todo: i.suggestion })) }
  const facts = await emailFacts({ propertyId: r.propertyId, enquiryId: r.enquiryId, threadId: null, contactId: r.contactId, staffName: r.staffName }).catch(() => '')
  const ask = [
    `The email: ${r.what}.`,
    `The issues the check found:\n${r.issues.map((i, n) => `${n + 1}. [${i.severity}] ${i.where}: ${i.problem} Suggested: ${i.suggestion}`).join('\n')}`,
    `The parts staff can edit (key, what it is, and its text now):\n${r.fields.map((f) => `<field key="${f.key}" what="${f.label}${f.note ? ` (${f.note})` : ''}">\n${f.value}\n</field>`).join('\n')}`,
    `The whole email as the reader saw it (for context; only the fields above can change):\nSubject: ${r.subject}\n\n${r.text.slice(0, 12000)}`,
    facts ? `The facts we hold:\n${facts}` : null,
  ].filter(Boolean).join('\n\n')
  const client = new Anthropic({ apiKey: k.key })
  try {
    const res = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: FIX_SYSTEM,
      output_config: { effort: 'medium', format: betaZodOutputFormat(Fixed) },
      messages: [{ role: 'user', content: ask }],
    })
    await recordUsage('claude-opus-5-5', res.usage, 'email fixes')
    if (res.stop_reason === 'refusal' || !res.parsed_output) return { error: 'The fixes couldn’t be made this time. Try again.' }
    const out = res.parsed_output
    const known = new Map(r.fields.map((f) => [f.key, f.value]))
    // Only real fields, only real changes, and nobody's name lost on the way ({spotlight} may become plain words).
    const holders = (t: string) => new Set(t.match(/\{(first_name|first name|name)\}/gi) ?? [])
    const changes = out.changes.filter((c) => known.has(c.key) && c.value.trim() && c.value !== known.get(c.key))
      .filter((c) => [...holders(known.get(c.key)!)].every((h) => c.value.includes(h)))
    return { changes, done: out.done.slice(0, 10), left: out.left.slice(0, 8) }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: 'The ANTHROPIC_API_KEY on the server isn’t valid. Check it in Render’s environment settings.' }
    if (e instanceof Anthropic.RateLimitError) return { error: 'Too many requests just now. Wait a minute and try again.' }
    if (e instanceof Anthropic.APIError) return { error: `The fixes couldn’t be made (${e.status ?? 'no answer'}). Try again in a minute.` }
    console.error('email fix failed', e)
    return { error: 'The fixes couldn’t be made. Try again.' }
  }
}
