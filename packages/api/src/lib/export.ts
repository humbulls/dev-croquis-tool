import {
  AI_EXPORT_SCHEMA_VERSION,
  type CommentWithReplies,
  type ProjectExport,
} from '@croquis/shared';
import { listCommentsByProject, toComment } from '../db/comments';
import { listContentBlocksByProject, toContentBlock } from '../db/content-blocks';
import { listPagesByProject, toPage } from '../db/pages';
import { type ProjectRow, toProject } from '../db/projects';
import { listRepliesByProject, toReply } from '../db/replies';

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/** Build the full AI/JSON export envelope for a project. */
export async function buildProjectExport(
  db: D1Database,
  project: ProjectRow,
): Promise<ProjectExport> {
  const [pages, blocks, comments, replies] = await Promise.all([
    listPagesByProject(db, project.id),
    listContentBlocksByProject(db, project.id),
    listCommentsByProject(db, project.id),
    listRepliesByProject(db, project.id),
  ]);

  const repliesByComment = groupBy(replies, (r) => r.comment_id);
  const commentsWithReplies: CommentWithReplies[] = comments.map((row) => ({
    ...toComment(row),
    replies: (repliesByComment.get(row.id) ?? []).map(toReply),
  }));

  const blocksByPage = groupBy(blocks, (b) => b.page_id);
  const commentsByPage = groupBy(
    commentsWithReplies.filter((c) => c.page_id !== null),
    (c) => c.page_id as string,
  );

  const pageExports = pages.map((row) => ({
    ...toPage(row),
    content_blocks: (blocksByPage.get(row.id) ?? []).map(toContentBlock),
    comments: commentsByPage.get(row.id) ?? [],
  }));

  const orphanComments = commentsWithReplies.filter((c) => c.page_id === null);

  return {
    schema_version: AI_EXPORT_SCHEMA_VERSION,
    exported_at: Date.now(),
    project: toProject(project),
    pages: pageExports,
    orphan_comments: orphanComments,
  };
}
