import { applyD1Migrations, env } from 'cloudflare:test';

// Idempotently apply all D1 migrations to each isolated test worker's database.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
