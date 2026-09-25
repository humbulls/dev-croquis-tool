import { resolveConfig } from './config';
import { CroquisWidget } from './widget';

declare global {
  interface Window {
    __croquisWidget?: CroquisWidget;
  }
}

const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>(
    'script[data-croquis-key], script[data-croquis-ingest-key]',
  );

function start(): void {
  if (window.__croquisWidget) return;
  const config = resolveConfig(script);
  if (!config) {
    console.warn('[croquis] Add data-croquis-key="ing_…" to the widget <script> tag.');
    return;
  }
  window.__croquisWidget = new CroquisWidget(config);
  void window.__croquisWidget.start();
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
