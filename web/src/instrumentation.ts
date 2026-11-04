// Runs once when the server starts. Every 2 minutes it calls the portal's own scheduled-jobs endpoint,
// so reminders, callbacks, new mailbox enquiries and the 2-year clean-up happen even when nobody has the
// portal open. Each job checks for itself whether it's due, so extra calls are harmless.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return
  const { startNode } = await import('./instrumentation-node')
  startNode()
}
