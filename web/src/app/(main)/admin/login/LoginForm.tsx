'use client'
import { useActionState } from 'react'
import { login } from '../actions'

export function LoginForm() {
  const [state, action, pending] = useActionState(login, { error: '' })
  return (
    <form action={action}>
      {state.error ? <div className="notice err" role="alert">{state.error}</div> : null}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="username" required defaultValue={state.email} key={state.email} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn btn-gold" type="submit" disabled={pending} style={{ marginTop: 6 }}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
