import { z } from 'zod';
import {
  COMMENT_STATUSES,
  CONTENT_BLOCK_TYPES,
  FIELD_LIMITS,
  MEMBER_ROLES,
  PAGE_STATUSES,
  VIEWPORT_KINDS,
} from './constants';

/** Schema format version for AI/JSON exports (semver). */
export const AI_EXPORT_SCHEMA_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const uuid = z.string().uuid();
/** Epoch milliseconds (matches `Date.now()`). */
export const epochMs = z.number().int().nonnegative();

export const pageStatusSchema = z.enum(PAGE_STATUSES);
export const memberRoleSchema = z.enum(MEMBER_ROLES);
export const contentBlockTypeSchema = z.enum(CONTENT_BLOCK_TYPES);
export const commentStatusSchema = z.enum(COMMENT_STATUSES);
export const viewportKindSchema = z.enum(VIEWPORT_KINDS);

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/**
 * Public-safe project shape. Contains NO keys/slugs — safe to include in the
 * client review (share) view and in exports.
 */
export const projectSchema = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  created_at: epochMs,
  updated_at: epochMs,
});
export type Project = z.infer<typeof projectSchema>;

/** Owner/admin view — adds the share slug and the write-only ingest key. */
export const ownerProjectSchema = projectSchema.extend({
  /** Public slug used for read-only client review links. */
  share_slug: z.string(),
  /** Public key embedded in the widget for write-only comment ingest. */
  ingest_key: z.string(),
  /** Whether the share link requires a password. */
  share_password_protected: z.boolean(),
});
export type OwnerProject = z.infer<typeof ownerProjectSchema>;

const sharePasswordSchema = z
  .string()
  .min(FIELD_LIMITS.sharePasswordMin)
  .max(FIELD_LIMITS.sharePasswordMax);

export const createProjectInput = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.projectName),
  /** Optional password for the public review link (min length enforced). */
  share_password: sharePasswordSchema.optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInput>;

export const updateProjectInput = z
  .object({
    name: z.string().trim().min(1).max(FIELD_LIMITS.projectName),
    /** Set to a string to enable/rotate; set to `null` to remove the password. */
    share_password: sharePasswordSchema.nullable(),
  })
  .partial();
export type UpdateProjectInput = z.infer<typeof updateProjectInput>;

/** Response for project creation — reveals the secret token exactly once. */
export const createdProjectSchema = ownerProjectSchema.extend({
  api_token: z.string(),
});
export type CreatedProject = z.infer<typeof createdProjectSchema>;

// ---------------------------------------------------------------------------
// Page (= sitemap node = content row = comment target)
// ---------------------------------------------------------------------------

export const pageSchema = z.object({
  id: uuid,
  project_id: uuid,
  parent_id: uuid.nullable(),
  path: z.string(),
  title: z.string(),
  purpose: z.string(),
  audience: z.string(),
  status: pageStatusSchema,
  sort_index: z.number().int(),
  created_at: epochMs,
  updated_at: epochMs,
});
export type Page = z.infer<typeof pageSchema>;

export const createPageInput = z.object({
  parent_id: uuid.nullable().optional(),
  path: z.string().trim().min(1).max(FIELD_LIMITS.pagePath),
  title: z.string().trim().max(FIELD_LIMITS.pageTitle).default(''),
  purpose: z.string().max(FIELD_LIMITS.pagePurpose).default(''),
  audience: z.string().max(FIELD_LIMITS.pageAudience).default(''),
  status: pageStatusSchema.default('todo'),
  sort_index: z.number().int().optional(),
});
export type CreatePageInput = z.infer<typeof createPageInput>;

export const updatePageInput = createPageInput.partial();
export type UpdatePageInput = z.infer<typeof updatePageInput>;

// ---------------------------------------------------------------------------
// Content block (a page's draft content)
// ---------------------------------------------------------------------------

export const contentBlockSchema = z.object({
  id: uuid,
  page_id: uuid,
  type: contentBlockTypeSchema,
  position: z.number().int(),
  content: z.string(),
  ai_generated: z.boolean(),
  created_at: epochMs,
  updated_at: epochMs,
});
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const createContentBlockInput = z.object({
  type: contentBlockTypeSchema,
  position: z.number().int().optional(),
  content: z.string().max(FIELD_LIMITS.contentBody).default(''),
  ai_generated: z.boolean().default(false),
});
export type CreateContentBlockInput = z.infer<typeof createContentBlockInput>;

export const updateContentBlockInput = createContentBlockInput.partial();
export type UpdateContentBlockInput = z.infer<typeof updateContentBlockInput>;

// ---------------------------------------------------------------------------
// Comment (review / correction request) + replies
// ---------------------------------------------------------------------------

/** Rich element metadata — the differentiator vs. selector-only tools. */
export const commentTargetSchema = z.object({
  element_selector: z.string().max(FIELD_LIMITS.selector).nullable().default(null),
  element_tag: z.string().max(FIELD_LIMITS.elementTag).nullable().default(null),
  element_text: z.string().max(FIELD_LIMITS.elementText).nullable().default(null),
  element_html: z.string().max(FIELD_LIMITS.elementHtml).nullable().default(null),
  element_context: z.string().max(FIELD_LIMITS.elementContext).nullable().default(null),
  element_attrs: z.string().max(FIELD_LIMITS.elementAttrs).nullable().default(null),
  computed_style: z.string().max(FIELD_LIMITS.computedStyle).nullable().default(null),
  rel_x: z.number().nullable().default(null),
  rel_y: z.number().nullable().default(null),
});

export const commentSchema = commentTargetSchema.extend({
  id: uuid,
  project_id: uuid,
  page_id: uuid.nullable(),
  page_url: z.string(),
  viewport: viewportKindSchema,
  viewport_w: z.number().int().nullable(),
  viewport_h: z.number().int().nullable(),
  body: z.string(),
  author_name: z.string().nullable(),
  status: commentStatusSchema,
  /** R2 object key of the captured screenshot, if any. */
  screenshot_key: z.string().nullable(),
  created_at: epochMs,
});
export type Comment = z.infer<typeof commentSchema>;

/** Payload posted by the embeddable widget (write-only ingest). */
export const createCommentInput = commentTargetSchema.extend({
  page_url: z.string().trim().min(1).max(FIELD_LIMITS.pageUrl),
  page_id: uuid.nullable().optional(),
  viewport: viewportKindSchema.default('desktop'),
  viewport_w: z.number().int().nullable().default(null),
  viewport_h: z.number().int().nullable().default(null),
  body: z.string().trim().min(1).max(FIELD_LIMITS.commentBody),
  author_name: z.string().max(FIELD_LIMITS.authorName).nullable().default(null),
  /**
   * `data:image/(png|jpeg|webp);base64,…` URL, size-capped. The API stores it
   * to R2 best-effort; the ingest response reports `screenshot_stored`.
   */
  screenshot: z.string().max(FIELD_LIMITS.screenshotDataUrl).nullable().default(null),
});
export type CreateCommentInput = z.infer<typeof createCommentInput>;

export const updateCommentInput = z.object({
  status: commentStatusSchema.optional(),
  page_id: uuid.nullable().optional(),
});
export type UpdateCommentInput = z.infer<typeof updateCommentInput>;

export const commentReplySchema = z.object({
  id: uuid,
  comment_id: uuid,
  author_name: z.string().nullable(),
  body: z.string(),
  created_at: epochMs,
});
export type CommentReply = z.infer<typeof commentReplySchema>;

export const createCommentReplyInput = z.object({
  author_name: z.string().max(FIELD_LIMITS.authorName).nullable().default(null),
  body: z.string().trim().min(1).max(FIELD_LIMITS.replyBody),
});
export type CreateCommentReplyInput = z.infer<typeof createCommentReplyInput>;

export const commentWithRepliesSchema = commentSchema.extend({
  replies: z.array(commentReplySchema),
});
export type CommentWithReplies = z.infer<typeof commentWithRepliesSchema>;

// ---------------------------------------------------------------------------
// Member (permission separation) — schema defined; management is P2
// ---------------------------------------------------------------------------

export const memberSchema = z.object({
  id: uuid,
  project_id: uuid,
  name: z.string(),
  email: z.string().nullable(),
  role: memberRoleSchema,
  created_at: epochMs,
});
export type Member = z.infer<typeof memberSchema>;

// ---------------------------------------------------------------------------
// AI / JSON export (the "hand to Claude/GPT" differentiator)
// ---------------------------------------------------------------------------

export const pageExportSchema = pageSchema.extend({
  content_blocks: z.array(contentBlockSchema),
  comments: z.array(commentWithRepliesSchema),
});
export type PageExport = z.infer<typeof pageExportSchema>;

export const projectExportSchema = z.object({
  schema_version: z.string(),
  exported_at: epochMs,
  project: projectSchema,
  /** Flat list; hierarchy is expressed via `parent_id` on each page. */
  pages: z.array(pageExportSchema),
  /** Comments not linked to any page. */
  orphan_comments: z.array(commentWithRepliesSchema),
});
export type ProjectExport = z.infer<typeof projectExportSchema>;
