// Time helpers shared by server and browser. Appointments are stored as UTC ISO strings and always shown in UK time.

export const TZ = 'Europe/London'

/** Minutes that London is ahead of UTC at the given instant (0 in winter, 60 in summer). */
function londonOffsetMin(at: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(at))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((asUtc - Math.floor(at / 60000) * 60000) / 60000)
}

/** "2026-11-04" + "14:30" in UK time → UTC ISO string. Returns null for invalid input. */
export function londonToIso(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const naive = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2])
  if (Number.isNaN(naive)) return null
  let utc = naive - londonOffsetMin(naive) * 60000
  utc = naive - londonOffsetMin(utc) * 60000 // second pass settles the clock-change edge
  return new Date(utc).toISOString()
}

/** UTC ISO → { date: "YYYY-MM-DD", time: "HH:MM" } in UK time. */
export function isoToLondon(iso: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

export const todayLondon = () => isoToLondon(new Date().toISOString()).date

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })

export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })

export const fmtDayShort = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })

export const fmtWhen = (iso: string) => `${fmtDay(iso)} at ${fmtTime(iso)}`

/** Label a London date relative to today: "Today", "Tomorrow", or "Wed 4 Nov". */
export function dayLabel(date: string, today = todayLondon()): string {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  return fmtDayShort(`${date}T12:00:00Z`)
}

export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} hr ${m} min` : `${h} hr${h > 1 ? 's' : ''}`
}

export const endIso = (startsAt: string, durationMin: number) =>
  new Date(new Date(startsAt).getTime() + durationMin * 60000).toISOString()
