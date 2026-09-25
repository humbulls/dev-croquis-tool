/**
 * URL helpers that turn the URL a reviewer commented on into a sitemap Page.
 * Pure and dependency-free: used by the API (auto-assignment on ingest) and
 * the widget (show pins for the current page).
 */

/** `https://Example.com:443/a?b` → `https://example.com`. Returns null if unparsable. */
export function normalizeOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Canonical page path:
 * - percent-decoded where safe, no query or hash
 * - `/index.html` and `.html` endings removed (`/about.html` → `/about`)
 * - repeated slashes collapsed, trailing slash dropped (except the root)
 */
export function normalizePath(pathname: string): string {
  let path = pathname.split(/[?#]/, 1)[0] ?? '/';
  try {
    path = decodeURI(path);
  } catch {
    // keep the raw path if it is not valid percent-encoding
  }
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/{2,}/g, '/');
  path = path.replace(/\/index\.html?$/i, '/');
  path = path.replace(/\.html?$/i, '');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
}

/** Strip a mount prefix: basePath `/docs` turns `/docs/intro` into `/intro`. */
export function stripBasePath(path: string, basePath: string): string {
  const base = normalizePath(basePath);
  if (base === '/') return path;
  if (path === base) return '/';
  if (path.startsWith(`${base}/`)) return path.slice(base.length);
  return path;
}

/** Page path for a comment URL, relative to the site's base path. */
export function pagePathFromUrl(pageUrl: string, basePath = '/'): string {
  let pathname: string;
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    pathname = pageUrl;
  }
  return stripBasePath(normalizePath(pathname), basePath);
}

/**
 * Does a sitemap path pattern match a concrete path?
 * Patterns support `:param` (one segment) and a trailing `*` (the rest):
 * `/blog/:slug` matches `/blog/hello`; `/docs/*` matches `/docs/a/b`.
 */
export function pathMatches(pattern: string, path: string): boolean {
  const p = normalizePath(pattern).split('/').filter(Boolean);
  const s = normalizePath(path).split('/').filter(Boolean);
  for (let i = 0; i < p.length; i++) {
    const seg = p[i] as string;
    if (seg === '*') return i === p.length - 1;
    const actual = s[i];
    if (actual === undefined) return false;
    if (seg.startsWith(':')) continue;
    if (seg !== actual) return false;
  }
  return p.length === s.length;
}

/** How specific a pattern is: literal segments beat params, params beat `*`. */
function specificity(pattern: string): number {
  return normalizePath(pattern)
    .split('/')
    .filter(Boolean)
    .reduce((score, seg) => score + (seg === '*' ? 1 : seg.startsWith(':') ? 10 : 100), 0);
}

export interface PathCandidate {
  pageId: string;
  path: string;
}

/**
 * Pick the page a path belongs to. Exact matches (pages first, then learned
 * aliases) win; otherwise the most specific pattern match. Returns null when
 * nothing matches — the comment then lands in the "unassigned" inbox.
 */
export function matchPage(
  path: string,
  pages: readonly PathCandidate[],
  aliases: readonly PathCandidate[] = [],
): string | null {
  const target = normalizePath(path);
  const exact =
    pages.find((p) => normalizePath(p.path) === target) ??
    aliases.find((a) => normalizePath(a.path) === target);
  if (exact) return exact.pageId;

  let best: PathCandidate | null = null;
  let bestScore = -1;
  for (const candidate of pages) {
    if (!candidate.path.includes(':') && !candidate.path.includes('*')) continue;
    if (!pathMatches(candidate.path, target)) continue;
    const score = specificity(candidate.path);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best?.pageId ?? null;
}

/** Classify a viewport width into the comment viewport buckets. */
export function viewportKind(width: number): 'desktop' | 'tablet' | 'mobile' {
  if (width <= 767) return 'mobile';
  if (width <= 1023) return 'tablet';
  return 'desktop';
}
