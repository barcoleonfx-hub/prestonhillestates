'use client'
import { startTransition, useActionState, useState } from 'react'
import { connectMailbox, type MailboxFormState } from '../../mailbox-actions'

export function ConnectForm({ user, host, port, includePeople, hasPassword }: { user: string; host: string; port: number; includePeople: boolean; hasPassword: boolean }) {
  const [state, dispatch, pending] = useActionState<MailboxFormState, FormData>(connectMailbox, {})
  const [advanced, setAdvanced] = useState(!/livemail\.co\.uk$/.test(host) || port !== 993)
  return (
    <form className="mb-form" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => dispatch(fd)) }}>
      <div className="mb-grid">
        <div className="field">
          <label htmlFor="mb-user">Mailbox email address</label>
          <input className="input" id="mb-user" name="user" type="email" defaultValue={user} placeholder="info@prestonhillestates.com" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="mb-pass">Mailbox password</label>
          <input className="input" id="mb-pass" name="pass" type="password" autoComplete="current-password" placeholder={hasPassword ? 'Saved. Leave blank to keep it' : 'The password you use for this email'} />
        </div>
      </div>
      {advanced ? (
        <div className="mb-grid">
          <div className="field">
            <label htmlFor="mb-host">Incoming mail server (IMAP)</label>
            <input className="input" id="mb-host" name="host" defaultValue={host} />
          </div>
          <div className="field">
            <label htmlFor="mb-port">Port</label>
            <input className="input" id="mb-port" name="port" type="number" defaultValue={port} />
          </div>
        </div>
      ) : (
        <>
          <input type="hidden" name="host" value={host} />
          <input type="hidden" name="port" value={port} />
          <p className="card-sub">Server: found automatically (Fasthosts: {host}, port {port}). <button type="button" className="linkish" onClick={() => setAdvanced(true)}>Change</button></p>
        </>
      )}
      <label className="mb-check">
        <input type="checkbox" name="includePeople" defaultChecked={includePeople} />
        <span>Also pick up emails written directly by people (not just Zoopla, OnTheMarket and website forms) when they mention buying, renting, a viewing or a valuation</span>
      </label>
      {state.error ? <div className="notice err" role="alert">{state.error}{state.detail ? <p className="mb-detail">{state.detail}</p> : null}</div> : null}
      {state.ok ? (
        <div className="notice ok" role="status">
          Connected to {state.host}{state.port && state.port !== 993 ? `:${state.port}` : ''}{state.messages != null ? ` · ${state.messages.toLocaleString()} emails in the inbox` : ''}.
          {state.found != null ? ` ${state.found ? `${state.found} new enquir${state.found === 1 ? 'y' : 'ies'} picked up from the last 3 days.` : 'No new enquiries in the last 3 days that weren’t already in the portal.'}` : ''}
        </div>
      ) : null}
      <div><button className="btn btn-gold" type="submit" disabled={pending}>{pending ? 'Connecting… this can take 20 seconds' : 'Test and connect'}</button></div>
    </form>
  )
}
