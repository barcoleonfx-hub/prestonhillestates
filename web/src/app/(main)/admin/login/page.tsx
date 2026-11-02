import { redirect } from 'next/navigation'
import { currentAdmin } from '@/lib/auth'
import { LogoMark } from '@/components/Logo'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in' }

export default async function LoginPage() {
  if (await currentAdmin()) redirect('/admin')
  return (
    <main className="login-wrap">
      <div className="card login-card">
        <div className="logo">
          <LogoMark />
          <div>
            <div style={{ fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.9rem' }}>PRESTON HILL</div>
            <div style={{ letterSpacing: '0.26em', fontSize: '0.78rem', color: 'var(--ink-soft)' }}>ESTATES</div>
          </div>
        </div>
        <h1>Property portal</h1>
        <p style={{ color: 'var(--faint)', fontSize: '0.9rem', marginTop: 6 }}>Sign in to manage listings, photos and enquiries.</p>
        <LoginForm />
      </div>
    </main>
  )
}
