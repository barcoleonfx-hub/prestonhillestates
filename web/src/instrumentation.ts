// Runs once when the server starts. Every 2 minutes it calls the portal's own scheduled-jobs endpoint,
// so reminders, callbacks, new mailbox enquiries and the 2-year clean-up happen even when nobody has the
// portal open. Each job checks for itself whether it's due, so extra calls are harmless.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return
  // A background job that fails without being caught should be logged, not take the whole website down.
  process.on('unhandledRejection', (e) => console.error('unhandled rejection in a background job', e))
  const secret = process.env.CRON_SECRET
  if (!secret) return
  const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/cron/reminders`
  const tick = () => {
    fetch(url, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(110_000) }).catch(() => {})
  }
  setTimeout(tick, 45_000).unref?.()
  setInterval(tick, 120_000).unref?.()
}
