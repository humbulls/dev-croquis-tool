import type { OwnerProject, Project } from '@croquis/shared';

export interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  api_token_hash: string;
  ingest_key: string;
  share_slug: string;
  share_password_hash: string | null;
  created_at: number;
  updated_at: number;
}

/** Map a DB row to the public-safe project shape (no keys/slugs). */
export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Map a DB row to the owner/admin shape (adds share slug + ingest key). */
export function toOwnerProject(row: ProjectRow): OwnerProject {
  return {
    ...toProject(row),
    share_slug: row.share_slug,
    ingest_key: row.ingest_key,
    share_password_protected: row.share_password_hash !== null,
  };
}

export async function insertProject(db: D1Database, row: ProjectRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO projects
         (id, name, slug, api_token_hash, ingest_key, share_slug, share_password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.name,
      row.slug,
      row.api_token_hash,
      row.ingest_key,
      row.share_slug,
      row.share_password_hash,
      row.created_at,
      row.updated_at,
    )
    .run();
}

export function getProjectById(db: D1Database, id: string): Promise<ProjectRow | null> {
  return db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>();
}

export function getProjectByApiTokenHash(db: D1Database, hash: string): Promise<ProjectRow | null> {
  return db
    .prepare('SELECT * FROM projects WHERE api_token_hash = ?')
    .bind(hash)
    .first<ProjectRow>();
}

export function getProjectByIngestKey(db: D1Database, key: string): Promise<ProjectRow | null> {
  return db.prepare('SELECT * FROM projects WHERE ingest_key = ?').bind(key).first<ProjectRow>();
}

export function getProjectByShareSlug(db: D1Database, slug: string): Promise<ProjectRow | null> {
  return db.prepare('SELECT * FROM projects WHERE share_slug = ?').bind(slug).first<ProjectRow>();
}

export async function listProjects(db: D1Database): Promise<ProjectRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM projects ORDER BY created_at DESC')
    .all<ProjectRow>();
  return results;
}

export interface ProjectUpdate {
  name?: string;
  /** undefined = leave unchanged, null = remove password, string = hash to set. */
  share_password_hash?: string | null;
  updated_at: number;
}

export async function updateProject(
  db: D1Database,
  id: string,
  update: ProjectUpdate,
): Promise<void> {
  const sets: string[] = [];
  const binds: (string | number | null)[] = [];
  if (update.name !== undefined) {
    sets.push('name = ?');
    binds.push(update.name);
  }
  if ('share_password_hash' in update) {
    sets.push('share_password_hash = ?');
    binds.push(update.share_password_hash ?? null);
  }
  sets.push('updated_at = ?');
  binds.push(update.updated_at);
  binds.push(id);
  await db
    .prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
}

/** Delete a project and every dependent row (explicit cascade). */
export async function deleteProjectCascade(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db
      .prepare(
        'DELETE FROM comment_replies WHERE comment_id IN (SELECT id FROM comments WHERE project_id = ?)',
      )
      .bind(id),
    db.prepare('DELETE FROM comments WHERE project_id = ?').bind(id),
    db
      .prepare(
        'DELETE FROM content_blocks WHERE page_id IN (SELECT id FROM pages WHERE project_id = ?)',
      )
      .bind(id),
    db.prepare('DELETE FROM pages WHERE project_id = ?').bind(id),
    db.prepare('DELETE FROM members WHERE project_id = ?').bind(id),
    db.prepare('DELETE FROM projects WHERE id = ?').bind(id),
  ]);
}
