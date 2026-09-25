import { defineConfig } from 'vitest/config';

// Node-side tests (migrations on better-sqlite3). The Workers tests live in
// vitest.config.ts and run inside workerd.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test-node/**/*.test.ts'],
  },
});
