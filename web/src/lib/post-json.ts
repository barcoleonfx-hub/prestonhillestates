// Sends a website form to our server. If the site is restarting (each update takes it down for a minute or so) or
// the connection drops, it quietly tries again every 5 seconds for about half a minute before giving up.
// Safe in the browser: no server imports.

export async function postJson<T>(url: string, body: unknown, onWait?: (waiting: boolean) => void): Promise<T | null> {
  const payload = JSON.stringify(body)
  const tries = 7
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })
      // 5xx: the site is restarting or busy. Anything else is a real answer (including "check this field").
      if (res.status < 500) { const answer = (await res.json()) as T; onWait?.(false); return answer }
    } catch { /* no connection, or a holding page instead of our answer: try again */ }
    if (i < tries - 1) { onWait?.(true); await new Promise((ok) => setTimeout(ok, 5000)) }
  }
  onWait?.(false)
  return null
}

export const SEND_FAILED = 'We couldn’t send that just now. Please try again in a minute, or call us on 020 8904 9005.'
