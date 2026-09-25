export interface WidgetConfig {
  /** Croquis instance origin (defaults to where widget.js was loaded from). */
  apiUrl: string;
  ingestKey: string;
  /** UI language; defaults to the page/browser language. */
  lang: 'en' | 'ja';
  /** Deploy identifier recorded with each comment. */
  buildId: string | null;
}

interface GlobalConfig {
  CroquisWidget?: Partial<Omit<WidgetConfig, 'lang'>> & { lang?: string };
}

function detectLang(explicit: string | null | undefined): 'en' | 'ja' {
  const candidates = [
    explicit,
    document.documentElement.lang,
    ...(navigator.languages ?? []),
    navigator.language,
  ];
  for (const value of candidates) {
    if (!value) continue;
    const tag = value.toLowerCase();
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

/**
 * Configuration comes from the embedding script tag
 * (`<script src=".../widget.js" data-croquis-key="ing_…">`) or from
 * `window.CroquisWidget` for tag managers. Returns null when the key is missing.
 */
export function resolveConfig(script: HTMLScriptElement | null): WidgetConfig | null {
  const global = (window as unknown as GlobalConfig).CroquisWidget;
  const attr = (name: string) => script?.getAttribute(name) ?? null;
  const ingestKey =
    global?.ingestKey ?? attr('data-croquis-key') ?? attr('data-croquis-ingest-key');
  let apiUrl = global?.apiUrl ?? attr('data-croquis-api');
  if (!apiUrl && script?.src) {
    try {
      apiUrl = new URL(script.src, location.href).origin;
    } catch {
      apiUrl = null;
    }
  }
  if (!ingestKey || !apiUrl) return null;
  const buildId =
    global?.buildId ??
    attr('data-croquis-build') ??
    document.querySelector('meta[name="croquis-build"]')?.getAttribute('content') ??
    null;
  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    ingestKey,
    lang: detectLang(global?.lang ?? attr('data-croquis-lang')),
    buildId: buildId || null,
  };
}
