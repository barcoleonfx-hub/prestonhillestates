'use client'

import { OFFICE_WHATSAPP, waLink } from '@/lib/whatsapp'

/** Counts a tap on a WhatsApp button (just "a tap, on this page": nothing about the person). */
export function countWhatsAppTap(detail?: string) {
  try {
    const body = JSON.stringify({ kind: 'whatsapp_click', page: window.location.pathname, detail: detail ?? null })
    if (!navigator.sendBeacon?.('/api/public/event', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/public/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }
  } catch { /* never get in the way of the link */ }
}

/** A link that opens WhatsApp to the office with a message ready, and counts the tap. */
export function WhatsAppLink({ text, detail, className, children }: { text: string; detail?: string; className?: string; children: React.ReactNode }) {
  return (
    <a className={className} href={waLink(OFFICE_WHATSAPP, text)} target="_blank" rel="noopener noreferrer" onClick={() => countWhatsAppTap(detail)}>
      {children}
    </a>
  )
}
