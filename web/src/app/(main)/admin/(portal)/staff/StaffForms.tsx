'use client'
import { useActionState } from 'react'
import { addStaff, resetStaffPassword, type StaffState } from '../../staff-actions'

function PasswordNotice({ email, password }: { email: string; password: string }) {
  return (
    <div className="notice ok" role="status" style={{ marginTop: 12 }}>
      Starting password for <b>{email}</b>: <code style={{ fontSize: '1rem', userSelect: 'all' }}>{password}</code>
      <br />Share it with them privately. It won’t be shown again.
    </div>
  )
}

export function AddStaffForm() {
  const [state, action, pending] = useActionState<StaffState, FormData>(addStaff, {})
  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
      <div className="field"><label htmlFor="st-name">Name</label><input className="input" id="st-name" name="name" required /></div>
      <div className="field"><label htmlFor="st-email">Email</label><input className="input" id="st-email" name="email" type="email" required /></div>
      <div className="field"><label htmlFor="st-phone">Mobile <span className="hint">(optional)</span></label><input className="input" id="st-phone" name="phone" type="tel" /></div>
      <div className="field">
        <span className="flabel">Role</span>
        <div className="seg" role="radiogroup" aria-label="Role">
          <label><input type="radio" name="role" value="negotiator" defaultChecked /><span>Negotiator</span></label>
          <label><input type="radio" name="role" value="admin" /><span>Admin</span></label>
        </div>
        <span className="hint">Admins can also manage staff accounts.</span>
      </div>
      {state.error ? <div className="notice err" role="alert">{state.error}</div> : null}
      <button className="btn btn-gold" type="submit" disabled={pending} style={{ alignSelf: 'flex-start' }}>{pending ? 'Adding…' : 'Add staff member'}</button>
      {state.ok && state.password ? <PasswordNotice email={state.email!} password={state.password} /> : null}
    </form>
  )
}

export function ResetPasswordButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<StaffState, FormData>(resetStaffPassword, {})
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button className="btn btn-ghost btn-sm" type="submit" disabled={pending}
        onClick={(e) => { if (!confirm('Give this person a new starting password? Their current one stops working.')) e.preventDefault() }}>
        Reset password
      </button>
      {state.ok && state.password ? <PasswordNotice email={state.email!} password={state.password} /> : null}
      {state.error ? <div className="notice err">{state.error}</div> : null}
    </form>
  )
}
