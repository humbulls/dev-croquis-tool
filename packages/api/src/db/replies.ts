import type { CommentReply } from '@croquis/shared';

export interface ReplyRow {
  id: string;
  comment_id: string;
  author_name: string | null;
  body: string;
  created_at: number;
}

export function toReply(row: ReplyRow): CommentReply {
  return {
    id: row.id,
    comment_id: row.comment_id,
    author_name: row.author_name,
    body: row.body,
    created_at: row.created_at,
  };
}

export async function insertReply(db: D1Database, row: ReplyRow): Promise<void> {
  await db
    .prepare(
      'INSERT INTO comment_replies (id, comment_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(row.id, row.comment_id, row.author_name, row.body, row.created_at)
    .run();
}

export async function listRepliesByComment(db: D1Database, commentId: string): Promise<ReplyRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM comment_replies WHERE comment_id = ? ORDER BY created_at ASC')
    .bind(commentId)
    .all<ReplyRow>();
  return results;
}

/** All replies for a project's comments (used by export). */
export async function listRepliesByProject(db: D1Database, projectId: string): Promise<ReplyRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.* FROM comment_replies r
       JOIN comments c ON c.id = r.comment_id
       WHERE c.project_id = ?
       ORDER BY r.created_at ASC`,
    )
    .bind(projectId)
    .all<ReplyRow>();
  return results;
}
