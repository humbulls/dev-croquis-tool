/**
 * Build step: read the DTCG token documents and emit dist/tokens.{css,js,d.ts}.
 * Order matters — primitives first so semantic aliases resolve against them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './lib/generate';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const SOURCES = ['src/primitive.tokens.json', 'src/semantic.tokens.json'];

const documents = SOURCES.map((rel) => {
  const abs = resolve(root, rel);
  return JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
});

const dark = JSON.parse(
  readFileSync(resolve(root, 'src/semantic.dark.tokens.json'), 'utf8'),
) as Record<string, unknown>;

const { css, js, dts, tokens } = generate(documents, {
  themes: [{ name: 'dark', document: dark, media: '(prefers-color-scheme: dark)' }],
});

const distDir = resolve(root, 'dist');
mkdirSync(distDir, { recursive: true });
writeFileSync(resolve(distDir, 'tokens.css'), css, 'utf8');
writeFileSync(resolve(distDir, 'tokens.js'), js, 'utf8');
writeFileSync(resolve(distDir, 'tokens.d.ts'), dts, 'utf8');

console.log(`@croquis/tokens: generated ${Object.keys(tokens).length} tokens -> dist/`);
