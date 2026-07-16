/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from '@cloudflare/vitest-pool-workers';

// The `env` exported by `cloudflare:test` is typed as `Cloudflare.Env`.
// Declare it here so tests are type-safe without running `wrangler types`.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      BUCKET: R2Bucket;
      ADMIN_TOKEN: string;
      DASHBOARD_ORIGIN?: string;
      AI_PROVIDER?: string;
      ANTHROPIC_API_KEY?: string;
      OPENAI_API_KEY?: string;
      AI_MODEL?: string;
      /** Injected by the test pool (see vitest.config.ts). */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
