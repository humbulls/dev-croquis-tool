import type { Label, Project, ProjectOrigin, ProjectWithStats, ShareLink } from '@croquis/shared';
import type { ProjectRow } from '../security/access';

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    ingest_key: row.ingest_key,
    widget_mode: row.widget_mode,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Project columns plus the counters shown on project cards. */
export const PROJECT_WITH_STATS_SELECT = `
  SELECT p.*,
    (SELECT COUNT(*) FROM pages pg WHERE pg.project_id = p.id) AS stat_pages,
    (SELECT COUNT(*) FROM comments cm WHERE cm.project_id = p.id
       AND cm.status IN ('open', 'in_progress', 'in_review')) AS stat_active,
    (SELECT COUNT(*) FROM comments cm WHERE cm.project_id = p.id AND cm.page_id IS NULL
       AND cm.status IN ('open', 'in_progress', 'in_review')) AS stat_unassigned,
    (SELECT COUNT(*) FROM comments cm WHERE cm.project_id = p.id) AS stat_total
  FROM projects p`;

export interface ProjectStatsRow extends ProjectRow {
  stat_pages: number;
  stat_active: number;
  stat_unassigned: number;
  stat_total: number;
}

export function toProjectWithStats(row: ProjectStatsRow): ProjectWithStats {
  return {
    ...toProject(row),
    stats: {
      pages: row.stat_pages,
      comments_active: row.stat_active,
      comments_unassigned: row.stat_unassigned,
      comments_total: row.stat_total,
    },
  };
}

export async function getProjectWithStats(
  db: D1Database,
  projectId: string,
): Promise<ProjectWithStats | null> {
  const row = await db
    .prepare(`${PROJECT_WITH_STATS_SELECT} WHERE p.id = ?`)
    .bind(projectId)
    .first<ProjectStatsRow>();
  return row ? toProjectWithStats(row) : null;
}

/** Unique per-workspace project slug: `site`, `site-2`, … */
export async function uniqueProjectSlug(
  db: D1Database,
  workspaceId: string,
  base: string,
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT slug FROM projects WHERE workspace_id = ?1 AND (slug = ?2 OR slug LIKE ?2 || '-%')`,
    )
    .bind(workspaceId, base)
    .all<{ slug: string }>();
  const taken = new Set(results.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// --- Origins -------------------------------------------------------------------

export interface OriginRow {
  id: string;
  project_id: string;
  origin: string;
  base_path: string;
  environment: ProjectOrigin['environment'];
  created_at: number;
}

export const toOrigin = (row: OriginRow): ProjectOrigin => ({ ...row });

export async function listOrigins(db: D1Database, projectId: string): Promise<ProjectOrigin[]> {
  const { results } = await db
    .prepare('SELECT * FROM project_origins WHERE project_id = ? ORDER BY created_at, id')
    .bind(projectId)
    .all<OriginRow>();
  return results.map(toOrigin);
}

// --- Share links -----------------------------------------------------------------

export interface ShareLinkRow {
  id: string;
  project_id: string;
  slug: string;
  label: string;
  password_hash: string | null;
  allow_comments: number;
  allow_approvals: number;
  expires_at: number | null;
  revoked_at: number | null;
  created_by: string | null;
  last_viewed_at: number | null;
  created_at: number;
}

export function toShareLink(row: ShareLinkRow): ShareLink {
  return {
    id: row.id,
    project_id: row.project_id,
    slug: row.slug,
    label: row.label,
    password_protected: row.password_hash !== null,
    allow_comments: row.allow_comments === 1,
    allow_approvals: row.allow_approvals === 1,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    last_viewed_at: row.last_viewed_at,
    created_at: row.created_at,
  };
}

export async function listShareLinks(db: D1Database, projectId: string): Promise<ShareLink[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM share_links WHERE project_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC',
    )
    .bind(projectId)
    .all<ShareLinkRow>();
  return results.map(toShareLink);
}

// --- Labels ----------------------------------------------------------------------

export interface LabelRow {
  id: string;
  project_id: string;
  name: string;
  color: Label['color'];
  created_at: number;
}

export const toLabel = (row: LabelRow): Label => ({ ...row });

export async function listLabels(db: D1Database, projectId: string): Promise<Label[]> {
  const { results } = await db
    .prepare('SELECT * FROM labels WHERE project_id = ? ORDER BY name COLLATE NOCASE')
    .bind(projectId)
    .all<LabelRow>();
  return results.map(toLabel);
}
