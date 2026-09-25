import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  dts: true,
  // @croquis/shared is a source package: inline it so the published client is self-contained.
  noExternal: [/^@croquis\//],
});
