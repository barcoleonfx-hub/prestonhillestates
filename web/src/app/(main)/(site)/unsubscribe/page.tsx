import { redirect } from 'next/navigation'
import { checkUnsubscribe } from '@/lib/property-email-data'
import { optOut } from '@/lib/unsubscribe'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Stop property emails', robots: { index: false } }

async function confirm(form: FormData) {
  'use server'
  const c = String(form.get('c') ?? ''), t = String(form.get('t') ?? '')
  const ok = await optOut(c, t)
  redirect(ok ? '/unsubscribe?done=1' : '/unsubscribe?bad=1')
}

export default async function Unsubscribe({ searchParams }: { searchParams: Promise<{ c?: string; t?: string; done?: string; bad?: string }> }) {
  const sp = await searchParams
  const valid = !!(sp.c && sp.t && checkUnsubscribe(sp.c, sp.t))
  return (
    <div className="wrap" style={{ maxWidth: 620, padding: '64px 20px 90px' }}>
      {sp.done ? (
        <>
          <h1 style={{ fontSize: "2rem", marginBottom: 14 }}>You won’t get property emails from us again</h1>
          <p>We’ve updated our records. If you call or email us about a home, we’ll still reply as normal.</p>
          <p>Changed your mind? Call the branch on <a href="tel:+442089049005">020 8904 9005</a>.</p>
        </>
      ) : valid ? (
        <>
          <h1 style={{ fontSize: "2rem", marginBottom: 14 }}>Stop emails about homes for you?</h1>
          <p>We only email when a home comes on that matches what you asked us about. Press the button and we’ll stop.</p>
          <form action={confirm} style={{ marginTop: 22 }}>
            <input type="hidden" name="c" value={sp.c} />
            <input type="hidden" name="t" value={sp.t} />
            <button type="submit" className="btn btn-gold">Stop property emails</button>
          </form>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: "2rem", marginBottom: 14 }}>That link didn’t work</h1>
          <p>It may have been cut short. Reply to any of our emails with “unsubscribe”, or call <a href="tel:+442089049005">020 8904 9005</a>, and we’ll take you off the list.</p>
        </>
      )}
    </div>
  )
}
