import { z } from 'zod';
import { FIELD_LIMITS } from '../constants';
import { publicCommentSchema, publicReplySchema } from './comment';
import { epochMs, id } from './common';
import { approvalDecisionSchema, pageStatusSchema } from './page';
import { publicProjectSchema } from './project';

/** GET /public/share/:slug — enough to render the gate. */
export const shareMetaSchema = z.object({
  project: publicProjectSchema,
  label: z.string(),
  password_required: z.boolean(),
  allow_comments: z.boolean(),
  allow_approvals: z.boolean(),
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

export const shareCommentDetailSchema = publicCommentSchema.extend({
  replies: z.array(publicReplySchema),
  screenshot_url: z.string().nullable(),
});
export type ShareCommentDetail = z.infer<typeof shareCommentDetailSchema>;

export const shareReplyInput = z.object({
  body: z.string().trim().min(1).max(FIELD_LIMITS.replyBody),
});
