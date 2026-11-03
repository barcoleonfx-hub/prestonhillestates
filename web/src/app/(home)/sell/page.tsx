import { redirect } from 'next/navigation'

// /sell is what people (and other agents' sites) tend to use; the valuation page does the job.
export default async function Sell({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === 'string'))
  redirect(`/valuation${q.size ? `?${q}` : ''}`)
}
