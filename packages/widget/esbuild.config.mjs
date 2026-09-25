import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
mkdirSync(resolve(root, 'dist'), { recursive: true });

const common = {
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  // Widget styles and generated tokens are inlined as text into the bundle.
  loader: { '.css': 'text' },
  logLevel: 'warning',
};

await Promise.all([
  // The core widget: loaded on every page of the reviewed site.
  build({
    ...common,
    entryPoints: [resolve(root, 'src/index.ts')],
    outfile: resolve(root, 'dist/widget.js'),
  }),
  // Screenshot capture, fetched on demand the first time a reviewer attaches one.
  build({
    ...common,
    entryPoints: [resolve(root, 'src/capture-entry.ts')],
    outfile: resolve(root, 'dist/widget-capture.js'),
  }),
]);

// Size budget (gzip) — CI fails when the core widget grows past it.
const BUDGET = { 'widget.js': 20_000, 'widget-capture.js': 40_000 };
for (const [file, limit] of Object.entries(BUDGET)) {
  const path = resolve(root, 'dist', file);
  const gzip = gzipSync(readFileSync(path)).length;
  const raw = statSync(path).size;
  const ok = gzip <= limit;
  console.log(
    `${ok ? '✓' : '✖'} ${file}: ${(raw / 1024).toFixed(1)} kB, ${(gzip / 1024).toFixed(1)} kB gzip (budget ${(limit / 1024).toFixed(0)} kB)`,
  );
  if (!ok) process.exitCode = 1;
}
