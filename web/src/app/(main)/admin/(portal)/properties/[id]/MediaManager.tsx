'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { MediaItem } from '@/lib/properties'
import { MEDIA_RULES, type MediaKind } from '@/lib/options'
import { deleteMedia, reorderMedia, setCoverPhoto, updateMediaCaption } from '../../../actions'

const GROUPS: { kind: MediaKind; hint: string; multiple: boolean }[] = [
  { kind: 'photo', hint: 'JPG, PNG or WebP, up to 25 MB each. Drag to reorder; the cover photo shows first.', multiple: true },
  { kind: 'floorplan', hint: 'Image or PDF, up to 25 MB.', multiple: true },
  { kind: 'video', hint: 'MP4, MOV or WebM, up to 1 GB. Or paste a YouTube link below.', multiple: true },
  { kind: 'epc', hint: 'The EPC graph, as an image or PDF.', multiple: false },
  { kind: 'brochure', hint: 'A downloadable PDF brochure, up to 50 MB.', multiple: false },
]

type Upload = { key: string; name: string; progress: number; error?: string }

function putWithProgress(url: string, headers: Record<string, string>, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else {
        let msg = 'Upload failed.'
        try { msg = JSON.parse(xhr.responseText).error || msg } catch {}
        reject(new Error(msg))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'))
    xhr.send(file)
  })
}

function Group({ propertyId, kind, hint, multiple, items }: { propertyId: string; kind: MediaKind; hint: string; multiple: boolean; items: MediaItem[] }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [order, setOrder] = useState(items)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [, startTransition] = useTransition()
  const rule = MEDIA_RULES[kind]

  // Keep local order in step with the server after refreshes (not on every parent re-render).
  const sig = items.map((m) => `${m.id}:${m.position}:${m.isCover}:${m.status}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setOrder(items), [sig])

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (!multiple && (items.length || list.length > 1)) {
      if (items.length && !confirm(`Replace the current ${rule.label.toLowerCase()}?`)) return
      for (const m of items) await deleteMedia(m.id)
      list.splice(1)
    }
    await Promise.all(
      list.map(async (file) => {
        const key = `${file.name}-${file.size}-${Math.random()}`
        const set = (patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)))
        setUploads((u) => [...u, { key, name: file.name, progress: 0 }])
        try {
          const init = await fetch('/api/admin/media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ propertyId, kind, filename: file.name, contentType: file.type, size: file.size }),
          })
          const data = await init.json()
          if (!init.ok) throw new Error(data.error || 'Upload failed.')
          await putWithProgress(data.upload.url, data.upload.headers, file, (p) => set({ progress: p }))
          const done = await fetch(`/api/admin/media/${data.id}/complete`, { method: 'POST' })
          if (!done.ok) throw new Error((await done.json()).error || 'Upload failed.')
          setUploads((u) => u.filter((x) => x.key !== key))
        } catch (e) {
          set({ error: e instanceof Error ? e.message : 'Upload failed.' })
        }
      }),
    )
    router.refresh()
  }

  function onDropTile(targetId: string) {
    if (!dragId || dragId === targetId) return
    const ids = order.map((m) => m.id)
    const from = ids.indexOf(dragId)
    ids.splice(from, 1)
    ids.splice(ids.indexOf(targetId), 0, dragId)
    const next = ids.map((id) => order.find((m) => m.id === id)!)
    setOrder(next)
    startTransition(async () => {
      await reorderMedia(propertyId, ids)
      router.refresh()
    })
  }

  const accept = Object.keys(rule.types).join(',')
  const isImage = (m: MediaItem) => m.contentType.startsWith('image/')
  const isVideo = (m: MediaItem) => m.contentType.startsWith('video/')

  return (
    <div className="media-group">
      <div className="media-head">
        <h3>{rule.label} {order.length ? <span style={{ color: 'var(--faint)', fontWeight: 500 }}>· {order.length}</span> : null}</h3>
        <span className="rules">{hint}</span>
      </div>

      {order.length ? (
        <div className="media-grid">
          {order.map((m) => (
            <div
              key={m.id}
              className={`mtile${dragId === m.id ? ' dragging' : ''}${overId === m.id && dragId !== m.id ? ' dropbefore' : ''}`}
              draggable={order.length > 1}
              onDragStart={(e) => { setDragId(m.id); e.dataTransfer.effectAllowed = 'move' }}
              onDragEnd={() => { setDragId(null); setOverId(null) }}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(m.id) } }}
              onDrop={(e) => { e.preventDefault(); onDropTile(m.id); setOverId(null) }}
            >
              <div className="preview">
                {isImage(m) ? <img src={m.url} alt={m.caption || ''} loading="lazy" />
                  : isVideo(m) ? <video src={m.url} muted preload="metadata" />
                    : <span className="doc">PDF</span>}
              </div>
              {m.status !== 'ready' ? <span className="badge pill warn">Incomplete</span>
                : m.isCover ? <span className="badge pill gold">Cover</span> : null}
              <div className="meta">
                <input
                  aria-label="Caption"
                  placeholder="Add a caption"
                  defaultValue={m.caption || ''}
                  onBlur={(e) => {
                    if (e.target.value !== (m.caption || '')) startTransition(() => updateMediaCaption(m.id, e.target.value))
                  }}
                />
                <div className="fname" title={m.originalName || ''}>{m.originalName}</div>
                <div className="tools">
                  {kind === 'photo' && !m.isCover && m.status === 'ready' ? (
                    <button type="button" onClick={() => startTransition(async () => { await setCoverPhoto(m.id); router.refresh() })}>Make cover</button>
                  ) : <a href={m.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--ink-soft)' }}>Open</a>}
                  <button type="button" className="del" onClick={() => {
                    if (!confirm('Delete this file?')) return
                    setOrder(order.filter((x) => x.id !== m.id))
                    startTransition(async () => { await deleteMedia(m.id); router.refresh() })
                  }}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {uploads.length ? (
        <div className="uploading" aria-live="polite">
          {uploads.map((u) => (
            <div key={u.key} className={`uprow${u.error ? ' err' : ''}`}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.error ? `${u.name}: ${u.error}` : u.name}</span>
              {u.error ? <span /> : <div className="bar"><i style={{ width: `${Math.round(u.progress * 100)}%` }} /></div>}
              {u.error ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>Dismiss</button>
              ) : <span className="num">{Math.round(u.progress * 100)}%</span>}
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={`drop${dropActive ? ' over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropActive(true) } }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          setDropActive(false)
          uploadFiles(e.dataTransfer.files)
        }}
      >
        <b>{!multiple && order.length ? 'Replace' : 'Upload'} {rule.label.toLowerCase()}</b> · drag files here or click to choose
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}

export function MediaManager({ propertyId, items }: { propertyId: string; items: MediaItem[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {GROUPS.map((g) => (
        <Group key={g.kind} propertyId={propertyId} kind={g.kind} hint={g.hint} multiple={g.multiple} items={items.filter((m) => m.kind === g.kind)} />
      ))}
    </div>
  )
}
