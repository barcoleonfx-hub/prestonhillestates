'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ALL_ROLES, NEWS_LIBRARY, ROLES, fromLibrary, newBlock, renderCampaign,
  type Audience, type Block, type BlockKind, type Content, type Reader, type Role, type Shared,
} from '@/lib/campaign'
import { countAudience, saveCampaign, startCampaign, testCampaign } from '../../../campaign-actions'
import { PeopleList } from './PeopleList'

const KINDS: { kind: BlockKind; label: string; about: string }[] = [
  { kind: 'letter', label: 'Letter', about: 'A heading and a note from the branch' },
  { kind: 'listings', label: 'Our listings', about: 'Current homes, picked for each reader' },
  { kind: 'market', label: 'Market snapshot', about: 'Local sold prices from the Land Registry' },
  { kind: 'article', label: 'News item', about: 'Local news, law changes, tips' },
  { kind: 'guides', label: 'Guides', about: 'Links to guides on the website' },
  { kind: 'cta', label: 'Call to action', about: 'Valuation, rental valuation, calculator…' },
]
const kindLabel = (k: BlockKind) => KINDS.find((x) => x.kind === k)?.label ?? k
const CTA: { value: Extract<Block, { kind: 'cta' }>['variant']; label: string }[] = [
  { value: 'auto', label: 'Best for each reader (landlords: rental valuation, sellers: valuation, buyers: calculator, tenants: homes to rent)' },
  { value: 'valuation', label: 'Free valuation' }, { value: 'letting', label: 'Rental valuation' },
  { value: 'mortgage', label: 'Borrowing calculator' }, { value: 'register', label: 'Homes to rent' },
]
const generic = (base: string): Reader => ({ contactId: null, name: 'Sam Example', email: 'sam@example.com', roles: ['other'], outward: null, areas: null, budget: null, minBeds: null, position: null, unsubscribeUrl: `${base}/unsubscribe` })
// Made-up readers for each kind of person, for previewing sections nobody in the sample list would see.
const EXAMPLES: Record<Role, Partial<Reader>> = {
  buyer: { name: 'Alex Example', budget: 600000, minBeds: 3, outward: 'HA3' }, tenant: { name: 'Alex Example', budget: 1800, minBeds: 2, outward: 'HA9' },
  landlord: { name: 'Alex Example', outward: 'HA3' }, seller: { name: 'Alex Example', outward: 'HA3' }, other: { name: 'Alex Example' },
}
const example = (base: string, r: Role): Reader => ({ ...generic(base), ...EXAMPLES[r], contactId: `example-${r}`, roles: [r] })
const readerShows = (b: Block, r: Reader) => b.kind !== 'article' || r.roles.some((x) => b.show.includes(x)) || (!r.roles.length && b.show.includes('other'))

type Props = {
  id: string; readOnly: boolean; isAdmin: boolean; canSend: boolean
  initialName: string; initialAudience: Audience; initialContent: Content
  shared: Shared; samples: Reader[]; summary: { total: number; byRole: Record<Role, number> }
  sender: { email: string }; month: string; perDay: number; sentToday: number
}

export function CampaignEditor(p: Props) {
  const router = useRouter()
  const [name, setName] = useState(p.initialName)
  const [audience, setAudience] = useState<Audience>(p.initialAudience)
  const [content, setContent] = useState<Content>(p.initialContent)
  const [summary, setSummary] = useState(p.summary)
  const [saved, setSaved] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved')
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [as, setAs] = useState<string>(p.samples[0]?.contactId ?? 'generic')
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop')
  const [open, setOpen] = useState<string | null>(p.initialContent.blocks[0]?.id ?? null)
  const first = useRef(true)
  const frame = useRef<HTMLIFrameElement>(null)

  // Save a moment after each change.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (p.readOnly) return
    setSaved('unsaved')
    const t = setTimeout(async () => {
      setSaved('saving')
      const r = await saveCampaign(p.id, name, audience, content).catch(() => ({ error: 'Couldn’t reach the portal.' }))
      setSaved('error' in r && r.error ? 'error' : 'saved')
      if ('error' in r && r.error) setNote({ ok: false, text: r.error })
    }, 900)
    return () => clearTimeout(t)
  }, [name, audience, content, p.id, p.readOnly])

  // Recount the audience when it changes.
  useEffect(() => {
    if (p.readOnly) return
    const t = setTimeout(async () => { const s = await countAudience(audience).catch(() => null); if (s) setSummary(s) }, 500)
    return () => clearTimeout(t)
  }, [audience, p.readOnly])

  const reader = (as === 'generic' ? null : as.startsWith('example-') ? example(p.shared.base, as.slice(8) as Role) : p.samples.find((s) => s.contactId === as)) ?? generic(p.shared.base)
  const rendered = useMemo(() => renderCampaign(content, reader, p.shared, { campaign: name, sender: p.sender, month: p.month, markers: true }), [content, reader, p.shared, name, p.sender, p.month])
  const wrap = useRef<HTMLDivElement>(null)
  const [switched, setSwitched] = useState<string | null>(null)
  const [showPeople, setShowPeople] = useState(false)

  /** Opens a section for editing. If the current preview reader wouldn't see it, preview as someone who would. */
  const openBlock = (b: Block | null) => {
    setOpen(b?.id ?? null)
    setSwitched(null)
    if (!b || readerShows(b, reader)) return
    if (b.kind !== 'article') return
    const who = p.samples.find((s) => readerShows(b, s))
    const next = who ? who.contactId! : `example-${b.show[0] ?? 'other'}`
    setAs(next)
    setSwitched(who ? who.name : `an example ${ROLES.find((x) => x.value === b.show[0])?.label.toLowerCase() ?? 'reader'}`)
  }
  // Keep the section being edited in view in the preview.
  const scrollPreview = (id: string | null, smooth = true) => {
    const f = frame.current, w = wrap.current
    const el = id ? f?.contentDocument?.querySelector(`[data-block="${id}"]`) as HTMLElement | null : null
    if (w && el) w.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: smooth ? 'smooth' : 'auto' })
  }
  useEffect(() => { const t = setTimeout(() => scrollPreview(open), 250); return () => clearTimeout(t) }, [open, as, width]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const f = frame.current
    if (!f) return
    const fit = () => { const h = f.contentDocument?.body?.scrollHeight; if (h) f.style.height = `${h + 8}px` }
    const onLoad = () => { fit(); f.contentDocument?.querySelectorAll('img').forEach((i) => i.addEventListener('load', fit)) }
    f.addEventListener('load', onLoad)
    const t = [setTimeout(fit, 150), setTimeout(fit, 900)]
    return () => { f.removeEventListener('load', onLoad); t.forEach(clearTimeout) }
  }, [rendered.html, width])
  // After a change re-renders the preview, put the edited section back in view.
  useEffect(() => { const t = setTimeout(() => scrollPreview(open, false), 200); return () => clearTimeout(t) }, [rendered.html]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Content>(k: K, v: Content[K]) => setContent((c) => ({ ...c, [k]: v }))
  const update = (id: string, patch: Partial<Block>) => setContent((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)) }))
  const move = (id: string, d: -1 | 1) => setContent((c) => {
    const i = c.blocks.findIndex((b) => b.id === id), j = i + d
    if (i < 0 || j < 0 || j >= c.blocks.length) return c
    const blocks = [...c.blocks];[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
    return { ...c, blocks }
  })
  const remove = (id: string) => setContent((c) => ({ ...c, blocks: c.blocks.filter((b) => b.id !== id) }))
  const add = (b: Block) => { setContent((c) => ({ ...c, blocks: [...c.blocks.filter((x) => x.kind !== 'cta'), b, ...c.blocks.filter((x) => x.kind === 'cta')] })); setOpen(b.id) }
  const toggleRole = (r: Role) => setAudience((a) => ({ ...a, roles: a.roles.includes(r) ? a.roles.filter((x) => x !== r) : [...a.roles, r] }))

  async function test() {
    setBusy(true); setNote(null)
    const r = await testCampaign(p.id, content, as === 'generic' ? null : reader).catch(() => ({ error: 'Couldn’t reach the portal.' } as { error: string; ok?: undefined; to?: undefined }))
    setBusy(false)
    setNote(r.ok ? { ok: true, text: `Test sent to ${r.to}, as ${as === 'generic' ? 'a general reader' : reader.name} would get it.` } : { ok: false, text: r.error ?? 'The test didn’t send.' })
  }
  async function go() {
    const days = Math.ceil(summary.total / p.perDay)
    if (!window.confirm(`Send “${content.subject}” to ${summary.total.toLocaleString('en-GB')} people from ${p.sender.email}?\n\nIt goes out in the background, up to ${p.perDay} a day${days > 1 ? `, so it will take about ${days} days` : ''}. You can pause or stop it at any time.`)) return
    setBusy(true); setNote(null)
    await saveCampaign(p.id, name, audience, content)
    const r = await startCampaign(p.id).catch(() => ({ error: 'Couldn’t reach the portal.' } as { error: string }))
    setBusy(false)
    if ('error' in r && r.error) setNote({ ok: false, text: r.error })
    else router.refresh()
  }
  const personal = (s: string) => s.replace(/\{first_name\}/g, 'Sam')
  const shown = (b: Block) => b.kind !== 'article' || audience.roles.some((r) => b.show.includes(r))

  return (
    <div className={`cmp${p.readOnly ? ' ro' : ''}`}>
      <div className="cmp-left">
        <section className="card card-pad">
          <div className="field"><label htmlFor="c-name">Campaign name <span className="hint">(only staff see this)</span></label><input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={p.readOnly} /></div>
          <div className="field" style={{ marginTop: 12 }}><label htmlFor="c-subject">Subject line</label><input id="c-subject" className="input" value={content.subject} onChange={(e) => set('subject', e.target.value)} disabled={p.readOnly} maxLength={150} placeholder="e.g. {first_name}, this month on the Hill" /><span className="hint">{'{first_name}'} becomes each person’s first name. Short and specific works best.</span></div>
          <div className="field" style={{ marginTop: 12 }}><label htmlFor="c-pre">Preview text</label><input id="c-pre" className="input" value={content.preheader} onChange={(e) => set('preheader', e.target.value)} disabled={p.readOnly} maxLength={160} /><span className="hint">The grey line shown after the subject in most inboxes.</span></div>
          <div className="field" style={{ marginTop: 12 }}><label htmlFor="c-sign">Signed by</label><input id="c-sign" className="input" value={content.signedBy} onChange={(e) => set('signedBy', e.target.value)} disabled={p.readOnly} maxLength={80} /></div>
        </section>

        <section className="card card-pad">
          <h2 className="cmp-h">Who gets it · {summary.total.toLocaleString('en-GB')} {summary.total === 1 ? 'person' : 'people'}</h2>
          <div className="cmp-roles">
            {ROLES.map((r) => (
              <label key={r.value} className={`cmp-role${audience.roles.includes(r.value) ? ' on' : ''}`}>
                <input type="checkbox" checked={audience.roles.includes(r.value)} onChange={() => toggleRole(r.value)} disabled={p.readOnly} />
                <span>{r.plural}</span><b>{(summary.byRole[r.value] ?? 0).toLocaleString('en-GB')}</b>
              </label>
            ))}
          </div>
          <div className="cmp-two">
            <div className="field"><label htmlFor="c-areas">Only these areas <span className="hint">(optional)</span></label><input id="c-areas" className="input" value={audience.areas} onChange={(e) => setAudience((a) => ({ ...a, areas: e.target.value }))} placeholder="e.g. HA3, HA9, Kenton" disabled={p.readOnly} /></div>
            <div className="field"><label htmlFor="c-active">In touch within</label>
              <select id="c-active" className="select" value={audience.activeMonths ?? ''} onChange={(e) => setAudience((a) => ({ ...a, activeMonths: e.target.value ? Number(e.target.value) : null }))} disabled={p.readOnly}>
                <option value="">Any time</option><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option><option value="24">2 years</option>
              </select>
            </div>
          </div>
          <p className="card-sub" style={{ marginTop: 10 }}>Only people on your <b>enquiries list</b> are included: anyone who has enquired about a home, asked for a valuation or registered with us. Someone with two roles counts once. People who unsubscribed, archived contacts and anyone marked “Do not call back” are always left out.</p>
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setShowPeople(!showPeople)} aria-expanded={showPeople}>
            {showPeople ? 'Hide the list' : `See who’s on the list (${summary.total.toLocaleString('en-GB')})`}
          </button>
          {showPeople ? <PeopleList campaignId={p.id} audience={audience} ro={p.readOnly} onExclude={(ids) => setAudience((a) => ({ ...a, exclude: ids }))} /> : null}
        </section>

        <section className="card card-pad">
          <h2 className="cmp-h">What’s in it</h2>
          <ol className="cmp-blocks">
            {content.blocks.map((b, i) => (
              <li key={b.id} className={`cmp-block${open === b.id ? ' open' : ''}${shown(b) ? '' : ' hidden-for'}`}>
                <div className="cmp-block-head">
                  <button type="button" className="cmp-block-title" onClick={() => openBlock(open === b.id ? null : b)} aria-expanded={open === b.id}>
                    <span className="cmp-kind">{kindLabel(b.kind)}</span>
                    <span className="cmp-sum">{summaryOf(b)}</span>
                  </button>
                  {!p.readOnly ? (
                    <span className="cmp-block-tools">
                      <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(b.id, -1)}>↑</button>
                      <button type="button" aria-label="Move down" disabled={i === content.blocks.length - 1} onClick={() => move(b.id, 1)}>↓</button>
                      <button type="button" aria-label="Remove" onClick={() => remove(b.id)}>✕</button>
                    </span>
                  ) : null}
                </div>
                {open === b.id && switched ? <p className="cmp-switch">Only {b.kind === 'article' ? b.show.map((r) => ROLES.find((x) => x.value === r)?.plural.toLowerCase()).join(', ') : ''} see this, so the preview is now showing it as {switched}.</p> : null}
                {open === b.id ? <button type="button" className="cmp-jump" onClick={() => { document.querySelector('.cmp-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => scrollPreview(b.id), 400) }}>See this in the preview ↓</button> : null}
                {open === b.id ? <BlockFields b={b} update={(x) => update(b.id, x)} shared={p.shared} ro={p.readOnly} /> : null}
              </li>
            ))}
          </ol>
          {!p.readOnly ? (
            <div className="cmp-add">
              <span className="flabel">Add</span>
              {KINDS.map((k) => <button key={k.kind} type="button" className="btn btn-ghost btn-sm" title={k.about} onClick={() => add(newBlock(k.kind))}>{k.label}</button>)}
              <select className="select" value="" onChange={(e) => e.target.value && add(fromLibrary(e.target.value))} aria-label="Add a ready-written news item">
                <option value="">Ready-written news…</option>
                {NEWS_LIBRARY.map((n) => <option key={n.key} value={n.key}>{n.headline} ({n.show.length === ALL_ROLES.length ? 'everyone' : n.show.map((r) => ROLES.find((x) => x.value === r)?.plural.toLowerCase()).join(', ')})</option>)}
              </select>
            </div>
          ) : null}
        </section>
      </div>

      <div className="cmp-right">
        <section className="card cmp-preview">
          <div className="cmp-preview-head">
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="c-as">See it as</label>
              <select id="c-as" className="select" value={as} onChange={(e) => setAs(e.target.value)}>
                {p.samples.map((s) => <option key={s.contactId!} value={s.contactId!}>{s.name} · {s.roles.map((r) => ROLES.find((x) => x.value === r)?.label).join(', ')}{s.outward ? ` · ${s.outward}` : ''}{s.budget ? ` · up to £${s.budget.toLocaleString('en-GB')}` : ''}</option>)}
                {ROLES.map((r) => <option key={r.value} value={`example-${r.value}`}>An example {r.label.toLowerCase()} (made up)</option>)}
                <option value="generic">Someone we know nothing about</option>
              </select>
            </div>
            <div className="seg" role="group" aria-label="Preview size">
              <button type="button" className={width === 'desktop' ? 'on' : ''} onClick={() => setWidth('desktop')}>Computer</button>
              <button type="button" className={width === 'mobile' ? 'on' : ''} onClick={() => setWidth('mobile')}>Phone</button>
            </div>
          </div>
          <div className="cmp-inbox"><b>{rendered.subject}</b><span>{personal(content.preheader).replace(/\{first_name\}/g, '')}</span></div>
          <div className="pmail-frame-wrap cmp-scroll" ref={wrap}><iframe ref={frame} title="Email preview" className={`pmail-frame ${width}`} srcDoc={rendered.html} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" /></div>
        </section>
        {!p.readOnly ? (
          <section className="card card-pad cmp-send">
            {note ? <div className={`notice ${note.ok ? 'ok' : 'err'}`}>{note.text}</div> : null}
            <div className="cmp-send-row">
              <span className={`cmp-saved ${saved}`}>{{ saved: 'Saved', saving: 'Saving…', unsaved: 'Changes not saved yet', error: 'Not saved' }[saved]}</span>
              <button type="button" className="btn btn-ghost" disabled={busy || !p.canSend} onClick={test}>Send me a test</button>
              {p.isAdmin ? <button type="button" className="btn btn-gold" disabled={busy || !p.canSend || !summary.total || !content.subject.trim()} onClick={go}>Send to {summary.total.toLocaleString('en-GB')} {summary.total === 1 ? 'person' : 'people'}</button> : null}
            </div>
            <p className="card-sub">{p.isAdmin ? `Sent in the background, up to ${p.perDay} a day (${p.sentToday} sent today). Each email has an unsubscribe link.` : 'An admin sends campaigns. Send yourself a test and let them know it’s ready.'}</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function summaryOf(b: Block) {
  switch (b.kind) {
    case 'letter': return b.title.replace(/\*/g, '') || 'Untitled'
    case 'listings': return `${b.ids ? `${b.ids.length} chosen` : 'All current'} · up to ${b.max} · ${{ auto: 'right kind for each reader', sale: 'for sale', let: 'to rent', both: 'sale and rent' }[b.channel]}`
    case 'market': return 'Typical prices in each reader’s area'
    case 'article': return `${b.headline || 'Untitled'} · ${b.show.length === ALL_ROLES.length ? 'everyone' : b.show.map((r) => ROLES.find((x) => x.value === r)?.plural.toLowerCase()).join(', ')}`
    case 'guides': return b.slugs.length ? `${b.slugs.length} chosen` : 'Latest guides'
    case 'cta': return CTA.find((c) => c.value === b.variant)?.label.split(' (')[0] ?? ''
  }
}

// Defined once, outside the editor, so typing in a field doesn't remount it and lose focus.
function F({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <div className="field"><label>{label}</label>{children}{hint ? <span className="hint">{hint}</span> : null}</div>
}

function BlockFields({ b, update, shared, ro }: { b: Block; update: (p: Partial<Block>) => void; shared: Shared; ro: boolean }) {
  switch (b.kind) {
    case 'letter':
      return (
        <div className="cmp-fields">
          <F label="Heading" hint="Put a word in *asterisks* to make it gold italic, like The Hill *Report*."><input className="input" value={b.title} onChange={(e) => update({ title: e.target.value })} disabled={ro} /></F>
          <F label="Message" hint="{first_name} becomes each person’s first name. Leave a blank line between paragraphs."><textarea className="textarea" rows={6} value={b.body} onChange={(e) => update({ body: e.target.value })} disabled={ro} /></F>
        </div>
      )
    case 'listings':
      return (
        <div className="cmp-fields">
          <F label="Heading"><input className="input" value={b.title} onChange={(e) => update({ title: e.target.value })} disabled={ro} /></F>
          <div className="cmp-two">
            <F label="Which homes"><select className="select" value={b.channel} onChange={(e) => update({ channel: e.target.value as typeof b.channel })} disabled={ro}>
              <option value="auto">The right kind for each reader</option><option value="sale">For sale only</option><option value="let">To rent only</option><option value="both">Both</option>
            </select></F>
            <F label="Most to show"><input className="input" type="number" min={1} max={8} value={b.max} onChange={(e) => update({ max: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} disabled={ro} /></F>
          </div>
          <F label={`Listings · ${shared.listings.length} live on the website`} hint="Untick any you’d rather leave out. Each reader sees the best fit for their budget, area and bedrooms first.">
            <div className="cmp-checks">
              {shared.listings.length ? shared.listings.map((l) => (
                <label key={l.id}><input type="checkbox" disabled={ro} checked={!b.ids || b.ids.includes(l.id)} onChange={(e) => {
                  const cur = b.ids ?? shared.listings.map((x) => x.id)
                  const next = e.target.checked ? [...cur, l.id] : cur.filter((x) => x !== l.id)
                  update({ ids: next.length === shared.listings.length ? null : next })
                }} /> {l.priceText} · {l.address} <span className="pill">{l.channel === 'let' ? 'To let' : 'For sale'}</span></label>
              )) : <span className="card-sub">No published listings yet, so this section is left out.</span>}
            </div>
          </F>
        </div>
      )
    case 'market': {
      const areas = Object.values(shared.market).filter((m) => m.area !== 'ALL')
      return (
        <div className="cmp-fields">
          <F label="Heading"><input className="input" value={b.title} onChange={(e) => update({ title: e.target.value })} disabled={ro} /></F>
          <F label="Your comment (optional)" hint="A line or two on what you’re seeing in the office: busy, quieter, what’s selling fastest."><textarea className="textarea" rows={3} value={b.note} onChange={(e) => update({ note: e.target.value })} disabled={ro} /></F>
          <p className="card-sub">{areas.length ? `Each reader sees their own district where we know it (${areas.map((a) => a.area).join(', ')}), otherwise Harrow & Wembley as a whole. Figures are from HM Land Registry, recorded up to ${shared.market.ALL?.latest ?? '—'}.` : 'Sold prices haven’t loaded yet. This section is left out until they have.'}</p>
        </div>
      )
    }
    case 'article':
      return (
        <div className="cmp-fields">
          {b.checked ? <div className="notice" style={{ background: 'var(--gold-wash)', color: 'var(--gold-deep)' }}>Checked against GOV.UK on {new Date(b.checked).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Rules and dates change, so please check it’s still right before sending.</div> : null}
          <div className="cmp-two">
            <F label="Label"><input className="input" value={b.tag} onChange={(e) => update({ tag: e.target.value })} disabled={ro} placeholder="e.g. Law change" /></F>
            <F label="Show to">
              <div className="cmp-chips">{ROLES.map((r) => <label key={r.value} className={b.show.includes(r.value) ? 'on' : ''}><input type="checkbox" disabled={ro} checked={b.show.includes(r.value)} onChange={() => update({ show: b.show.includes(r.value) ? b.show.filter((x) => x !== r.value) : [...b.show, r.value] })} />{r.plural}</label>)}</div>
            </F>
          </div>
          <F label="Headline"><input className="input" value={b.headline} onChange={(e) => update({ headline: e.target.value })} disabled={ro} /></F>
          <F label="Text"><textarea className="textarea" rows={6} value={b.body} onChange={(e) => update({ body: e.target.value })} disabled={ro} /></F>
          <div className="cmp-two">
            <F label="Link (optional)"><input className="input" value={b.link} onChange={(e) => update({ link: e.target.value })} disabled={ro} placeholder="https://" /></F>
            <F label="Link text"><input className="input" value={b.linkLabel} onChange={(e) => update({ linkLabel: e.target.value })} disabled={ro} /></F>
          </div>
        </div>
      )
    case 'guides':
      return (
        <div className="cmp-fields">
          <F label="Heading"><input className="input" value={b.title} onChange={(e) => update({ title: e.target.value })} disabled={ro} /></F>
          <F label="Guides" hint="Leave all unticked to show the three newest.">
            <div className="cmp-checks">{shared.guides.map((g) => <label key={g.slug}><input type="checkbox" disabled={ro} checked={b.slugs.includes(g.slug)} onChange={(e) => update({ slugs: e.target.checked ? [...b.slugs, g.slug] : b.slugs.filter((x) => x !== g.slug) })} /> {g.title}</label>)}</div>
          </F>
        </div>
      )
    case 'cta':
      return (
        <div className="cmp-fields">
          <F label="Offer"><select className="select" value={b.variant} onChange={(e) => update({ variant: e.target.value as typeof b.variant })} disabled={ro}>{CTA.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></F>
        </div>
      )
  }
}
