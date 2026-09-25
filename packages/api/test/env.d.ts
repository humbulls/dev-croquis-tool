/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Env as WorkerEnv } from '../src/env';

// `env` from `cloudflare:test` is typed as `Cloudflare.Env`: make it the
// Worker's own Env plus what the test pool injects (see vitest.config.ts).
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
