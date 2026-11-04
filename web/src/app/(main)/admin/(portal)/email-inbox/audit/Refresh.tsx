'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Reloads the page data every few seconds while the audit runs. */
export function Refresh({ every = 3000 }: { every?: number }) {
  const router = useRouter()
  useEffect(() => { const t = setInterval(() => router.refresh(), every); return () => clearInterval(t) }, [router, every])
  return null
}
