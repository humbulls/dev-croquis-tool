import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  // tsup's DTS step sets `baseUrl`, deprecated in TypeScript 6.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  // @croquis/shared is a source package: inline it so the published client is self-contained.
  noExternal: [/^@croquis\//],
});
