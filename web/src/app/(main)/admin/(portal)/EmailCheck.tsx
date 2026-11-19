'use client'

import { useRef, useState } from 'react'
import type { CheckResult } from '@/lib/email-check'
import { aiCheck } from '../ai-actions'

type Ctx = { propertyId?: string | null; enquiryId?: string | null; contactId?: string | null }
type Email = { subject: string; preheader?: string; html: string }

/** The email as the reader sees it, in plain text, and its links (for the check). */
function readable(html: string): { text: string; links: string[] } {
  const links = [...new Set([...html.matchAll(/href="([^"#][^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&')))]
  const stripped = html
    .replace(/<(style|head|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<td[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
  const el = document.createElement('textarea')
  el.innerHTML = stripped
  const text = el.value.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text, links }
}
const hashOf = (e: Email) => { const s = `${e.subject}\u0001${e.preheader ?? ''}\u0001${e.html}`; let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h) }

/**
 * The check before an email goes: a careful AI read of the whole finished email (subject, preview line and every
 * section) against the facts we hold. Pressing Send checks first; if something should be fixed it's shown and the
 * email waits. Pressing Send again sends it as it is; any change means a fresh check.
 */
export function useEmailCheck(ctx: Ctx, what: string) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CheckResult | { error: string } | null>(null)
  const checkedFor = useRef('')

  async function run(email: Email) {
    setBusy(true); setResult(null)
    const { text, links } = readable(email.html)
    const r = await aiCheck({ what, subject: email.subject, preheader: email.preheader ?? '', text, links, propertyId: ctx.propertyId ?? null, enquiryId: ctx.enquiryId ?? null, contactId: ctx.contactId ?? null })
      .catch(() => ({ error: 'The check couldn’t be reached.' }))
    setBusy(false); setResult(r)
    checkedFor.current = hashOf(email)
    return r
  }
  /** Before sending: true to go ahead. */
  async function ensure(email: Email): Promise<boolean> {
    if (checkedFor.current === hashOf(email)) return true // checked already, and staff have seen what it said
    const r = await run(email)
    return !('error' in r) && r.ready
  }
  const panel = (email: Email) => (
    <div className="ec">
      {busy ? <p className="ec-busy">Checking the whole email before it goes… (about 15 seconds)</p> : result ? (
        'error' in result ? <p className="ec-err">{result.error} Press Send again to send it without the check.</p> : (
          <div className={`ec-box${result.ready ? ' ok' : ''}`}>
            <p className="ec-sum"><b>{result.ready ? '✓ Checked:' : 'Before it goes:'}</b> {result.summary}</p>
            {result.issues.length ? (
              <ul className="ec-list">
                {result.issues.map((x, i) => (
                  <li key={i}><span className={`ec-tag ${x.severity}`}>{x.severity === 'fix' ? 'Fix' : 'Consider'}</span> <b>{x.where}:</b> {x.problem} <span className="ec-fix">→ {x.suggestion}</span></li>
                ))}
              </ul>
            ) : null}
            {!result.ready ? <p className="ec-hint">Fix these and press Send (it checks again), or press Send again to send it as it is.</p> : null}
          </div>
        )
      ) : (
        <button type="button" className="ec-run" onClick={() => run(email)}>✓ Check this email</button>
      )}
    </div>
  )
  return { ensure, busy, panel }
}
