import app from './app';
import type { Env } from './env';
import { runMaintenance } from './services/maintenance';
import { deliverDue } from './services/webhooks';

export default {
  fetch: app.fetch,
  /** Cron trigger (wrangler.jsonc): webhook retries and housekeeping. */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.allSettled([deliverDue(env), runMaintenance(env)]));
  },
} satisfies ExportedHandler<Env>;
