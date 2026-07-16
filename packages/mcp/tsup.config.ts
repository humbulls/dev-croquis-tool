import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  dts: false,
  // Bundle workspace packages (their TS source is not runnable as-is);
  // real npm deps (zod, @modelcontextprotocol/sdk) stay external.
  noExternal: [/^@croquis\//],
  banner: { js: '#!/usr/bin/env node' },
});
