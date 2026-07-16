/**
 * Domain constants shared across API, dashboard, widget and MCP.
 * These are the single source of truth for enum-like values.
 */

/** Lifecycle status of a page in the production pipeline. */
export const PAGE_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

/** Human-readable labels (UI may localize further). */
export const PAGE_STATUS_LABELS: Record<PageStatus, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Done',
};

/** Role of a project member (permission separation). */
export const MEMBER_ROLES = ['owner', 'editor', 'reviewer', 'client'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Type of a content block that makes up a page's draft. */
export const CONTENT_BLOCK_TYPES = ['heading', 'body', 'image', 'cta'] as const;
export type ContentBlockType = (typeof CONTENT_BLOCK_TYPES)[number];

/** Status of a review comment. */
export const COMMENT_STATUSES = ['open', 'resolved'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/** Viewport a comment/screenshot was captured against. */
export const VIEWPORT_KINDS = ['desktop', 'mobile'] as const;
export type ViewportKind = (typeof VIEWPORT_KINDS)[number];

/**
 * Defensive size limits (mirrored by the API on write). Keeping them here means
 * the widget and dashboard can validate before sending.
 */
export const FIELD_LIMITS = {
  projectName: 120,
  pagePath: 512,
  pageTitle: 200,
  pagePurpose: 1000,
  pageAudience: 200,
  contentBody: 20_000,
  commentBody: 4000,
  authorName: 120,
  elementTag: 32,
  elementText: 500,
  elementHtml: 4000,
  elementContext: 400,
  elementAttrs: 2000,
  computedStyle: 2000,
  selector: 1000,
  replyBody: 4000,
  pageUrl: 2048,
  /** Human-chosen password: enforce a minimum length. */
  sharePasswordMin: 8,
  sharePasswordMax: 200,
  /** Base64 data-URL budget for a ~4MB screenshot (4/3 overhead + header). */
  screenshotDataUrl: 5_800_000,
} as const;

/** Screenshots are stored in R2 under this prefix. */
export const SCREENSHOT_R2_PREFIX = 'screenshots/';
