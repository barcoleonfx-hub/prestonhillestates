/** Turns a YouTube or Vimeo page link into an embeddable player URL, or null if it isn't one. */
export function embedUrl(link: string | null | undefined): string | null {
  if (!link) return null
  let u: URL
  try {
    u = new URL(link)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\./, '')
  const safe = (id: string | undefined | null) => (id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null)
  if (host === 'youtu.be') {
    const id = safe(u.pathname.slice(1))
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = safe(u.searchParams.get('v')) ?? safe(u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1])
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = u.pathname.match(/(\d{6,12})/)?.[1]
    return id ? `https://player.vimeo.com/video/${id}` : null
  }
  return null
}
