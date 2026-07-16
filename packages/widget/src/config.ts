export interface WidgetConfig {
  apiUrl: string;
  ingestKey: string;
  author?: string;
}

interface GlobalConfig {
  CroquisWidget?: Partial<WidgetConfig>;
}

/**
 * Resolve config from `window.CroquisWidget` or the embedding script's
 * `data-croquis-*` attributes. Returns null if required fields are missing.
 */
export function resolveConfig(scriptEl: HTMLScriptElement | null): WidgetConfig | null {
  const globalCfg = (window as unknown as GlobalConfig).CroquisWidget;
  const attr = (name: string): string | undefined =>
    scriptEl?.getAttribute(name) ?? undefined;

  const apiUrl = globalCfg?.apiUrl ?? attr('data-croquis-api');
  const ingestKey = globalCfg?.ingestKey ?? attr('data-croquis-ingest-key');
  const author = globalCfg?.author ?? attr('data-croquis-author');

  if (!apiUrl || !ingestKey) return null;
  return { apiUrl: apiUrl.replace(/\/$/, ''), ingestKey, author: author || undefined };
}
