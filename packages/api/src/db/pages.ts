import type { Page, PageStatus } from '@croquis/shared';

export interface PageRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  path: string;
  title: string;
  purpose: string;
  audience: string;
  status: string;
  sort_index: number;
  created_at: number;
  updated_at: number;
}

export function toPage(row: PageRow): Page {
  return {
    id: row.id,
    project_id: row.project_id,
    parent_id: row.parent_id,
    path: row.path,
    title: row.title,
    purpose: row.purpose,
    audience: row.audience,
    status: row.status as PageStatus,
    sort_index: row.sort_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function insertPage(db: D1Database, row: PageRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO pages
         (id, project_id, parent_id, path, title, purpose, audience, status, sort_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.project_id,
      row.parent_id,
      row.path,
      row.title,
      row.purpose,
      row.audience,
      row.status,
      row.sort_index,
      row.created_at,
      row.updated_at,
    )
    .run();
}

export function getPageById(
  db: D1Database,
  projectId: string,
  id: string,
): Promise<PageRow | null> {
  return db
    .prepare('SELECT * FROM pages WHERE id = ? AND project_id = ?')
    .bind(id, projectId)
    .first<PageRow>();
}

export async function listPagesByProject(db: D1Database, projectId: string): Promise<PageRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM pages WHERE project_id = ? ORDER BY sort_index ASC, created_at ASC')
    .bind(projectId)
    .all<PageRow>();
  return results;
}

export async function nextSortIndex(
  db: D1Database,
  projectId: string,
  parentId: string | null,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(sort_index), -1) AS max_index FROM pages
       WHERE project_id = ? AND parent_id IS ?`,
    )
    .bind(projectId, parentId)
    .first<{ max_index: number }>();
  return (row?.max_index ?? -1) + 1;
}

export interface PageUpdate {
  parent_id?: string | null;
  path?: string;
  title?: string;
  purpose?: string;
  audience?: string;
  status?: PageStatus;
  sort_index?: number;
  updated_at: number;
}

export async function updatePage(
  db: D1Database,
  projectId: string,
  id: string,
  update: PageUpdate,
): Promise<void> {
  const sets: string[] = [];
  const binds: (string | number | null)[] = [];
  const columns: (keyof PageUpdate)[] = [
    'parent_id',
    'path',
    'title',
    'purpose',
    'audience',
    'status',
    'sort_index',
  ];
  for (const col of columns) {
    if (col in update && update[col] !== undefined) {
      sets.push(`${col} = ?`);
      binds.push(update[col] as string | number | null);
    }
  }
  sets.push('updated_at = ?');
  binds.push(update.updated_at);
  binds.push(id, projectId);
  await db
    .prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`)
    .bind(...binds)
    .run();
}

/**
 * Delete a page: promote its children to the deleted page's parent, drop its
 * content blocks, and unlink (not delete) its comments.
 */
export async function deletePageCascade(
  db: D1Database,
  projectId: string,
  page: PageRow,
): Promise<void> {
  await db.batch([
    db
      .prepare('UPDATE pages SET parent_id = ? WHERE parent_id = ? AND project_id = ?')
      .bind(page.parent_id, page.id, projectId),
    db.prepare('DELETE FROM content_blocks WHERE page_id = ?').bind(page.id),
    db.prepare('UPDATE comments SET page_id = NULL WHERE page_id = ?').bind(page.id),
    db.prepare('DELETE FROM pages WHERE id = ? AND project_id = ?').bind(page.id, projectId),
  ]);
}
