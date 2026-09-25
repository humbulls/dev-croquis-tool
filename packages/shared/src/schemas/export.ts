import { z } from 'zod';
import { commentSchema, replySchema } from './comment';
import { epochMs } from './common';
import { contentBlockSchema, pageApprovalSchema, pageSchema } from './page';
import { projectSchema } from './project';

export const exportCommentSchema = commentSchema.extend({ replies: z.array(replySchema) });
export type ExportComment = z.infer<typeof exportCommentSchema>;

export const exportPageSchema = pageSchema.extend({
  content_blocks: z.array(contentBlockSchema),
  comments: z.array(exportCommentSchema),
  approvals: z.array(pageApprovalSchema),
});
export type ExportPage = z.infer<typeof exportPageSchema>;

/**
 * The "hand this to an agent" document: the whole project, flat, with the page
 * hierarchy expressed through `parent_id`. Internal replies are excluded.
 */
export const projectExportSchema = z.object({
  schema_version: z.string(),
  exported_at: epochMs,
  project: projectSchema.omit({ ingest_key: true }),
  pages: z.array(exportPageSchema),
  /** Comments whose URL matched no page. */
  unassigned_comments: z.array(exportCommentSchema),
});
export type ProjectExport = z.infer<typeof projectExportSchema>;
