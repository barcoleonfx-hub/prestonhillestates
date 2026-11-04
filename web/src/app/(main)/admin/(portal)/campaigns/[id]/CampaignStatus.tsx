'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { progressOf, setCampaignStatus } from '../../../campaign-actions'

type P = { status: string; total: number; sent: number; failed: number; queued: number; lastError: string | null }

/** Live progress while a campaign sends in the background, with pause, carry on and stop. */
export function CampaignStatus({ id, initial, isAdmin, perDay }: { id: string; initial: P; isAdmin: boolean; perDay: number }) {
  const [p, setP] = useState<P>(initial)
  const [pending, start] = useTransition()
  const router = useRouter()
  useEffect(() => {
    if (p.status !== 'sending') return
    const t = setInterval(async () => { const n = await progressOf(id).catch(() => null); if (n) setP(n) }, 10_000)
    return () => clearInterval(t)
  }, [id, p.status])
  const pctDone = p.total ? Math.round(((p.sent + p.failed) / p.total) * 100) : 0
  const daysLeft = p.queued ? Math.ceil(p.queued / perDay) : 0
  const act = (to: 'paused' | 'sending' | 'cancelled') => start(async () => {
    if (to === 'cancelled' && !window.confirm('Stop this campaign? The people not yet emailed won’t get it.')) return
    await setCampaignStatus(id, to)
    const n = await progressOf(id); if (n) setP(n)
    router.refresh()
  })
  const label = { sending: 'Sending', paused: 'Paused', sent: 'Finished', cancelled: 'Stopped' }[p.status] ?? p.status
  return (
    <section className="card card-pad cmp-status" style={{ marginBottom: 18 }} aria-live="polite">
      <div className="today-head">
        <div>
          <h2>{label} · {p.sent.toLocaleString('en-GB')} of {p.total.toLocaleString('en-GB')} sent</h2>
          <p className="card-sub">
            {p.status === 'sending' ? `About 12 go out every 2 minutes, up to ${perDay} a day${daysLeft > 1 ? `, so the rest will take about ${daysLeft} days` : ''}. You can close this page.` : ''}
            {p.failed ? ` ${p.failed} couldn’t be sent (bad address or unsubscribed since).` : ''}
          </p>
        </div>
        {isAdmin ? (
          <div className="actions">
            {p.status === 'sending' ? <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act('paused')}>Pause</button> : null}
            {p.status === 'paused' ? <button className="btn btn-gold btn-sm" disabled={pending} onClick={() => act('sending')}>Carry on sending</button> : null}
            {p.status === 'sending' || p.status === 'paused' ? <button className="btn btn-danger btn-sm" disabled={pending} onClick={() => act('cancelled')}>Stop</button> : null}
          </div>
        ) : null}
      </div>
      <div className="cmp-bar" role="progressbar" aria-valuenow={pctDone} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pctDone}%` }} /></div>
      {p.lastError ? <div className="notice err" style={{ marginTop: 12 }}>{p.lastError}</div> : null}
    </section>
  )
}
