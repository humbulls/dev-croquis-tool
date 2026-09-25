import type { Env } from '../env';
import { deleteObjects } from './attachments';

const DAY = 86_400_000;

/**
 * Housekeeping run by the cron trigger. Each step is idempotent and bounded so
 * a run never exceeds the Worker CPU budget; leftovers are handled next time.
 */
export async function runMaintenance(env: Env, now = Date.now()): Promise<void> {
  const isoNow = new Date(now).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(isoNow),
    env.DB.prepare('DELETE FROM verifications WHERE expires_at < ?').bind(isoNow),
    env.DB.prepare(
      `DELETE FROM workspace_invitations WHERE status != 'accepted' AND expires_at < ?`,
    ).bind(now - 30 * DAY),
    env.DB.prepare(
      `DELETE FROM webhook_deliveries WHERE status IN ('succeeded', 'dead') AND updated_at < ?`,
    ).bind(now - 30 * DAY),
    env.DB.prepare('DELETE FROM ai_runs WHERE created_at < ?').bind(now - 180 * DAY),
  ]);

  // Attachments uploaded without a comment (aborted ingests) are removed after a day.
  const { results } = await env.DB.prepare(
    'SELECT id, r2_key FROM attachments WHERE comment_id IS NULL AND created_at < ? LIMIT 200',
  )
    .bind(now - DAY)
    .all<{ id: string; r2_key: string }>();
  if (results.length > 0) {
    await deleteObjects(
      env.BUCKET,
      results.map((r) => r.r2_key),
    );
    await env.DB.batch(
      results.map((r) => env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(r.id)),
    );
  }
}
