import { requireAdmin } from '@/lib/auth'
import { ChangePasswordForm } from './ChangePasswordForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your account' }

export default async function AccountPage() {
  const me = await requireAdmin()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your account</h1>
          <p className="sub">{me.name} · {me.email} · {me.role === 'admin' ? 'Admin' : 'Negotiator'}</p>
        </div>
      </div>
      <section className="card card-pad" style={{ maxWidth: 520 }}>
        <h2>Change your password</h2>
        <ChangePasswordForm />
      </section>
    </>
  )
}
