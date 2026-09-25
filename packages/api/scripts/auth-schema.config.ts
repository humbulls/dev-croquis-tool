/**
 * Offline Better Auth config used only to print the identity schema Better
 * Auth expects (`pnpm --filter @croquis/api auth:schema`). The runtime config
 * lives in src/auth/index.ts and shares the same mapping.
 */

import { betterAuth } from 'better-auth';
import Database from 'better-sqlite3';
import { coreSchemaOptions } from '../src/auth/schema-options';

export const auth = betterAuth({
  database: new Database(':memory:'),
  secret: 'schema-generation-only-secret-000000000000',
  emailAndPassword: { enabled: true },
  advanced: { database: { generateId: () => crypto.randomUUID() } },
  ...coreSchemaOptions,
});
