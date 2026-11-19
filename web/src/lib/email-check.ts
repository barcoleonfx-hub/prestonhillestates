import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
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
