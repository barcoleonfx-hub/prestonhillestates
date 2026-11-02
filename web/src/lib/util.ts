import { randomUUID } from 'node:crypto'

export const uid = () => randomUUID()
export const now = () => new Date().toISOString()

export function kebab(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function formatGBP(n: number | null | undefined): string {
  if (n == null) return ''
  return '£' + n.toLocaleString('en-GB', { maximumFractionDigits: 0 })
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return ''
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
