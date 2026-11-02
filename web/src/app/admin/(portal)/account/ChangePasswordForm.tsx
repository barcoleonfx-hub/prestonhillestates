'use client'
import { useActionState } from 'react'
import { changeOwnPassword, type StaffState } from '../../staff-actions'

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<StaffState, FormData>(changeOwnPassword, {})
  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
      <div className="field"><label htmlFor="pw-current">Current password</label><input className="input" id="pw-current" name="current" type="password" autoComplete="current-password" required /></div>
      <div className="field"><label htmlFor="pw-next">New password</label><input className="input" id="pw-next" name="next" type="password" autoComplete="new-password" minLength={10} required /><span className="hint">At least 10 characters.</span></div>
      <div className="field"><label htmlFor="pw-confirm">New password again</label><input className="input" id="pw-confirm" name="confirm" type="password" autoComplete="new-password" required /></div>
      {state.error ? <div className="notice err" role="alert">{state.error}</div> : null}
      {state.ok ? <div className="notice ok" role="status">Password changed.</div> : null}
      <button className="btn btn-gold" type="submit" disabled={pending} style={{ alignSelf: 'flex-start' }}>{pending ? 'Saving…' : 'Change password'}</button>
    </form>
  )
}
