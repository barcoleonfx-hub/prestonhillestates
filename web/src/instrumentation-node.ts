// Node-only start-up work, loaded from instrumentation.ts (kept separate so the Edge build never sees it).
export function startNode() {
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
