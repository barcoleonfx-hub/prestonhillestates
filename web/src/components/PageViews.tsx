'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

let first = true
let last = { path: '', at: 0 }

/** Counts each page seen on the website, for the portal's Website stats. No cookies; nothing kept on the device. */
export function PageViews() {
  const path = usePathname()
  useEffect(() => {
    // The same page reported twice in a moment (React runs effects twice while developing) counts once.
    if (!path || (last.path === path && Date.now() - last.at < 2000)) return
    last = { path, at: Date.now() }
    const q = new URLSearchParams(window.location.search)
    const body = JSON.stringify({ path, ref: first ? document.referrer : '', first, utm_source: first ? q.get('utm_source') : null, utm_medium: first ? q.get('utm_medium') : null })
    first = false
    fetch('/api/public/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  }, [path])
  return null
}
