import type { Comment, CommentStatus, ViewportKind } from '@croquis/shared';

export interface CommentRow {
  id: string;
  project_id: string;
  page_id: string | null;
  page_url: string;
  viewport: string;
  viewport_w: number | null;
  viewport_h: number | null;
  body: string;
  author_name: string | null;
  status: string;
  screenshot_key: string | null;
  element_selector: string | null;
  element_tag: string | null;
  element_text: string | null;
  element_html: string | null;
  element_context: string | null;
  element_attrs: string | null;
  computed_style: string | null;
  rel_x: number | null;
  rel_y: number | null;
  created_at: number;
}

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    project_id: row.project_id,
    page_id: row.page_id,
    page_url: row.page_url,
    viewport: row.viewport as ViewportKind,
    viewport_w: row.viewport_w,
    viewport_h: row.viewport_h,
    body: row.body,
    author_name: row.author_name,
    status: row.status as CommentStatus,
    screenshot_key: row.screenshot_key,
    element_selector: row.element_selector,
    element_tag: row.element_tag,
    element_text: row.element_text,
    element_html: row.element_html,
    element_context: row.element_context,
    element_attrs: row.element_attrs,
    computed_style: row.computed_style,
    rel_x: row.rel_x,
    rel_y: row.rel_y,
    created_at: row.created_at,
  };
}

export async function insertComment(db: D1Database, row: CommentRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO comments
         (id, project_id, page_id, page_url, viewport, viewport_w, viewport_h, body, author_name,
          status, screenshot_key, element_selector, element_tag, element_text, element_html,
          element_context, element_attrs, computed_style, rel_x, rel_y, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.project_id,
      row.page_id,
      row.page_url,
      row.viewport,
      row.viewport_w,
      row.viewport_h,
      row.body,
      row.author_name,
      row.status,
      row.screenshot_key,
      row.element_selector,
      row.element_tag,
      row.element_text,
      row.element_html,
      row.element_context,
      row.element_attrs,
      row.computed_style,
      row.rel_x,
      row.rel_y,
      row.created_at,
    )
    .run();
}

export function getCommentById(
  db: D1Database,
  projectId: string,
  id: string,
): Promise<CommentRow | null> {
  return db
    .prepare('SELECT * FROM comments WHERE id = ? AND project_id = ?')
    .bind(id, projectId)
    .first<CommentRow>();
}

export interface CommentFilter {
  status?: CommentStatus;
  pageId?: string;
}

export async function listCommentsByProject(
  db: D1Database,
  projectId: string,
  filter: CommentFilter = {},
): Promise<CommentRow[]> {
  let sql = 'SELECT * FROM comments WHERE project_id = ?';
  const binds: (string | number)[] = [projectId];
  if (filter.status) {
    sql += ' AND status = ?';
    binds.push(filter.status);
  }
  if (filter.pageId) {
    sql += ' AND page_id = ?';
    binds.push(filter.pageId);
  }
  sql += ' ORDER BY created_at DESC';
  const { results } = await db
    .prepare(sql)
    .bind(...binds)
    .all<CommentRow>();
  return results;
}

export interface CommentUpdate {
  status?: CommentStatus;
  page_id?: string | null;
}

export async function updateComment(
  db: D1Database,
  projectId: string,
  id: string,
  update: CommentUpdate,
): Promise<void> {
  const sets: string[] = [];
  const binds: (string | number | null)[] = [];
  if (update.status !== undefined) {
    sets.push('status = ?');
    binds.push(update.status);
  }
  if ('page_id' in update) {
    sets.push('page_id = ?');
    binds.push(update.page_id ?? null);
  }
  if (sets.length === 0) return;
  binds.push(id, projectId);
  await db
    .prepare(`UPDATE comments SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`)
    .bind(...binds)
    .run();
}

export async function deleteCommentCascade(
  db: D1Database,
  projectId: string,
  id: string,
): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM comment_replies WHERE comment_id = ?').bind(id),
    db.prepare('DELETE FROM comments WHERE id = ? AND project_id = ?').bind(id, projectId),
  ]);
}
