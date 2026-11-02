import 'server-only'
import { getClient, ready } from '@/db/client'

/** How long personal details are kept after the last contact. Agreed with the office: 2 years. */
export const RETENTION_MONTHS = Math.max(6, Number(process.env.RETENTION_MONTHS) || 24)

export function retentionCutoff(from = new Date()): string {
  const d = new Date(from)
  d.setUTCMonth(d.getUTCMonth() - RETENTION_MONTHS)
  return d.toISOString()
}

export type RetentionResult = { ran: boolean; contacts?: number; enquiries?: number; appointments?: number }

/**
 * Deletes personal details nobody has needed for RETENTION_MONTHS (UK GDPR storage limitation):
 * contacts with no calls, enquiries or bookings since the cut-off (with their calls and callbacks),
 * old website enquiries, and the names and numbers on old diary entries. Runs at most once a day.
 */
export async function runRetention(opts: { force?: boolean } = {}): Promise<RetentionResult> {
  await ready()
  const client = getClient()
  const nowIso = new Date().toISOString()
  const dayAgo = new Date(Date.now() - 24 * 3600000).toISOString()
  if (!opts.force) {
    const claim = await client.execute({
      sql: `INSERT INTO jobs (name, last_run_at) VALUES ('retention', ?)
            ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at WHERE jobs.last_run_at < ?`,
      args: [nowIso, dayAgo],
    })
    if (claim.rowsAffected !== 1) return { ran: false }
  }
  const cutoff = retentionCutoff()

  // A contact is kept while anything about them is recent, upcoming or still to do.
  const stale = `SELECT c.id FROM contacts c
    WHERE coalesce(c.last_contact_at, c.created_at) < :cutoff
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.contact_id = c.id AND t.done_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.contact_id = c.id AND (a.starts_at >= :cutoff OR a.status = 'scheduled'))
      AND NOT EXISTS (SELECT 1 FROM enquiries e WHERE e.contact_id = c.id AND e.created_at >= :cutoff)
      AND NOT EXISTS (SELECT 1 FROM calls k WHERE k.contact_id = c.id AND k.created_at >= :cutoff)`
  const ids = (await client.execute({ sql: stale, args: { cutoff } })).rows.map((r) => String(r.id))
  const results = await client.batch([
    ...(ids.length ? [
      { sql: `DELETE FROM notifications WHERE task_id IN (SELECT id FROM tasks WHERE contact_id IN (${ids.map(() => '?').join(',')}))`, args: ids },
      { sql: `DELETE FROM tasks WHERE contact_id IN (${ids.map(() => '?').join(',')})`, args: ids },
      { sql: `DELETE FROM calls WHERE contact_id IN (${ids.map(() => '?').join(',')})`, args: ids },
      { sql: `UPDATE enquiries SET contact_id = NULL WHERE contact_id IN (${ids.map(() => '?').join(',')})`, args: ids },
      { sql: `UPDATE appointments SET contact_id = NULL WHERE contact_id IN (${ids.map(() => '?').join(',')})`, args: ids },
      { sql: `DELETE FROM contacts WHERE id IN (${ids.map(() => '?').join(',')})`, args: ids },
    ] : []),
    { sql: 'DELETE FROM enquiries WHERE created_at < ?', args: [cutoff] },
    // Old diary entries stay for the record (who went where, and when) but lose the visitor's details.
    { sql: `UPDATE appointments SET contact_name = 'Details removed', contact_phone = NULL, contact_email = NULL, notes = NULL, outcome_notes = NULL
            WHERE starts_at < ? AND status <> 'scheduled' AND coalesce(contact_name, '') <> 'Details removed'`, args: [cutoff] },
    { sql: 'DELETE FROM audit_log WHERE at < ?', args: [cutoff] },
    { sql: 'DELETE FROM email_log WHERE created_at < ?', args: [cutoff] },
    { sql: 'DELETE FROM notification_reads WHERE notification_id IN (SELECT id FROM notifications WHERE created_at < ?)', args: [new Date(Date.now() - 30 * 86400000).toISOString()] },
    { sql: 'DELETE FROM notifications WHERE created_at < ?', args: [new Date(Date.now() - 30 * 86400000).toISOString()] },
  ], 'write')
  const off = ids.length ? 6 : 0
  const res = { ran: true, contacts: ids.length, enquiries: results[off].rowsAffected, appointments: results[off + 1].rowsAffected }
  await client.execute({ sql: "UPDATE jobs SET detail = ? WHERE name = 'retention'", args: [JSON.stringify({ at: nowIso, ...res })] }).catch(() => {})
  return res
}
