import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { tooManyRequests } from './problem';

/**
 * Per-client throttle for unauthenticated or brute-forceable endpoints, using
 * the Workers Rate Limiting binding (configured in wrangler.jsonc). A missing
 * binding — local development, tests — disables the check.
 */
export async function rateLimit(
  c: Context<AppEnv>,
  bucket: string,
  subject?: string,
): Promise<void> {
  const limiter = c.env.PUBLIC_RATE_LIMITER;
  if (!limiter) return;
  const client = subject ?? c.req.header('cf-connecting-ip') ?? 'unknown';
  const { success } = await limiter.limit({ key: `${bucket}:${client}` });
  if (!success) {
    c.header('Retry-After', '60');
    throw tooManyRequests();
  }
}
