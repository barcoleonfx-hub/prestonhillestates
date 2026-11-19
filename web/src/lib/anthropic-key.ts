import 'server-only'
// The Claude API key from the server's settings (ANTHROPIC_API_KEY). A name saved with a stray space or in other
// letter case still counts. When it can't be found, say exactly what the website can see, by name only (never a
// value), and which Render service this is, so the key can be put in the right place.

const WANT = 'ANTHROPIC_API_KEY'

export function anthropicKey(): { key: string } | { error: string } {
  const name = process.env[WANT] !== undefined ? WANT : Object.keys(process.env).find((k) => k.trim().toUpperCase() === WANT)
  const raw = name ? process.env[name] ?? '' : undefined
  if (raw === undefined) {
    const similar = Object.keys(process.env).filter((k) => /anthropic|api[\s_-]*key/i.test(k)).slice(0, 10).map((k) => `“${k}”`)
    const service = process.env.RENDER_SERVICE_NAME ? ` This website is running as the Render service “${process.env.RENDER_SERVICE_NAME}”: the key must be on that service (its Environment page), or in an environment group linked to it.` : ''
    return { error: `The website can’t see ${WANT}.${similar.length ? ` Settings with a similar name that it can see: ${similar.join(', ')}. Rename it to exactly ${WANT}.` : ` It can’t see any setting with “ANTHROPIC” in its name.`}${service} After changing it, use Manual Deploy → Deploy latest commit.` }
  }
  const key = raw.trim().replace(/^["']|["']$/g, '')
  if (!key) return { error: `${WANT} is in Render but its value is empty. Paste the key (it starts sk-ant-) as the value, save, and redeploy.` }
  if (!key.startsWith('sk-ant-')) return { error: `${WANT} in Render doesn’t look like a Claude API key (they start sk-ant-). Check the value you pasted, then redeploy.` }
  return { key }
}
