'use client'

import { useEffect } from 'react'

/** Tells us the report was read: only after 4 seconds on screen in a real browser (link previews never run this). */
export function ViewBeacon({ token }: { token: string }) {
  useEffect(() => {
    let sent = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = () => {
      if (sent || timer || document.visibilityState !== 'visible') return
      timer = setTimeout(() => {
        if (sent || document.visibilityState !== 'visible') { timer = null; return }
        sent = true
        fetch('/api/public/report-view', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }), keepalive: true }).catch(() => {})
      }, 4000)
    }
    const onVis = () => { if (document.visibilityState !== 'visible' && timer) { clearTimeout(timer); timer = null } else arm() }
    arm()
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); if (timer) clearTimeout(timer) }
  }, [token])
  return null
}
