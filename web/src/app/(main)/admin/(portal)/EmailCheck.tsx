'use client'

import { useRef, useState } from 'react'
import type { CheckResult, EditableField, FixResult } from '@/lib/email-check'
import { aiCheck, aiFix } from '../ai-actions'

type Ctx = { propertyId?: string | null; enquiryId?: string | null; contactId?: string | null }
type Email = { subject: string; preheader?: string; html: string }
/** The parts of the email staff can edit, and how to put new words into them. */
export type Editable = { fields: EditableField[]; apply: (values: Record<string, string>) => void }

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
 * email waits. "Fix these for me" makes the changes in the parts staff can edit (and says what has to be changed
 * elsewhere); pressing Send then checks the new version. Pressing Send again on an unchanged email sends it as it is.
 */
export function useEmailCheck(ctx: Ctx, what: string, edit?: Editable) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CheckResult | { error: string } | null>(null)
  const [fixing, setFixing] = useState(false)
  const [fixed, setFixed] = useState<(FixResult & { before: Record<string, string> }) | { error: string } | null>(null)
  const checkedFor = useRef('')
  const lastEmail = useRef<Email | null>(null)

  async function run(email: Email) {
    setBusy(true); setResult(null); setFixed(null)
    const { text, links } = readable(email.html)
    const r = await aiCheck({ what, subject: email.subject, preheader: email.preheader ?? '', text, links, propertyId: ctx.propertyId ?? null, enquiryId: ctx.enquiryId ?? null, contactId: ctx.contactId ?? null })
      .catch(() => ({ error: 'The check couldn’t be reached.' }))
    setBusy(false); setResult(r)
    checkedFor.current = hashOf(email)
    lastEmail.current = email
    return r
  }
  /** Before sending: true to go ahead. */
  async function ensure(email: Email): Promise<boolean> {
    if (checkedFor.current === hashOf(email)) return true // checked already, and staff have seen what it said
    const r = await run(email)
    return !('error' in r) && r.ready
  }
  async function fix() {
    if (!edit || !result || 'error' in result || !lastEmail.current) return
    setFixing(true); setFixed(null)
    const email = lastEmail.current
    const fields = edit.fields.filter((f) => f.key)
    const r = await aiFix({ what, issues: result.issues, fields, subject: email.subject, text: readable(email.html).text, propertyId: ctx.propertyId ?? null, enquiryId: ctx.enquiryId ?? null, contactId: ctx.contactId ?? null })
      .catch(() => ({ error: 'The fixes couldn’t be reached.' }))
    setFixing(false)
    if ('error' in r) { setFixed(r); return }
    const before = Object.fromEntries(fields.filter((f) => r.changes.some((c) => c.key === f.key)).map((f) => [f.key, f.value]))
    if (r.changes.length) edit.apply(Object.fromEntries(r.changes.map((c) => [c.key, c.value])))
    setFixed({ ...r, before })
  }
  function undo() {
    if (!edit || !fixed || 'error' in fixed) return
    edit.apply(fixed.before)
    setFixed(null)
  }
  const issues = (r: CheckResult) => r.issues.length ? (
    <ul className="ec-list">
      {r.issues.map((x, i) => (
        <li key={i}><span className={`ec-tag ${x.severity}`}>{x.severity === 'fix' ? 'Fix' : 'Consider'}</span> <b>{x.where}:</b> {x.problem} <span className="ec-fix">→ {x.suggestion}</span></li>
      ))}
    </ul>
  ) : null
  const panel = (email: Email) => (
    <div className="ec">
      {busy ? <p className="ec-busy">Checking the whole email before it goes… (about 15 seconds)</p>
        : fixing ? <p className="ec-busy">Making the changes… (about 20 seconds)</p>
          : fixed && !('error' in fixed) ? (
            <div className="ec-box fixed">
              <p className="ec-sum"><b>{fixed.changes.length ? '✓ Changes made.' : 'Nothing could be changed in the wording.'}</b> {fixed.changes.length ? 'Have a look at the preview. Press Send and it checks the new version once more first.' : ''}</p>
              {fixed.done.length ? <ul className="ec-list done">{fixed.done.map((d, i) => <li key={i}><span className="ec-tag ok">Done</span> {d}</li>)}</ul> : null}
              {fixed.left.length ? (
                <>
                  <p className="ec-sub">Still to do yourself (these come from the listing or how the email is built, not its wording):</p>
                  <ul className="ec-list">{fixed.left.map((x, i) => <li key={i}><span className="ec-tag consider">To do</span> <b>{x.where}:</b> {x.todo}</li>)}</ul>
                </>
              ) : null}
              <p className="ec-actions">
                {fixed.changes.length ? <button type="button" className="ec-run" onClick={undo}>↶ Undo the changes</button> : null}
                <button type="button" className="ec-run" onClick={() => run(email)}>✓ Check it again</button>
              </p>
            </div>
          ) : result ? (
            'error' in result ? <p className="ec-err">{result.error} Press Send again to send it without the check.</p> : (
              <div className={`ec-box${result.ready ? ' ok' : ''}`}>
                <p className="ec-sum"><b>{result.ready ? '✓ Checked:' : 'Before it goes:'}</b> {result.summary}</p>
                {issues(result)}
                {fixed && 'error' in fixed ? <p className="ec-err">{fixed.error}</p> : null}
                {result.issues.length && edit ? (
                  <p className="ec-actions"><button type="button" className="btn btn-primary btn-sm" onClick={fix}>✦ Fix these for me</button></p>
                ) : null}
                {!result.ready ? <p className="ec-hint">{edit ? 'Let the AI make the changes, or fix them yourself and press Send (it checks again). ' : 'Fix these and press Send (it checks again). '}Pressing Send again without changes sends it as it is.</p> : null}
              </div>
            )
          ) : (
            <button type="button" className="ec-run" onClick={() => run(email)}>✓ Check this email</button>
          )}
    </div>
  )
  return { ensure, busy: busy || fixing, panel }
}
