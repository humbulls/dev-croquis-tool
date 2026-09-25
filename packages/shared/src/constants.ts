/**
 * Domain constants shared by the API, dashboard, widget and MCP server.
 * This module has no runtime dependencies so the widget can import it
 * (`@croquis/shared/constants`) without pulling in Zod.
 */

// ---------------------------------------------------------------------------
// Workspaces & access
// ---------------------------------------------------------------------------

export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/**
 * API key scopes. `*` grants everything the key's workspace/project allows.
 * `<resource>:read` is implied by `<resource>:write`.
 */
export const API_KEY_SCOPES = [
  '*',
  'projects:read',
  'projects:write',
  'pages:read',
  'pages:write',
  'comments:read',
  'comments:write',
  'ai:run',
  'webhooks:write',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * How new accounts may be created on an instance.
 * - `invite` (default): only people holding a pending invitation can sign up
 *   (plus the first owner, through /setup).
 * - `open`: anyone can sign up and create their own workspace (Croquis Cloud).
 */
export const SIGNUP_MODES = ['invite', 'open'] as const;
export type SignupMode = (typeof SIGNUP_MODES)[number];

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * When the widget appears on the host page.
 * - activated: only with `?croquis` in the URL or an active reviewer session
 * - always: every visitor sees the launcher
 * - off: the widget stays silent
 */
export const WIDGET_MODES = ['activated', 'always', 'off'] as const;
export type WidgetMode = (typeof WIDGET_MODES)[number];

export const ORIGIN_ENVIRONMENTS = ['production', 'staging', 'preview', 'local'] as const;
export type OriginEnvironment = (typeof ORIGIN_ENVIRONMENTS)[number];

// ---------------------------------------------------------------------------
// Pages & content
// ---------------------------------------------------------------------------

export const PAGE_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

export const CONTENT_BLOCK_TYPES = ['heading', 'body', 'image', 'cta'] as const;
export type ContentBlockType = (typeof CONTENT_BLOCK_TYPES)[number];

export const APPROVAL_DECISIONS = ['approved', 'changes_requested'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const REVIEW_ROUND_STATUSES = ['open', 'closed'] as const;
export type ReviewRoundStatus = (typeof REVIEW_ROUND_STATUSES)[number];

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const COMMENT_STATUSES = [
  'open',
  'in_progress',
  'in_review',
  'resolved',
  'wont_fix',
] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/** Statuses that still need work (shown by default in the inbox). */
export const ACTIVE_COMMENT_STATUSES = [
  'open',
  'in_progress',
  'in_review',
] as const satisfies readonly CommentStatus[];
/** Statuses that close a comment. */
export const CLOSED_COMMENT_STATUSES = [
  'resolved',
  'wont_fix',
] as const satisfies readonly CommentStatus[];

export const COMMENT_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type CommentPriority = (typeof COMMENT_PRIORITIES)[number];

export const COMMENT_KINDS = ['feedback', 'bug', 'text_edit', 'typo', 'question'] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const COMMENT_SOURCES = ['widget', 'share', 'dashboard', 'api', 'mcp', 'ai'] as const;
export type CommentSource = (typeof COMMENT_SOURCES)[number];

/**
 * - anchored: the target element was found when the comment was made
 * - orphaned: the element can no longer be found on the page
 * - page: a page-level comment with no element target
 */
export const ANCHOR_STATUSES = ['anchored', 'orphaned', 'page'] as const;
export type AnchorStatus = (typeof ANCHOR_STATUSES)[number];

export const VIEWPORT_KINDS = ['desktop', 'tablet', 'mobile'] as const;
export type ViewportKind = (typeof VIEWPORT_KINDS)[number];

/** Viewport width breakpoints (CSS px) used to classify a comment's viewport. */
export const VIEWPORT_BREAKPOINTS = { mobileMax: 767, tabletMax: 1023 } as const;

export const ATTACHMENT_KINDS = ['screenshot', 'console_log', 'network_log', 'file'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** Label colors are design-token names, never raw values. */
export const LABEL_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export const ACTOR_TYPES = ['user', 'guest', 'api_key', 'agent', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Event types written to the activity log and delivered to webhooks. */
export const EVENT_TYPES = [
  'project.created',
  'project.updated',
  'page.created',
  'page.updated',
  'page.deleted',
  'page.approved',
  'page.changes_requested',
  'comment.created',
  'comment.updated',
  'comment.status_changed',
  'comment.assigned',
  'comment.fixed',
  'comment.deleted',
  'reply.created',
  'review_round.opened',
  'review_round.closed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const INTEGRATION_PROVIDERS = ['github', 'linear', 'slack'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const AI_RUN_KINDS = [
  'sitemap',
  'content',
  'digest',
  'triage',
  'typo_check',
  'translate',
  'title',
] as const;
export type AiRunKind = (typeof AI_RUN_KINDS)[number];

export const SUPPORTED_LOCALES = ['en', 'ja'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Size limits enforced by the API on write. The widget and dashboard use the
 * same numbers to validate before sending.
 */
export const FIELD_LIMITS = {
  workspaceName: 80,
  projectName: 120,
  projectDescription: 1000,
  pagePath: 512,
  pageTitle: 200,
  pagePurpose: 1000,
  pageAudience: 200,
  contentBody: 20_000,
  commentTitle: 200,
  commentBody: 4000,
  replyBody: 4000,
  authorName: 120,
  email: 254,
  elementTag: 32,
  elementText: 500,
  elementHtml: 4000,
  elementContext: 400,
  elementAttrs: 2000,
  computedStyle: 2000,
  selector: 1000,
  xpath: 1000,
  textQuote: 1000,
  suggestion: 4000,
  userAgent: 512,
  buildId: 128,
  url: 2048,
  labelName: 40,
  shareLinkLabel: 80,
  approvalNote: 2000,
  apiKeyName: 80,
  webhookDescription: 200,
  /** Human-chosen password: enforce a minimum length. */
  passwordMin: 8,
  passwordMax: 200,
  /** Base64 data-URL budget for a ~4 MB screenshot (4/3 overhead + header). */
  screenshotDataUrl: 5_800_000,
  /** Console/network log entries kept by the widget per comment. */
  diagnosticsEntries: 50,
  diagnosticsJson: 200_000,
  aiBrief: 4000,
} as const;

/** Pagination bounds for list endpoints. */
export const PAGE_SIZE = { default: 50, max: 200 } as const;

/** R2 key prefixes. */
export const R2_PREFIX = { attachments: 'attachments/' } as const;

/** Version of the JSON / Markdown export format (semver). */
export const EXPORT_SCHEMA_VERSION = '1.0.0';
