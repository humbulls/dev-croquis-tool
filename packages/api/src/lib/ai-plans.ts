import { z } from 'zod';
import { CONTENT_BLOCK_TYPES, FIELD_LIMITS } from '@croquis/shared';

/** Shape the sitemap-generation prompt asks the model for. */
export const aiSitemapPlanSchema = z
  .array(
    z.object({
      path: z.string().trim().min(1).max(FIELD_LIMITS.pagePath),
      title: z.string().max(FIELD_LIMITS.pageTitle).default(''),
      purpose: z.string().max(FIELD_LIMITS.pagePurpose).default(''),
      audience: z.string().max(FIELD_LIMITS.pageAudience).default(''),
      /** Path of the parent page within the same plan (null = top level). */
      parent_path: z.string().nullable().default(null),
    }),
  )
  .min(1)
  .max(50);
export type AiSitemapPlan = z.infer<typeof aiSitemapPlanSchema>;

/**
 * Deduplicate by path and order entries so parents come before children.
 * Cycles or unknown parents degrade gracefully to depth 0 (treated as roots).
 */
export function orderSitemapPlan(plan: AiSitemapPlan): AiSitemapPlan {
  const byPath = new Map<string, AiSitemapPlan[number]>();
  for (const entry of plan) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, entry);
  }
  const entries = [...byPath.values()];

  const depthOf = (entry: AiSitemapPlan[number], seen: Set<string>): number => {
    if (!entry.parent_path || entry.parent_path === entry.path) return 0;
    const parent = byPath.get(entry.parent_path);
    if (!parent || seen.has(entry.path)) return 0;
    seen.add(entry.path);
    return 1 + depthOf(parent, seen);
  };

  return entries
    .map((entry) => ({ entry, depth: depthOf(entry, new Set()) }))
    .sort((a, b) => a.depth - b.depth)
    .map((item) => item.entry);
}

/** Shape the content-generation prompt asks the model for. */
export const aiContentPlanSchema = z
  .array(
    z.object({
      type: z.enum(CONTENT_BLOCK_TYPES),
      content: z.string().max(FIELD_LIMITS.contentBody),
    }),
  )
  .min(1)
  .max(20);
export type AiContentPlan = z.infer<typeof aiContentPlanSchema>;
