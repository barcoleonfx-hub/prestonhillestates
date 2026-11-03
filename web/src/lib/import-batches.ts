import 'server-only'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ImportRow } from './email-import'

// Uploaded mailboxes are parsed into a short-lived preview on the server's temporary disk,
// reviewed in the browser, then imported. Nothing personal is kept here after import.
const DIR = path.join(/* turbopackIgnore: true */ tmpdir(), 'phe-import')

export const validBatch = (id: string | null): id is string => !!id && /^[a-z0-9-]{8,64}$/.test(id)
const file = (id: string) => path.join(/* turbopackIgnore: true */ DIR, `${id}.json`)

export async function readBatch(id: string): Promise<ImportRow[]> {
  try { return JSON.parse(await readFile(file(id), 'utf8')) as ImportRow[] } catch { return [] }
}

export async function writeBatch(id: string, rows: ImportRow[]) {
  await mkdir(DIR, { recursive: true })
  await writeFile(file(id), JSON.stringify(rows))
}

export async function dropBatch(id: string) {
  await rm(file(id), { force: true })
}

export const uploadPath = (id: string, n: number) => path.join(/* turbopackIgnore: true */ DIR, `${id}-${n}.upload`)
export const ensureDir = () => mkdir(DIR, { recursive: true })

/** A skipped email staff may still tick: not a duplicate and not past the retention limit. */
export const importable = (r: Pick<ImportRow, 'category' | 'reason'>) =>
  r.category !== 'skipped' || !/already imported|older than/i.test(r.reason ?? '')
