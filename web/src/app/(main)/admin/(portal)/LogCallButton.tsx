'use client'
import { openCallLog, type CallPrefill } from './CallDrawer'

export function LogCallButton({ prefill, label = 'Log a call', className = 'btn btn-gold btn-sm' }: { prefill?: CallPrefill; label?: string; className?: string }) {
  return <button type="button" className={className} onClick={() => openCallLog(prefill)}>{label}</button>
}
