import 'server-only'
import { rm } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { settings } from '@/db/schema'
import { localPath } from './storage'
import { now } from './util'

/**
 * Once: deletes the files the old licensing section stored (licence and certificate PDFs saved from emails, and
 * downloaded council registers). Its database tables are dropped by migration 027.
 */
export async function removeLicensingFiles() {
  if (await db.query.settings.findFirst({ where: eq(settings.key, 'cleanup_licence_files') })) return
  for (const dir of ['licensing', 'registers']) await rm(localPath(dir), { recursive: true, force: true })
  await db.insert(settings).values({ key: 'cleanup_licence_files', value: 'done', updatedAt: now() }).onConflictDoNothing()
}
