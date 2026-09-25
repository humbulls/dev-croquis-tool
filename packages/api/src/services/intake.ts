import {
  type AnchorInput,
  type EnvironmentInput,
  matchPage,
  normalizeOrigin,
  pagePathFromUrl,
  viewportKind,
} from '@croquis/shared';
import type { CommentRow } from '../db/comments';
import { pathCandidates } from '../db/pages';
import type { OriginRow } from '../db/projects';

/**
 * Turning raw feedback (widget, share viewer, API) into a comment row: which
 * page it belongs to, how to re-find the element, and where it was seen.
 */

export interface PageMatch {
  pageId: string | null;
  pagePath: string;
}

/** Map a page URL onto the sitemap, honouring the matching origin's base path. */
export async function resolvePage(
  db: D1Database,
  projectId: string,
  pageUrl: string,
  origins: OriginRow[],
): Promise<PageMatch> {
  const origin = normalizeOrigin(pageUrl);
  const basePath = origins.find((o) => o.origin === origin)?.base_path ?? '/';
  const pagePath = pagePathFromUrl(pageUrl, basePath);
  const { pages, aliases } = await pathCandidates(db, projectId);
  return { pageId: matchPage(pagePath, pages, aliases), pagePath };
}

export function anchorColumns(anchor: AnchorInput | undefined): Partial<CommentRow> {
  if (!anchor) return { anchor_status: 'page' };
  const pinned = Boolean(anchor.selector || anchor.xpath || anchor.text_quote);
  return {
    element_selector: anchor.selector ?? null,
    element_xpath: anchor.xpath ?? null,
    element_text_quote: anchor.text_quote ?? null,
    element_tag: anchor.tag ?? null,
    element_text: anchor.text ?? null,
    element_html: anchor.html ?? null,
    element_context: anchor.context ?? null,
    element_attrs: anchor.attrs ?? null,
    computed_style: anchor.computed_style ?? null,
    rel_x: anchor.rel_x ?? null,
    rel_y: anchor.rel_y ?? null,
    doc_x: anchor.doc_x ?? null,
    doc_y: anchor.doc_y ?? null,
    anchor_status: pinned ? 'anchored' : 'page',
  };
}

/** Coarse browser / OS names from a user agent (display only, never used for logic). */
export function parseUserAgent(ua: string | null | undefined): {
  browser: string | null;
  os: string | null;
} {
  if (!ua) return { browser: null, os: null };
  const version = (re: RegExp) => re.exec(ua)?.[1]?.split('.')[0];
  let browser: string | null = null;
  if (/Edg\//.test(ua)) browser = `Edge ${version(/Edg\/([\d.]+)/) ?? ''}`;
  else if (/OPR\//.test(ua)) browser = `Opera ${version(/OPR\/([\d.]+)/) ?? ''}`;
  else if (/Firefox\//.test(ua)) browser = `Firefox ${version(/Firefox\/([\d.]+)/) ?? ''}`;
  else if (/Chrome\//.test(ua)) browser = `Chrome ${version(/Chrome\/([\d.]+)/) ?? ''}`;
  else if (/Safari\//.test(ua)) browser = `Safari ${version(/Version\/([\d.]+)/) ?? ''}`;
  let os: string | null = null;
  if (/iPhone|iPad|iPod/.test(ua)) os = `iOS ${(version(/OS (\d+)_/) ?? '').trim()}`;
  else if (/Android/.test(ua)) os = `Android ${version(/Android ([\d.]+)/) ?? ''}`;
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser: browser?.trim() ?? null, os: os?.trim() ?? null };
}

export function environmentColumns(
  input: EnvironmentInput | undefined,
  fallbackUa: string | null,
): Partial<CommentRow> {
  const ua = input?.user_agent ?? fallbackUa;
  const { browser, os } = parseUserAgent(ua);
  const width = input?.viewport_w ?? null;
  return {
    viewport: width ? viewportKind(width) : 'desktop',
    viewport_w: width,
    viewport_h: input?.viewport_h ?? null,
    device_pixel_ratio: input?.device_pixel_ratio ?? null,
    user_agent: ua ?? null,
    browser,
    os,
    language: input?.language ?? null,
    build_id: input?.build_id ?? null,
  };
}

/** The content block whose text contains the passage a reviewer wants changed. */
export async function matchContentBlock(
  db: D1Database,
  pageId: string | null,
  original: string,
): Promise<string | null> {
  if (!pageId) return null;
  const needle = original.trim();
  if (!needle) return null;
  const row = await db
    .prepare(
      `SELECT id FROM content_blocks WHERE page_id = ? AND instr(content, ?) > 0 ORDER BY position LIMIT 1`,
    )
    .bind(pageId, needle)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** Best-effort language tag for the comment body (drives translation offers). */
export function detectLanguage(text: string): string | null {
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters) return null;
  const japanese = (letters.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) ?? [])
    .length;
  if (japanese / letters.length > 0.2) return 'ja';
  const latin = (letters.match(/\p{Script=Latin}/gu) ?? []).length;
  return latin / letters.length > 0.6 ? 'en' : null;
}
