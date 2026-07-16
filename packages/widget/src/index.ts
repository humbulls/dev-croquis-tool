import { resolveConfig } from './config';
import { CroquisWidget } from './ui';

const scriptEl =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>('script[data-croquis-ingest-key]');

const config = resolveConfig(scriptEl);

function start(): void {
  if (!config) {
    // eslint-disable-next-line no-console
    console.warn('[croquis] missing data-croquis-api / data-croquis-ingest-key');
    return;
  }
  new CroquisWidget(config);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
