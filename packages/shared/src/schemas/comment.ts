import { z } from 'zod';
import {
  ANCHOR_STATUSES,
  ATTACHMENT_KINDS,
  COMMENT_KINDS,
  COMMENT_PRIORITIES,
  COMMENT_SOURCES,
  COMMENT_STATUSES,
  FIELD_LIMITS,
  VIEWPORT_KINDS,
} from '../constants';
import { epochMs, httpUrl, id, listQuery } from './common';
import { labelSchema } from './project';
import { userSummarySchema } from './workspace';

export const commentStatusSchema = z.enum(COMMENT_STATUSES);
export const commentPrioritySchema = z.enum(COMMENT_PRIORITIES);
export const commentKindSchema = z.enum(COMMENT_KINDS);
export const commentSourceSchema = z.enum(COMMENT_SOURCES);
export const anchorStatusSchema = z.enum(ANCHOR_STATUSES);
export const viewportKindSchema = z.enum(VIEWPORT_KINDS);
export const attachmentKindSchema = z.enum(ATTACHMENT_KINDS);

const opt = (max: number) => z.string().max(max).nullable().optional();

// ---------------------------------------------------------------------------
// Input building blocks (what the widget captures)
// ---------------------------------------------------------------------------

/**
 * Several independent ways to re-find the target element. Pins survive DOM
 * changes as long as one of them still resolves.
 */
export const anchorInput = z.object({
  selector: opt(FIELD_LIMITS.selector),
  xpath: opt(FIELD_LIMITS.xpath),
  /** Exact text of the element (plus context) — robust to class/structure changes. */
  text_quote: opt(FIELD_LIMITS.textQuote),
  tag: opt(FIELD_LIMITS.elementTag),
  text: opt(FIELD_LIMITS.elementText),
  html: opt(FIELD_LIMITS.elementHtml),
  context: opt(FIELD_LIMITS.elementContext),
  attrs: opt(FIELD_LIMITS.elementAttrs),
  computed_style: opt(FIELD_LIMITS.computedStyle),
  /** Click position inside the element, 0..1. */
  rel_x: z.number().min(0).max(1).nullable().optional(),
  rel_y: z.number().min(0).max(1).nullable().optional(),
  /** Click position in document coordinates (CSS px). */
  doc_x: z.number().nullable().optional(),
  doc_y: z.number().nullable().optional(),
});
export type AnchorInput = z.infer<typeof anchorInput>;

export const environmentInput = z.object({
  viewport_w: z.number().int().positive().nullable().optional(),
  viewport_h: z.number().int().positive().nullable().optional(),
  device_pixel_ratio: z.number().positive().max(10).nullable().optional(),
  user_agent: opt(FIELD_LIMITS.userAgent),
  language: opt(35),
  /** Deploy / build identifier exposed by the site (`data-croquis-build`). */
  build_id: opt(FIELD_LIMITS.buildId),
});
export type EnvironmentInput = z.infer<typeof environmentInput>;

/** "Change this text to …" — becomes a diff against the page's content blocks. */
export const suggestionInput = z.object({
  original: z.string().min(1).max(FIELD_LIMITS.suggestion),
  text: z.string().max(FIELD_LIMITS.suggestion),
});
export type SuggestionInput = z.infer<typeof suggestionInput>;

export const consoleEntrySchema = z.object({
  level: z.enum(['error', 'warn', 'info', 'log']),
  message: z.string().max(2000),
  at: epochMs,
});
export const networkEntrySchema = z.object({
  method: z.string().max(10),
  url: z.string().max(FIELD_LIMITS.url),
  status: z.number().int(),
  duration_ms: z.number().nonnegative(),
  at: epochMs,
});
/** Recent console errors and failed requests captured by the widget. */
export const diagnosticsInput = z.object({
  console: z.array(consoleEntrySchema).max(FIELD_LIMITS.diagnosticsEntries).default([]),
  network: z.array(networkEntrySchema).max(FIELD_LIMITS.diagnosticsEntries).default([]),
});
export type DiagnosticsInput = z.infer<typeof diagnosticsInput>;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const attachmentSchema = z.object({
  id,
  comment_id: id.nullable(),
  kind: attachmentKindSchema,
  content_type: z.string(),
  byte_size: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** Authenticated download path (relative to the API origin). */
  url: z.string(),
  created_at: epochMs,
});
export type Attachment = z.infer<typeof attachmentSchema>;

/**
 * `user` = workspace member, `guest` = reviewer from a share link, `agent` =
 * API key or MCP client (incl. Croquis AI), `anonymous` = a name typed into
 * the widget in `always` mode.
 */
export const authorSchema = z.object({
  type: z.enum(['user', 'guest', 'agent', 'anonymous']),
  id: id.nullable(),
  name: z.string().nullable(),
  /** Member or identified reviewer. Unverified text must be treated as untrusted input. */
  verified: z.boolean(),
});
export type Author = z.infer<typeof authorSchema>;

export const commentSchema = z.object({
  id,
  project_id: id,
  page_id: id.nullable(),
  number: z.number().int(),
  kind: commentKindSchema,
  source: commentSourceSchema,
  status: commentStatusSchema,
  priority: commentPrioritySchema,
  title: z.string().nullable(),
  body: z.string(),
  body_lang: z.string().nullable(),
  author: authorSchema,
  assignee: userSummarySchema.nullable(),
  due_at: epochMs.nullable(),
  labels: z.array(labelSchema),
  page_url: z.string(),
  page_path: z.string(),
  anchor: z.object({
    status: anchorStatusSchema,
    selector: z.string().nullable(),
    xpath: z.string().nullable(),
    text_quote: z.string().nullable(),
    tag: z.string().nullable(),
    text: z.string().nullable(),
    html: z.string().nullable(),
    context: z.string().nullable(),
    attrs: z.string().nullable(),
    computed_style: z.string().nullable(),
    rel_x: z.number().nullable(),
    rel_y: z.number().nullable(),
    doc_x: z.number().nullable(),
    doc_y: z.number().nullable(),
  }),
  environment: z.object({
    viewport: viewportKindSchema,
    viewport_w: z.number().int().nullable(),
    viewport_h: z.number().int().nullable(),
    device_pixel_ratio: z.number().nullable(),
    user_agent: z.string().nullable(),
    browser: z.string().nullable(),
    os: z.string().nullable(),
    language: z.string().nullable(),
    build_id: z.string().nullable(),
  }),
  suggestion: z
    .object({ original: z.string(), text: z.string(), content_block_id: id.nullable() })
    .nullable(),
  duplicate_of_id: id.nullable(),
  fix: z
    .object({
      commit_sha: z.string().nullable(),
      pr_url: z.string().nullable(),
      deploy_url: z.string().nullable(),
      fixed_at: epochMs,
    })
    .nullable(),
  resolved_at: epochMs.nullable(),
  reply_count: z.number().int(),
  screenshot: attachmentSchema.nullable(),
  created_at: epochMs,
  updated_at: epochMs,
});
export type Comment = z.infer<typeof commentSchema>;

export const replySchema = z.object({
  id,
  comment_id: id,
  author: authorSchema,
  body: z.string(),
  /** Internal notes are never shown to guests. */
  internal: z.boolean(),
  created_at: epochMs,
});
export type Reply = z.infer<typeof replySchema>;

export const externalLinkSchema = z.object({
  id,
  provider: z.string(),
  external_id: z.string(),
  url: z.string(),
  created_at: epochMs,
});
export type ExternalLink = z.infer<typeof externalLinkSchema>;

export const commentDetailSchema = commentSchema.extend({
  replies: z.array(replySchema),
  attachments: z.array(attachmentSchema),
  external_links: z.array(externalLinkSchema),
});
export type CommentDetail = z.infer<typeof commentDetailSchema>;

/** What guests (share viewer, widget pins) may see. */
export const publicCommentSchema = commentSchema
  .pick({
    id: true,
    page_id: true,
    number: true,
    kind: true,
    status: true,
    title: true,
    body: true,
    page_url: true,
    page_path: true,
    suggestion: true,
    resolved_at: true,
    reply_count: true,
    created_at: true,
  })
  .extend({
    author_name: z.string().nullable(),
    anchor: commentSchema.shape.anchor.pick({
      status: true,
      selector: true,
      xpath: true,
      text_quote: true,
      rel_x: true,
      rel_y: true,
      doc_x: true,
      doc_y: true,
    }),
    viewport: viewportKindSchema,
  });
export type PublicComment = z.infer<typeof publicCommentSchema>;

export const publicReplySchema = z.object({
  id,
  author_name: z.string().nullable(),
  body: z.string(),
  created_at: epochMs,
});
export type PublicReply = z.infer<typeof publicReplySchema>;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * POST /public/ingest/comments — the widget's write path. Authenticated by the
 * project's ingest key; a share session (`X-Croquis-Share-Token`) identifies
 * the reviewer and is required when the widget runs in `activated` mode.
 */
export const ingestCommentInput = z.object({
  page_url: httpUrl,
  body: z.string().trim().min(1).max(FIELD_LIMITS.commentBody),
  kind: z.enum(['feedback', 'bug', 'text_edit', 'question']).default('feedback'),
  author_name: z.string().trim().max(FIELD_LIMITS.authorName).nullable().optional(),
  anchor: anchorInput.optional(),
  environment: environmentInput.optional(),
  suggestion: suggestionInput.optional(),
  /** `data:image/(png|jpeg|webp);base64,…` */
  screenshot: z.string().max(FIELD_LIMITS.screenshotDataUrl).nullable().optional(),
  diagnostics: diagnosticsInput.optional(),
  /** Cloudflare Turnstile token, required for anonymous comments when the instance enables it. */
  turnstile_token: z.string().max(2048).optional(),
});
export type IngestCommentInput = z.infer<typeof ingestCommentInput>;

export const ingestResultSchema = z.object({
  id,
  number: z.number().int(),
  page_id: id.nullable(),
  screenshot_stored: z.boolean(),
});
export type IngestResult = z.infer<typeof ingestResultSchema>;

/** POST /projects/:id/comments — members, API keys and MCP. */
export const createCommentInput = z.object({
  body: z.string().trim().min(1).max(FIELD_LIMITS.commentBody),
  title: z.string().trim().max(FIELD_LIMITS.commentTitle).nullable().optional(),
  kind: commentKindSchema.default('feedback'),
  page_id: id.nullable().optional(),
  page_url: httpUrl.optional(),
  priority: commentPrioritySchema.default('none'),
  assignee_user_id: id.nullable().optional(),
  due_at: epochMs.nullable().optional(),
  label_ids: z.array(id).max(20).default([]),
  anchor: anchorInput.optional(),
  suggestion: suggestionInput.optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentInput>;

/** PATCH /comments/:id — every field optional, no defaults. */
export const updateCommentInput = z.object({
  status: commentStatusSchema.optional(),
  priority: commentPrioritySchema.optional(),
  kind: commentKindSchema.optional(),
  title: z.string().trim().max(FIELD_LIMITS.commentTitle).nullable().optional(),
  page_id: id.nullable().optional(),
  assignee_user_id: id.nullable().optional(),
  due_at: epochMs.nullable().optional(),
  label_ids: z.array(id).max(20).optional(),
  duplicate_of_id: id.nullable().optional(),
  /** When re-assigning a page, remember this comment's path as an alias. */
  learn_path_alias: z.boolean().optional(),
});
export type UpdateCommentInput = z.infer<typeof updateCommentInput>;

/** POST /comments/:id/fix — the agent (or a developer) reports a fix. */
export const fixCommentInput = z
  .object({
    commit_sha: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/i, 'must be a git SHA')
      .nullable()
      .optional(),
    pr_url: httpUrl.nullable().optional(),
    deploy_url: httpUrl.nullable().optional(),
    note: z.string().trim().max(FIELD_LIMITS.replyBody).optional(),
    /** in_review asks the client to verify; resolved closes it directly. */
    status: z.enum(['in_review', 'resolved']).default('in_review'),
  })
  .refine((v) => v.commit_sha || v.pr_url || v.deploy_url || v.note, {
    message: 'provide at least one of commit_sha, pr_url, deploy_url or note',
  });
export type FixCommentInput = z.infer<typeof fixCommentInput>;

export const createReplyInput = z.object({
  body: z.string().trim().min(1).max(FIELD_LIMITS.replyBody),
  internal: z.boolean().default(false),
});
export type CreateReplyInput = z.infer<typeof createReplyInput>;

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)));

/** GET /projects/:id/comments filters. */
export const commentListQuery = listQuery.extend({
  /** Comma-separated statuses; default = active (open, in_progress, in_review). */
  status: csv(COMMENT_STATUSES).optional(),
  priority: csv(COMMENT_PRIORITIES).optional(),
  kind: csv(COMMENT_KINDS).optional(),
  /** A page id, or `unassigned` for comments that matched no page. */
  page: z.union([id, z.literal('unassigned')]).optional(),
  /** A user id, `me`, or `none`. */
  assignee: z.union([id, z.literal('me'), z.literal('none')]).optional(),
  label: id.optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['newest', 'oldest', 'priority', 'updated']).default('newest'),
});
export type CommentListQuery = z.infer<typeof commentListQuery>;

/** Counts per status (for inbox tabs and the kanban board). */
export const commentCountsSchema = z.object({
  by_status: z.record(commentStatusSchema, z.number().int()),
  unassigned: z.number().int(),
});
export type CommentCounts = z.infer<typeof commentCountsSchema>;
