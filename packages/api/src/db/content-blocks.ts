import type { ContentBlock, ContentBlockType } from '@croquis/shared';

export interface ContentBlockRow {
  id: string;
  page_id: string;
  type: string;
  position: number;
  content: string;
  ai_generated: number;
  created_at: number;
  updated_at: number;
}

export function toContentBlock(row: ContentBlockRow): ContentBlock {
  return {
    id: row.id,
    page_id: row.page_id,
    type: row.type as ContentBlockType,
    position: row.position,
    content: row.content,
    ai_generated: row.ai_generated === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function insertContentBlock(db: D1Database, row: ContentBlockRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO content_blocks
         (id, page_id, type, position, content, ai_generated, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.page_id,
      row.type,
      row.position,
      row.content,
      row.ai_generated,
      row.created_at,
      row.updated_at,
    )
    .run();
}

export async function listContentBlocksByPage(
  db: D1Database,
  pageId: string,
): Promise<ContentBlockRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM content_blocks WHERE page_id = ? ORDER BY position ASC, created_at ASC')
    .bind(pageId)
    .all<ContentBlockRow>();
  return results;
}

export async function listContentBlocksByProject(
  db: D1Database,
  projectId: string,
): Promise<ContentBlockRow[]> {
  const { results } = await db
    .prepare(
      `SELECT cb.* FROM content_blocks cb
       JOIN pages p ON p.id = cb.page_id
       WHERE p.project_id = ?
       ORDER BY cb.position ASC, cb.created_at ASC`,
    )
    .bind(projectId)
    .all<ContentBlockRow>();
  return results;
}

export function getContentBlockById(
  db: D1Database,
  pageId: string,
  id: string,
): Promise<ContentBlockRow | null> {
  return db
    .prepare('SELECT * FROM content_blocks WHERE id = ? AND page_id = ?')
    .bind(id, pageId)
    .first<ContentBlockRow>();
}

export async function nextContentPosition(db: D1Database, pageId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(position), -1) AS max_pos FROM content_blocks WHERE page_id = ?')
    .bind(pageId)
    .first<{ max_pos: number }>();
  return (row?.max_pos ?? -1) + 1;
}

export interface ContentBlockUpdate {
  type?: ContentBlockType;
  position?: number;
  content?: string;
  ai_generated?: boolean;
  updated_at: number;
}

export async function updateContentBlock(
  db: D1Database,
  pageId: string,
  id: string,
  update: ContentBlockUpdate,
): Promise<void> {
  const sets: string[] = [];
  const binds: (string | number)[] = [];
  if (update.type !== undefined) {
    sets.push('type = ?');
    binds.push(update.type);
  }
  if (update.position !== undefined) {
    sets.push('position = ?');
    binds.push(update.position);
  }
  if (update.content !== undefined) {
    sets.push('content = ?');
    binds.push(update.content);
  }
  if (update.ai_generated !== undefined) {
    sets.push('ai_generated = ?');
    binds.push(update.ai_generated ? 1 : 0);
  }
  sets.push('updated_at = ?');
  binds.push(update.updated_at);
  binds.push(id, pageId);
  await db
    .prepare(`UPDATE content_blocks SET ${sets.join(', ')} WHERE id = ? AND page_id = ?`)
    .bind(...binds)
    .run();
}

export async function deleteContentBlock(
  db: D1Database,
  pageId: string,
  id: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM content_blocks WHERE id = ? AND page_id = ?')
    .bind(id, pageId)
    .run();
}
