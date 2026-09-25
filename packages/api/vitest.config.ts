import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Read migrations once; applied per test worker in test/apply-migrations.ts.
const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          ADMIN_TOKEN: 'test-admin-token',
          TEST_MIGRATIONS: migrations,
          // Force AI endpoints into the "unconfigured" path even if the
          // developer's .dev.vars carries real provider keys.
          AI_PROVIDER: '',
          ANTHROPIC_API_KEY: '',
          OPENAI_API_KEY: '',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
