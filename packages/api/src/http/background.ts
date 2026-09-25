import type { Context } from 'hono';
import type { AppEnv } from '../env';

/**
 * Run work after the response is sent (`ctx.waitUntil`). Without an
 * ExecutionContext (unit tests calling `app.request`) the work is awaited.
 */
export async function background(c: Context<AppEnv>, work: Promise<unknown>): Promise<void> {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    await work.catch((err: unknown) => console.error('background task failed', err));
  }
}
