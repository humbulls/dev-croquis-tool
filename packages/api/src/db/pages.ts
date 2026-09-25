import {
  type ContentBlock,
  type Page,
  type PageApproval,
  type PageWithStats,
  type PathCandidate,
  pathMatches,
  type ReviewRound,
} from '@croquis/shared';

export interface PageRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  path: string;
  title: string;
  purpose: string;
  audience: string;
  status: Page['status'];
  sort_index: number;
  created_at: number;
  updated_at: number;
}

export const toPage = (row: PageRow): Page => ({
  id: row.id,
  project_id: row.project_id,
  parent_id: row.parent_id,
  path: row.path,
  title: row.title,
  purpose: row.purpose,
  audience: row.audience,
  status: row.status,
  sort_index: row.sort_index,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const PAGE_WITH_STATS_SELECT = `
  SELECT pg.*,
    (SELECT COUNT(*) FROM comments cm WHERE cm.page_id = pg.id
       AND cm.status IN ('open', 'in_progress', 'in_review')) AS stat_active,
    (SELECT COUNT(*) FROM comments cm WHERE cm.page_id = pg.id) AS stat_total,
    (SELECT pa.decision FROM page_approvals pa WHERE pa.page_id = pg.id
       ORDER BY pa.created_at DESC, pa.id DESC LIMIT 1) AS stat_approval
  FROM pages pg`;

interface PageStatsRow extends PageRow {
  stat_active: number;
  stat_total: number;
  stat_approval: PageWithStats['approval'];
}

const toPageWithStats = (row: PageStatsRow): PageWithStats => ({
  ...toPage(row),
  comments_active: row.stat_active,
  comments_total: row.stat_total,
  approval: row.stat_approval,
});

/** The whole sitemap, parents before children within each level (tree built by clients). */
export async function listPages(db: D1Database, projectId: string): Promise<PageWithStats[]> {
  const { results } = await db
    .prepare(
      `${PAGE_WITH_STATS_SELECT} WHERE pg.project_id = ? ORDER BY pg.sort_index, pg.created_at, pg.id`,
    )
    .bind(projectId)
    .all<PageStatsRow>();
  return results.map(toPageWithStats);
}

export async function getPageWithStats(
  db: D1Database,
  pageId: string,
): Promise<PageWithStats | null> {
  const row = await db
    .prepare(`${PAGE_WITH_STATS_SELECT} WHERE pg.id = ?`)
    .bind(pageId)
    .first<PageStatsRow>();
  return row ? toPageWithStats(row) : null;
}

export async function nextSortIndex(
  db: D1Database,
  projectId: string,
  parentId: string | null,
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COALESCE(MAX(sort_index), -1) + 1 AS next FROM pages WHERE project_id = ? AND parent_id IS ?',
    )
    .bind(projectId, parentId)
    .first<{ next: number }>();
  return row?.next ?? 0;
}

/** Candidate paths for URL → page matching: page paths and learned aliases. */
export async function pathCandidates(
  db: D1Database,
  projectId: string,
): Promise<{ pages: PathCandidate[]; aliases: PathCandidate[] }> {
  const [pages, aliases] = await db.batch<{ pageId: string; path: string }>([
    db.prepare('SELECT id AS pageId, path FROM pages WHERE project_id = ?').bind(projectId),
    db
      .prepare('SELECT page_id AS pageId, path FROM page_path_aliases WHERE project_id = ?')
      .bind(projectId),
  ]);
  return { pages: pages?.results ?? [], aliases: aliases?.results ?? [] };
}

/** Is `candidateId` the page itself or one of its descendants? (cycle guard for re-parenting) */
export async function isSelfOrDescendant(
  db: D1Database,
  pageId: string,
  candidateId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT ?1 UNION ALL SELECT p.id FROM pages p JOIN sub ON p.parent_id = sub.id
       ) SELECT 1 AS hit FROM sub WHERE id = ?2 LIMIT 1`,
    )
    .bind(pageId, candidateId)
    .first();
  return row !== null;
}

/** The page and all of its ancestors (a move under any of them would create a cycle). */
export async function ancestorIds(db: D1Database, pageId: string): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE up(id, parent_id) AS (
         SELECT id, parent_id FROM pages WHERE id = ?1
         UNION ALL SELECT p.id, p.parent_id FROM pages p JOIN up ON p.id = up.parent_id
       ) SELECT id FROM up`,
    )
    .bind(pageId)
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

/**
 * Comments in the unassigned inbox whose path matches `pattern`: creating or
 * re-pathing a page adopts the feedback that was waiting for it.
 */
export async function adoptableComments(
  db: D1Database,
  projectId: string,
  pattern: string,
): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT id, page_path FROM comments WHERE project_id = ? AND page_id IS NULL')
    .bind(projectId)
    .all<{ id: string; page_path: string }>();
  return results.filter((c) => pathMatches(pattern, c.page_path)).map((c) => c.id);
}

// --- Content blocks ---------------------------------------------------------------

export interface ContentBlockRow {
  id: string;
  page_id: string;
  type: ContentBlock['type'];
  position: number;
  content: string;
  ai_generated: number;
  created_at: number;
  updated_at: number;
}

export const toContentBlock = (row: ContentBlockRow): ContentBlock => ({
  id: row.id,
  page_id: row.page_id,
  type: row.type,
  position: row.position,
  content: row.content,
  ai_generated: row.ai_generated === 1,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export async function listContentBlocks(db: D1Database, pageId: string): Promise<ContentBlock[]> {
  const { results } = await db
    .prepare('SELECT * FROM content_blocks WHERE page_id = ? ORDER BY position, created_at, id')
    .bind(pageId)
    .all<ContentBlockRow>();
  return results.map(toContentBlock);
}

export async function nextBlockPosition(db: D1Database, pageId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM content_blocks WHERE page_id = ?')
    .bind(pageId)
    .first<{ next: number }>();
  return row?.next ?? 0;
}

export function insertContentBlock(db: D1Database, row: ContentBlockRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO content_blocks (id, page_id, type, position, content, ai_generated, created_at, updated_at)
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
    );
}

// --- Review rounds & approvals -------------------------------------------------------

export interface ReviewRoundRow {
  id: string;
  project_id: string;
  name: string;
  preview_url: string | null;
  status: ReviewRound['status'];
  created_by: string | null;
  created_at: number;
  closed_at: number | null;
}

export const toReviewRound = (row: ReviewRoundRow): ReviewRound => ({
  id: row.id,
  project_id: row.project_id,
  name: row.name,
  preview_url: row.preview_url,
  status: row.status,
  created_at: row.created_at,
  closed_at: row.closed_at,
});

export interface ApprovalRow {
  id: string;
  page_id: string;
  review_round_id: string | null;
  decision: PageApproval['decision'];
  approver_user_id: string | null;
  approver_guest_id: string | null;
  approver_name: string;
  note: string;
  created_at: number;
}

export const toApproval = (row: ApprovalRow): PageApproval => ({
  id: row.id,
  page_id: row.page_id,
  review_round_id: row.review_round_id,
  decision: row.decision,
  approver_name: row.approver_name,
  approver_type: row.approver_user_id ? 'user' : 'guest',
  note: row.note,
  created_at: row.created_at,
});

export async function listApprovals(db: D1Database, pageId: string): Promise<PageApproval[]> {
  const { results } = await db
    .prepare('SELECT * FROM page_approvals WHERE page_id = ? ORDER BY created_at DESC, id DESC')
    .bind(pageId)
    .all<ApprovalRow>();
  return results.map(toApproval);
}

export function insertApproval(db: D1Database, row: ApprovalRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO page_approvals (id, page_id, review_round_id, decision, approver_user_id, approver_guest_id,
                                   approver_name, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.page_id,
      row.review_round_id,
      row.decision,
      row.approver_user_id,
      row.approver_guest_id,
      row.approver_name,
      row.note,
      row.created_at,
    );
}
