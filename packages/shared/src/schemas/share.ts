import { z } from 'zod';
import { FIELD_LIMITS } from '../constants';
import { publicCommentSchema, publicReplySchema } from './comment';
import { epochMs, id } from './common';
import { approvalDecisionSchema, contentBlockSchema, pageStatusSchema } from './page';
import { publicProjectSchema } from './project';

/** GET /public/share/:slug — enough to render the gate. */
export const shareMetaSchema = z.object({
  project: publicProjectSchema,
  label: z.string(),
  password_required: z.boolean(),
  allow_comments: z.boolean(),
  allow_approvals: z.boolean(),
  /** The reviewed site with the widget activated for this link (`?croquis=<slug>`), when an origin is registered. */
  site_url: z.string().nullable(),
});
export type ShareMeta = z.infer<typeof shareMetaSchema>;

/** POST /public/share/:slug/session — exchanges the password (once) for a token. */
export const shareSessionInput = z.object({
  password: z.string().max(FIELD_LIMITS.passwordMax).optional(),
  /** Display name for comments/approvals made through this link. */
  name: z.string().trim().min(1).max(FIELD_LIMITS.authorName),
  email: z.email().max(FIELD_LIMITS.email).optional(),
  /** Re-use an existing reviewer identity from this browser. */
  reviewer_token: z.string().max(200).optional(),
});
export type ShareSessionInput = z.infer<typeof shareSessionInput>;

export const shareSessionSchema = z.object({
  /** Short-lived signed token for `Authorization: Bearer` on /public/share/* calls. */
  token: z.string(),
  expires_at: epochMs,
  /** Long-lived reviewer identity to store in the browser. */
  reviewer_token: z.string(),
  reviewer: z.object({ id, name: z.string() }),
});
export type ShareSession = z.infer<typeof shareSessionSchema>;

export const sharePageSchema = z.object({
  id,
  parent_id: id.nullable(),
  path: z.string(),
  title: z.string(),
  status: pageStatusSchema,
  sort_index: z.number().int(),
  comments_active: z.number().int(),
  approval: approvalDecisionSchema.nullable(),
});
export type SharePage = z.infer<typeof sharePageSchema>;

/** GET /public/share/:slug/pages/:id — a page and its drafted content, read-only. */
export const sharePageDetailSchema = sharePageSchema.extend({
  purpose: z.string(),
  audience: z.string(),
  content_blocks: z.array(
    contentBlockSchema.pick({ id: true, type: true, position: true, content: true }),
  ),
});
export type SharePageDetail = z.infer<typeof sharePageDetailSchema>;

export const shareCommentDetailSchema = publicCommentSchema.extend({
  replies: z.array(publicReplySchema),
  screenshot_url: z.string().nullable(),
});
export type ShareCommentDetail = z.infer<typeof shareCommentDetailSchema>;

export const shareReplyInput = z.object({
  body: z.string().trim().min(1).max(FIELD_LIMITS.replyBody),
});

/** POST /public/share/:slug/comments — a page-level comment from the share viewer. */
export const shareCommentInput = z.object({
  page_id: id,
  body: z.string().trim().min(1).max(FIELD_LIMITS.commentBody),
  kind: z.enum(['feedback', 'question']).default('feedback'),
});
export type ShareCommentInput = z.infer<typeof shareCommentInput>;

/** POST /public/share/:slug/pages/:id/approvals */
export const shareApprovalInput = z.object({
  decision: approvalDecisionSchema,
  note: z.string().max(FIELD_LIMITS.approvalNote).default(''),
});
export type ShareApprovalInput = z.infer<typeof shareApprovalInput>;

/** GET /public/widget/config — what the embedded widget needs before rendering. */
export const widgetConfigSchema = z.object({
  project: z.object({ id, name: z.string() }),
  widget_mode: z.enum(['activated', 'always', 'off']),
  /** True when comments need a reviewer session from a share link (`activated` mode). */
  requires_reviewer: z.boolean(),
  /** True when anonymous comments must carry a Turnstile token. */
  turnstile_site_key: z.string().nullable(),
});
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;
