import { z } from 'zod';
import {
  APPROVAL_DECISIONS,
  CONTENT_BLOCK_TYPES,
  FIELD_LIMITS,
  PAGE_STATUSES,
  REVIEW_ROUND_STATUSES,
} from '../constants';
import { epochMs, httpUrl, id } from './common';

export const pageStatusSchema = z.enum(PAGE_STATUSES);
export const contentBlockTypeSchema = z.enum(CONTENT_BLOCK_TYPES);
export const approvalDecisionSchema = z.enum(APPROVAL_DECISIONS);

/** A page is simultaneously a sitemap node, a content row and a review target. */
export const pageSchema = z.object({
  id,
  project_id: id,
  parent_id: id.nullable(),
  /** Site path; may be a pattern such as `/blog/:slug` or `/docs/*`. */
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

/** Page with review counters and the latest approval decision. */
export const pageWithStatsSchema = pageSchema.extend({
  comments_active: z.number().int(),
  comments_total: z.number().int(),
  approval: approvalDecisionSchema.nullable(),
});
export type PageWithStats = z.infer<typeof pageWithStatsSchema>;

const pagePath = z
  .string()
  .trim()
  .min(1)
  .max(FIELD_LIMITS.pagePath)
  .refine((v) => v.startsWith('/'), 'must start with "/"');

export const createPageInput = z.object({
  parent_id: id.nullable().optional(),
  path: pagePath,
  title: z.string().trim().max(FIELD_LIMITS.pageTitle).default(''),
  purpose: z.string().max(FIELD_LIMITS.pagePurpose).default(''),
  audience: z.string().max(FIELD_LIMITS.pageAudience).default(''),
  status: pageStatusSchema.default('todo'),
  sort_index: z.number().int().optional(),
});
export type CreatePageInput = z.infer<typeof createPageInput>;

/**
 * PATCH body. Declared explicitly (no `.default()`): `.partial()` of a schema
 * with defaults would inject them and overwrite fields the client never sent.
 */
export const updatePageInput = z.object({
  parent_id: id.nullable().optional(),
  path: pagePath.optional(),
  title: z.string().trim().max(FIELD_LIMITS.pageTitle).optional(),
  purpose: z.string().max(FIELD_LIMITS.pagePurpose).optional(),
  audience: z.string().max(FIELD_LIMITS.pageAudience).optional(),
  status: pageStatusSchema.optional(),
  sort_index: z.number().int().optional(),
});
export type UpdatePageInput = z.infer<typeof updatePageInput>;

/** Reorder siblings: the listed ids get sort_index 0..n-1 under `parent_id`. */
export const reorderPagesInput = z.object({
  parent_id: id.nullable(),
  page_ids: z.array(id).min(1).max(500),
});
export type ReorderPagesInput = z.infer<typeof reorderPagesInput>;

// --- Content blocks ---------------------------------------------------------

export const contentBlockSchema = z.object({
  id,
  page_id: id,
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

/** PATCH body — explicit, no defaults (see `updatePageInput`). */
export const updateContentBlockInput = z.object({
  type: contentBlockTypeSchema.optional(),
  position: z.number().int().optional(),
  content: z.string().max(FIELD_LIMITS.contentBody).optional(),
  ai_generated: z.boolean().optional(),
});
export type UpdateContentBlockInput = z.infer<typeof updateContentBlockInput>;

// --- Review rounds & approvals ------------------------------------------------

export const reviewRoundSchema = z.object({
  id,
  project_id: id,
  name: z.string(),
  preview_url: z.string().nullable(),
  status: z.enum(REVIEW_ROUND_STATUSES),
  created_at: epochMs,
  closed_at: epochMs.nullable(),
});
export type ReviewRound = z.infer<typeof reviewRoundSchema>;

export const createReviewRoundInput = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.pageTitle),
  preview_url: httpUrl.nullable().optional(),
});
export type CreateReviewRoundInput = z.infer<typeof createReviewRoundInput>;

export const updateReviewRoundInput = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.pageTitle).optional(),
  preview_url: httpUrl.nullable().optional(),
  status: z.enum(REVIEW_ROUND_STATUSES).optional(),
});
export type UpdateReviewRoundInput = z.infer<typeof updateReviewRoundInput>;

export const pageApprovalSchema = z.object({
  id,
  page_id: id,
  review_round_id: id.nullable(),
  decision: approvalDecisionSchema,
  approver_name: z.string(),
  approver_type: z.enum(['user', 'guest']),
  note: z.string(),
  created_at: epochMs,
});
export type PageApproval = z.infer<typeof pageApprovalSchema>;

export const createApprovalInput = z.object({
  decision: approvalDecisionSchema,
  note: z.string().max(FIELD_LIMITS.approvalNote).default(''),
  review_round_id: id.nullable().optional(),
});
export type CreateApprovalInput = z.infer<typeof createApprovalInput>;
