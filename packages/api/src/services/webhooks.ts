import type { WebhookPayload } from '@croquis/shared';
import type { Env } from '../env';

/**
 * Webhook delivery following the Standard Webhooks spec
 * (https://www.standardwebhooks.com): `webhook-id` / `webhook-timestamp` /
 * `webhook-signature: v1,<base64 HMAC-SHA256>` over `${id}.${timestamp}.${body}`.
 * The event id doubles as the message id, so receivers can de-duplicate retries.
 */

/** Delay before attempt n+1 (index = attempts already made). */
export const RETRY_SCHEDULE_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  5 * 3_600_000,
  10 * 3_600_000,
  10 * 3_600_000,
];
const REQUEST_TIMEOUT_MS = 10_000;
/** Consecutive failed attempts after which an endpoint is switched off. */
const DISABLE_AFTER_FAILURES = 50;

interface DeliveryJob {
  id: string;
  attempt_count: number;
  endpoint_id: string;
  url: string;
  secret: string;
  event_id: string;
  event_type: string;
  project_id: string | null;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  data: string;
  event_created_at: number;
}

const JOB_SELECT = `
  SELECT d.id, d.attempt_count, e.id AS endpoint_id, e.url, e.secret,
         ev.id AS event_id, ev.type AS event_type, ev.project_id, ev.actor_type, ev.actor_id,
         ev.actor_name, ev.data, ev.created_at AS event_created_at
    FROM webhook_deliveries d
    JOIN webhook_endpoints e ON e.id = d.endpoint_id
    JOIN activity_events ev ON ev.id = d.event_id
   WHERE d.status IN ('pending', 'failed') AND e.enabled = 1 AND d.next_attempt_at <= ?`;

function decodeSecret(secret: string): Uint8Array {
  const raw = atob(secret.replace(/^whsec_/, ''));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function signWebhook(
  secret: string,
  id: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    decodeSecret(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  let binary = '';
  for (const byte of new Uint8Array(mac)) binary += String.fromCharCode(byte);
  return `v1,${btoa(binary)}`;
}

export function payloadOf(
  job: Omit<DeliveryJob, 'id' | 'attempt_count' | 'endpoint_id' | 'url' | 'secret'>,
): WebhookPayload {
  return {
    id: job.event_id,
    type: job.event_type as WebhookPayload['type'],
    timestamp: new Date(job.event_created_at).toISOString(),
    project_id: job.project_id,
    actor: {
      type: job.actor_type as WebhookPayload['actor']['type'],
      id: job.actor_id,
      name: job.actor_name,
    },
    data: JSON.parse(job.data) as Record<string, unknown>,
  };
}

async function attempt(env: Env, job: DeliveryJob): Promise<void> {
  const body = JSON.stringify(payloadOf(job));
  const timestamp = Math.floor(Date.now() / 1000);
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const response = await fetch(job.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Croquis-Webhooks/1.0',
        'webhook-id': job.event_id,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': await signWebhook(job.secret, job.event_id, timestamp, body),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    statusCode = response.status;
    if (!response.ok) error = `HTTP ${response.status}`;
    // Drain the body so the connection can be reused.
    await response.body?.cancel();
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 300) : 'request failed';
  }

  const now = Date.now();
  const attempts = job.attempt_count + 1;
  if (!error) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE webhook_deliveries SET status = 'succeeded', attempt_count = ?, next_attempt_at = NULL,
                last_status_code = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
      ).bind(attempts, statusCode, now, job.id),
      env.DB.prepare(
        'UPDATE webhook_endpoints SET failure_count = 0 WHERE id = ? AND failure_count > 0',
      ).bind(job.endpoint_id),
    ]);
    return;
  }

  const delay = RETRY_SCHEDULE_MS[job.attempt_count];
  // 410 Gone means the receiver asked us to stop.
  const dead = delay === undefined || statusCode === 410;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE webhook_deliveries SET status = ?, attempt_count = ?, next_attempt_at = ?,
              last_status_code = ?, last_error = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      dead ? 'dead' : 'failed',
      attempts,
      dead ? null : now + delay,
      statusCode,
      error,
      now,
      job.id,
    ),
    env.DB.prepare(
      `UPDATE webhook_endpoints SET failure_count = failure_count + 1,
              enabled = CASE WHEN failure_count + 1 >= ? OR ? THEN 0 ELSE enabled END,
              updated_at = ?
        WHERE id = ?`,
    ).bind(DISABLE_AFTER_FAILURES, statusCode === 410 ? 1 : 0, now, job.endpoint_id),
  ]);
}

async function run(env: Env, jobs: DeliveryJob[]): Promise<number> {
  await Promise.allSettled(jobs.map((job) => attempt(env, job)));
  return jobs.length;
}

/** Deliver the pending notifications of events that were just committed. */
export async function deliverEvents(env: Env, eventIds: string[]): Promise<number> {
  if (eventIds.length === 0) return 0;
  const placeholders = eventIds.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(`${JOB_SELECT} AND d.event_id IN (${placeholders})`)
    .bind(Date.now(), ...eventIds)
    .all<DeliveryJob>();
  return run(env, results);
}

/** Cron: retry everything that is due. */
export async function deliverDue(env: Env, limit = 50): Promise<number> {
  const { results } = await env.DB.prepare(`${JOB_SELECT} ORDER BY d.next_attempt_at LIMIT ?`)
    .bind(Date.now(), limit)
    .all<DeliveryJob>();
  return run(env, results);
}

/** Re-queue one delivery for an immediate attempt (dashboard "Retry"). */
export async function redeliver(env: Env, deliveryId: string): Promise<number> {
  await env.DB.prepare(
    `UPDATE webhook_deliveries SET status = 'pending', next_attempt_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(Date.now(), Date.now(), deliveryId)
    .run();
  const { results } = await env.DB.prepare(`${JOB_SELECT} AND d.id = ?`)
    .bind(Date.now(), deliveryId)
    .all<DeliveryJob>();
  return run(env, results);
}
