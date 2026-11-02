import 'server-only'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export type UploadTarget = { url: string; method: 'PUT'; headers: Record<string, string> }

export interface Storage {
  /** Where the browser should send the file bytes. */
  uploadTarget(key: string, contentType: string, mediaId: string): Promise<UploadTarget>
  /** Size of the stored object, or null if it does not exist. */
  size(key: string): Promise<number | null>
  remove(key: string): Promise<void>
  publicUrl(key: string): string
}

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads')

/** Resolves a storage key to a path inside the uploads folder, refusing anything that escapes it. */
export function localPath(key: string): string {
  const p = path.resolve(UPLOAD_ROOT, key)
  if (!p.startsWith(UPLOAD_ROOT + path.sep)) throw new Error('Invalid storage key')
  return p
}

export async function writeLocal(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
  const dest = localPath(key)
  await mkdir(path.dirname(dest), { recursive: true })
  let written = 0
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      written += chunk.length
      if (written > maxBytes) cb(new Error('File is larger than the allowed size'))
      else cb(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(body as never), limiter, createWriteStream(dest))
  } catch (e) {
    await unlink(dest).catch(() => {})
    throw e
  }
  return written
}

export function readLocal(key: string, range?: { start: number; end: number }) {
  return createReadStream(localPath(key), range)
}

const localStorage: Storage = {
  async uploadTarget(_key, contentType, mediaId) {
    return { url: `/api/admin/media/${mediaId}/upload`, method: 'PUT', headers: { 'Content-Type': contentType } }
  },
  async size(key) {
    try {
      return (await stat(localPath(key))).size
    } catch {
      return null
    }
  },
  async remove(key) {
    await unlink(localPath(key)).catch(() => {})
  },
  publicUrl(key) {
    return `/media/${key}`
  },
}

function s3Storage(): Storage {
  const bucket = process.env.S3_BUCKET
  const base = process.env.MEDIA_PUBLIC_BASE_URL
  if (!bucket || !base) throw new Error('S3_BUCKET and MEDIA_PUBLIC_BASE_URL must be set when STORAGE_DRIVER=s3')
  const s3 = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    },
  })
  return {
    async uploadTarget(key, contentType) {
      const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
        expiresIn: 60 * 60,
      })
      return { url, method: 'PUT', headers: { 'Content-Type': contentType } }
    },
    async size(key) {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return head.ContentLength ?? 0
      } catch {
        return null
      }
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {})
    },
    publicUrl(key) {
      return `${base.replace(/\/$/, '')}/${key}`
    },
  }
}

let cached: Storage | null = null
export function storage(): Storage {
  if (!cached) cached = process.env.STORAGE_DRIVER === 's3' ? s3Storage() : localStorage
  return cached
}

export const isLocalStorage = () => process.env.STORAGE_DRIVER !== 's3'
