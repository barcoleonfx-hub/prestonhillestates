import 'server-only'
import type { LatLon } from './geo'
import { cached } from './lookup-cache'

// Tube and train journey times into London from a home, door to door (the walk to the station included), from
// TfL's Journey Planner (free, open data; powered by TfL Open Data). Asked for a weekday morning, kept for a week.
// An app key is optional (TFL_APP_KEY); without one TfL allows a modest number of requests, plenty for booklets.

export const TUBE_TO: { name: string; stop: string }[] = [
  { name: 'Baker Street', stop: '940GZZLUBST' },
  { name: 'Oxford Circus', stop: '940GZZLUOXC' },
  { name: 'King’s Cross', stop: '940GZZLUKSX' },
  { name: 'Bank', stop: '940GZZLUBNK' },
  { name: 'Canary Wharf', stop: '940GZZLUCYF' },
]

export type TubeTime = { name: string; minutes: number; via: string[] }

type Journey = { duration?: number; legs?: { mode?: { id?: string; name?: string }; routeOptions?: { name?: string }[] }[] }

/** The quickest journey in TfL's answer, and the lines it uses ("Metropolitan", "Jubilee"…). */
export function parseJourney(body: { journeys?: Journey[] }): { minutes: number; via: string[] } | null {
  const best = (body.journeys ?? []).filter((j) => typeof j.duration === 'number' && j.duration > 0).sort((a, b) => a.duration! - b.duration!)[0]
  if (!best) return null
  const via = [...new Set((best.legs ?? []).filter((l) => l.mode?.id && !['walking', 'cycle', 'bus'].includes(l.mode.id)).map((l) => l.routeOptions?.[0]?.name || l.mode?.name || '').filter(Boolean))]
  return { minutes: best.duration!, via }
}

/** Next Tuesday, so it's always a normal weekday timetable. */
function nextTuesday() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + ((9 - d.getUTCDay()) % 7 || 7))
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

async function journey(from: LatLon, stop: string): Promise<{ minutes: number; via: string[] } | null> {
  const key = process.env.TFL_APP_KEY ? `&app_key=${encodeURIComponent(process.env.TFL_APP_KEY)}` : ''
  const url = `https://api.tfl.gov.uk/Journey/JourneyResults/${from.lat.toFixed(5)},${from.lon.toFixed(5)}/to/${stop}?date=${nextTuesday()}&time=0930&timeIs=Departing&journeyPreference=LeastTime&mode=tube,overground,elizabeth-line,national-rail,dlr,walking${key}`
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'PrestonHillEstates/1.0' }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`TfL answered ${res.status}`)
  return parseJourney((await res.json()) as { journeys?: Journey[] })
}

/** Door-to-door times by tube and train to central London from the home, quickest first by destination order. */
export async function tubeTimes(home: LatLon): Promise<{ times: TubeTime[]; error: string | null }> {
  const r = await cached<TubeTime[]>(`tfl:${home.lat.toFixed(4)},${home.lon.toFixed(4)}`, 7, async () => {
    const answers = await Promise.allSettled(TUBE_TO.map((d) => journey(home, d.stop)))
    const times = answers.map((a, i) => (a.status === 'fulfilled' && a.value ? { name: TUBE_TO[i].name, ...a.value } : null)).filter((x): x is TubeTime => !!x)
    if (!times.length) {
      const why = answers.find((a) => a.status === 'rejected') as PromiseRejectedResult | undefined
      throw new Error(why ? String(why.reason?.message ?? why.reason) : 'TfL found no journeys')
    }
    return times
  })
  return { times: r.data ?? [], error: r.error }
}
