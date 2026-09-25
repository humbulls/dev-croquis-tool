import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const widgetDist = resolve(root, '../widget/dist');

/** Ship the widget next to the dashboard so the Worker serves /widget.js from its assets. */
function widgetAssets(): Plugin {
  return {
    name: 'croquis-widget-assets',
    apply: 'build',
    closeBundle() {
      const out = resolve(root, 'dist');
      mkdirSync(out, { recursive: true });
      for (const file of ['widget.js', 'widget-capture.js']) {
        const source = resolve(widgetDist, file);
        if (!existsSync(source)) throw new Error(`Build @croquis/widget first: missing ${source}`);
        copyFileSync(source, resolve(out, file));
      }
    },
  };
}

export default defineConfig({
  plugins: [preact(), widgetAssets()],
  server: {
    port: 5173,
    // `pnpm dev:api` (wrangler dev) serves the API and MCP on :8787.
    proxy: {
      '/api': 'http://localhost:8787',
      '/mcp': 'http://localhost:8787',
      '/widget.js': 'http://localhost:8787',
      '/widget-capture.js': 'http://localhost:8787',
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
