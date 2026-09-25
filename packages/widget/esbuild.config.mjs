import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  // Inline .css (widget styles + generated tokens) as text into the bundle.
  loader: { '.css': 'text' },
  outfile: resolve(root, 'dist/croquis-widget.js'),
  logLevel: 'info',
});
