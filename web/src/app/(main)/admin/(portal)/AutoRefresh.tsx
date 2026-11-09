'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Keeps a list up to date while it's open: fetches it again every `seconds` (and when the tab comes back into view),
 * but never while someone is typing in it.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a as HTMLElement).isContentEditable) }
    const tick = () => { if (document.visibilityState === 'visible' && !typing() && !document.querySelector('.eo-req, dialog[open]')) router.refresh() }
    const t = setInterval(tick, seconds * 1000)
    const onShow = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onShow)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onShow) }
  }, [router, seconds])
  return null
}
