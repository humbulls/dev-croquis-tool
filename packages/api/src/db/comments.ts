import type {
  Author,
  Comment,
  CommentListQuery,
  ExternalLink,
  Label,
  PublicComment,
  PublicReply,
  Reply,
  UserSummary,
} from '@croquis/shared';
import { COMMENT_PRIORITIES } from '@croquis/shared';
import { decodeCursor, paginate } from '../http/pagination';
import { type AttachmentRow, toAttachment } from '../services/attachments';

export interface CommentRow {
  id: string;
  project_id: string;
  page_id: string | null;
  number: number;
  kind: Comment['kind'];
  source: Comment['source'];
  status: Comment['status'];
  priority: Comment['priority'];
  title: string | null;
  body: string;
  body_lang: string | null;
  author_user_id: string | null;
  author_guest_id: string | null;
  author_name: string | null;
  author_verified: number;
  assignee_user_id: string | null;
  due_at: number | null;
  page_url: string;
  page_path: string;
  element_selector: string | null;
  element_xpath: string | null;
  element_text_quote: string | null;
  element_tag: string | null;
  element_text: string | null;
  element_html: string | null;
  element_context: string | null;
  element_attrs: string | null;
  computed_style: string | null;
  rel_x: number | null;
  rel_y: number | null;
  doc_x: number | null;
  doc_y: number | null;
  anchor_status: Comment['anchor']['status'];
  viewport: Comment['environment']['viewport'];
  viewport_w: number | null;
  viewport_h: number | null;
  device_pixel_ratio: number | null;
  user_agent: string | null;
  browser: string | null;
  os: string | null;
  language: string | null;
  build_id: string | null;
  suggestion_original: string | null;
  suggestion_text: string | null;
  content_block_id: string | null;
  duplicate_of_id: string | null;
  fixed_commit_sha: string | null;
  fixed_pr_url: string | null;
  fixed_deploy_url: string | null;
  fixed_at: number | null;
  resolved_at: number | null;
  resolved_by_user_id: string | null;
  created_at: number;
  updated_at: number;
}

/** Columns joined onto every comment row for display. */
interface CommentJoins {
  author_user_name: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  assignee_image: string | null;
  reply_count: number;
}

export type CommentListRow = CommentRow & CommentJoins;

const COMMENT_SELECT = `
  SELECT c.*,
    au.name AS author_user_name,
    asg.name AS assignee_name, asg.email AS assignee_email, asg.image AS assignee_image,
    (SELECT COUNT(*) FROM comment_replies r WHERE r.comment_id = c.id AND r.internal = 0) AS reply_count
  FROM comments c
  LEFT JOIN users au ON au.id = c.author_user_id
  LEFT JOIN users asg ON asg.id = c.assignee_user_id`;

export function authorOf(row: {
  author_user_id: string | null;
  author_guest_id: string | null;
  author_name: string | null;
  author_user_name?: string | null;
  author_verified?: number;
}): Author {
  if (row.author_user_id) {
    return {
      type: 'user',
      id: row.author_user_id,
      name: row.author_user_name ?? row.author_name,
      verified: true,
    };
  }
  if (row.author_guest_id) {
    return {
      type: 'guest',
      id: row.author_guest_id,
      name: row.author_name,
      verified: row.author_verified === 1,
    };
  }
  if (row.author_verified === 1)
    return { type: 'agent', id: null, name: row.author_name, verified: true };
  return { type: 'anonymous', id: null, name: row.author_name, verified: false };
}

function assigneeOf(row: CommentListRow): UserSummary | null {
  if (!row.assignee_user_id || row.assignee_name === null) return null;
  return {
    id: row.assignee_user_id,
    name: row.assignee_name,
    email: row.assignee_email ?? '',
    image: row.assignee_image,
  };
}

export function toComment(
  row: CommentListRow,
  labels: Label[],
  screenshot: AttachmentRow | undefined,
): Comment {
  return {
    id: row.id,
    project_id: row.project_id,
    page_id: row.page_id,
    number: row.number,
    kind: row.kind,
    source: row.source,
    status: row.status,
    priority: row.priority,
    title: row.title,
    body: row.body,
    body_lang: row.body_lang,
    author: authorOf(row),
    assignee: assigneeOf(row),
    due_at: row.due_at,
    labels,
    page_url: row.page_url,
    page_path: row.page_path,
    anchor: {
      status: row.anchor_status,
      selector: row.element_selector,
      xpath: row.element_xpath,
      text_quote: row.element_text_quote,
      tag: row.element_tag,
      text: row.element_text,
      html: row.element_html,
      context: row.element_context,
      attrs: row.element_attrs,
      computed_style: row.computed_style,
      rel_x: row.rel_x,
      rel_y: row.rel_y,
      doc_x: row.doc_x,
      doc_y: row.doc_y,
    },
    environment: {
      viewport: row.viewport,
      viewport_w: row.viewport_w,
      viewport_h: row.viewport_h,
      device_pixel_ratio: row.device_pixel_ratio,
      user_agent: row.user_agent,
      browser: row.browser,
      os: row.os,
      language: row.language,
      build_id: row.build_id,
    },
    suggestion:
      row.suggestion_original !== null
        ? {
            original: row.suggestion_original,
            text: row.suggestion_text ?? '',
            content_block_id: row.content_block_id,
          }
        : null,
    duplicate_of_id: row.duplicate_of_id,
    fix:
      row.fixed_at !== null
        ? {
            commit_sha: row.fixed_commit_sha,
            pr_url: row.fixed_pr_url,
            deploy_url: row.fixed_deploy_url,
            fixed_at: row.fixed_at,
          }
        : null,
    resolved_at: row.resolved_at,
    reply_count: row.reply_count,
    screenshot: screenshot ? toAttachment(screenshot) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Attach labels and screenshots in two batched queries. Ids travel as one JSON
 * parameter (`json_each`) because D1 caps bound parameters per statement.
 */
export async function hydrate(db: D1Database, rows: CommentListRow[]): Promise<Comment[]> {
  if (rows.length === 0) return [];
  const ids = JSON.stringify(rows.map((r) => r.id));
  const [labels, shots] = await db.batch([
    db
      .prepare(
        `SELECT cl.comment_id, l.id, l.project_id, l.name, l.color, l.created_at
           FROM comment_labels cl JOIN labels l ON l.id = cl.label_id
          WHERE cl.comment_id IN (SELECT value FROM json_each(?)) ORDER BY l.name COLLATE NOCASE`,
      )
      .bind(ids),
    db
      .prepare(
        `SELECT * FROM attachments WHERE kind = 'screenshot' AND comment_id IN (SELECT value FROM json_each(?))
          ORDER BY created_at`,
      )
      .bind(ids),
  ]);
  const labelsBy = new Map<string, Label[]>();
  for (const row of (labels?.results ?? []) as (Label & { comment_id: string })[]) {
    const { comment_id, ...label } = row;
    labelsBy.set(comment_id, [...(labelsBy.get(comment_id) ?? []), label]);
  }
  const shotBy = new Map<string, AttachmentRow>();
  for (const row of (shots?.results ?? []) as unknown as AttachmentRow[]) {
    if (row.comment_id && !shotBy.has(row.comment_id)) shotBy.set(row.comment_id, row);
  }
  return rows.map((row) => toComment(row, labelsBy.get(row.id) ?? [], shotBy.get(row.id)));
}

export async function getComment(db: D1Database, commentId: string): Promise<Comment | null> {
  const row = await db
    .prepare(`${COMMENT_SELECT} WHERE c.id = ?`)
    .bind(commentId)
    .first<CommentListRow>();
  if (!row) return null;
  const [comment] = await hydrate(db, [row]);
  return comment ?? null;
}

const PRIORITY_RANK_SQL = `CASE c.priority ${COMMENT_PRIORITIES.map((p, i) => `WHEN '${p}' THEN ${i}`).join(' ')} END`;
const PRIORITY_KEY_SQL = `(${PRIORITY_RANK_SQL} * 10000000000000 + c.created_at)`;

const SORTS = {
  newest: { key: 'c.created_at', dir: 'DESC' },
  oldest: { key: 'c.created_at', dir: 'ASC' },
  updated: { key: 'c.updated_at', dir: 'DESC' },
  priority: { key: PRIORITY_KEY_SQL, dir: 'DESC' },
} as const;

function sortValue(sort: CommentListQuery['sort'], row: CommentListRow): number {
  if (sort === 'updated') return row.updated_at;
  if (sort === 'priority')
    return COMMENT_PRIORITIES.indexOf(row.priority) * 10_000_000_000_000 + row.created_at;
  return row.created_at;
}

/**
 * Inbox query shared by the list and board views. Defaults to active statuses
 * (open, in progress, in review); every filter combines with AND.
 */
export async function listComments(
  db: D1Database,
  projectId: string,
  query: CommentListQuery,
  viewerUserId: string | null,
): Promise<{ data: Comment[]; next_cursor: string | null }> {
  const where = ['c.project_id = ?'];
  const params: unknown[] = [projectId];
  const statuses = query.status ?? ['open', 'in_progress', 'in_review'];
  where.push(`c.status IN (SELECT value FROM json_each(?))`);
  params.push(JSON.stringify(statuses));
  if (query.priority?.length) {
    where.push('c.priority IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(query.priority));
  }
  if (query.kind?.length) {
    where.push('c.kind IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(query.kind));
  }
  if (query.page === 'unassigned') {
    where.push('c.page_id IS NULL');
  } else if (query.page) {
    where.push('c.page_id = ?');
    params.push(query.page);
  }
  if (query.assignee === 'none') {
    where.push('c.assignee_user_id IS NULL');
  } else if (query.assignee === 'me') {
    where.push('c.assignee_user_id = ?');
    params.push(viewerUserId ?? '');
  } else if (query.assignee) {
    where.push('c.assignee_user_id = ?');
    params.push(query.assignee);
  }
  if (query.label) {
    where.push(
      'EXISTS (SELECT 1 FROM comment_labels cl WHERE cl.comment_id = c.id AND cl.label_id = ?)',
    );
    params.push(query.label);
  }
  if (query.q) {
    const number = /^#?(\d+)$/.exec(query.q)?.[1];
    if (number) {
      where.push('c.number = ?');
      params.push(Number(number));
    } else {
      where.push(
        `(c.body LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\' OR c.page_path LIKE ? ESCAPE '\\')`,
      );
      const like = `%${query.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      params.push(like, like, like);
    }
  }
  const sort = SORTS[query.sort];
  const after = decodeCursor(query.cursor);
  if (after) {
    const op = sort.dir === 'DESC' ? '<' : '>';
    where.push(`(${sort.key} ${op} ? OR (${sort.key} = ? AND c.id ${op} ?))`);
    params.push(after[0], after[0], after[1]);
  }
  const { results } = await db
    .prepare(
      `${COMMENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${sort.key} ${sort.dir}, c.id ${sort.dir} LIMIT ?`,
    )
    .bind(...params, query.limit + 1)
    .all<CommentListRow>();
  const page = paginate(results, query.limit, (row) => sortValue(query.sort, row));
  return { data: await hydrate(db, page.data), next_cursor: page.next_cursor };
}

/** Every comment of a project (export), oldest first. */
export async function allComments(db: D1Database, projectId: string): Promise<Comment[]> {
  const { results } = await db
    .prepare(`${COMMENT_SELECT} WHERE c.project_id = ? ORDER BY c.created_at, c.id`)
    .bind(projectId)
    .all<CommentListRow>();
  return hydrate(db, results);
}

// --- Replies ------------------------------------------------------------------------

export interface ReplyRow {
  id: string;
  comment_id: string;
  author_user_id: string | null;
  author_guest_id: string | null;
  author_name: string | null;
  body: string;
  internal: number;
  created_at: number;
  author_user_name?: string | null;
}

export const REPLY_SELECT = `SELECT r.*, u.name AS author_user_name FROM comment_replies r LEFT JOIN users u ON u.id = r.author_user_id`;

export function toReply(row: ReplyRow): Reply {
  return {
    id: row.id,
    comment_id: row.comment_id,
    author: authorOf({ ...row, author_verified: 1 }),
    body: row.body,
    internal: row.internal === 1,
    created_at: row.created_at,
  };
}

export function toPublicReply(row: ReplyRow): PublicReply {
  return {
    id: row.id,
    author_name: row.author_user_name ?? row.author_name,
    body: row.body,
    created_at: row.created_at,
  };
}

export async function listReplies(
  db: D1Database,
  commentId: string,
  includeInternal: boolean,
): Promise<ReplyRow[]> {
  const { results } = await db
    .prepare(
      `${REPLY_SELECT} WHERE r.comment_id = ? ${includeInternal ? '' : 'AND r.internal = 0'} ORDER BY r.created_at, r.id`,
    )
    .bind(commentId)
    .all<ReplyRow>();
  return results;
}

export function insertReply(db: D1Database, row: ReplyRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO comment_replies (id, comment_id, author_user_id, author_guest_id, author_name, body, internal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.comment_id,
      row.author_user_id,
      row.author_guest_id,
      row.author_name,
      row.body,
      row.internal,
      row.created_at,
    );
}

// --- External links ------------------------------------------------------------------

export async function listExternalLinks(
  db: D1Database,
  commentId: string,
): Promise<ExternalLink[]> {
  const { results } = await db
    .prepare(
      'SELECT id, provider, external_id, url, created_at FROM external_links WHERE comment_id = ? ORDER BY created_at',
    )
    .bind(commentId)
    .all<ExternalLink>();
  return results;
}

// --- Public projection -------------------------------------------------------------------

/** What guests may see: no emails, environment details, internal notes or assignees. */
export function toPublicComment(comment: Comment): PublicComment {
  return {
    id: comment.id,
    page_id: comment.page_id,
    number: comment.number,
    kind: comment.kind,
    status: comment.status,
    title: comment.title,
    body: comment.body,
    page_url: comment.page_url,
    page_path: comment.page_path,
    suggestion: comment.suggestion,
    resolved_at: comment.resolved_at,
    reply_count: comment.reply_count,
    created_at: comment.created_at,
    author_name: comment.author.name,
    anchor: {
      status: comment.anchor.status,
      selector: comment.anchor.selector,
      xpath: comment.anchor.xpath,
      text_quote: comment.anchor.text_quote,
      rel_x: comment.anchor.rel_x,
      rel_y: comment.anchor.rel_y,
      doc_x: comment.anchor.doc_x,
      doc_y: comment.anchor.doc_y,
    },
    viewport: comment.environment.viewport,
  };
}

// --- Writes ----------------------------------------------------------------------------------

/** INSERT for a new comment; the per-project number is assigned inside the statement. */
export function insertComment(
  db: D1Database,
  row: Omit<CommentRow, 'number'>,
): D1PreparedStatement {
  const columns = Object.keys(row) as (keyof typeof row)[];
  return db
    .prepare(
      `INSERT INTO comments (${columns.join(', ')}, number)
       VALUES (${columns.map(() => '?').join(', ')}, (SELECT COALESCE(MAX(number), 0) + 1 FROM comments WHERE project_id = ?))`,
    )
    .bind(...columns.map((column) => row[column]), row.project_id);
}

/** A blank comment row with every optional column set to null. */
export function emptyCommentRow(base: {
  id: string;
  project_id: string;
  body: string;
  page_url: string;
  page_path: string;
  now: number;
}): Omit<CommentRow, 'number'> {
  return {
    id: base.id,
    project_id: base.project_id,
    page_id: null,
    kind: 'feedback',
    source: 'api',
    status: 'open',
    priority: 'none',
    title: null,
    body: base.body,
    body_lang: null,
    author_user_id: null,
    author_guest_id: null,
    author_name: null,
    author_verified: 0,
    assignee_user_id: null,
    due_at: null,
    page_url: base.page_url,
    page_path: base.page_path,
    element_selector: null,
    element_xpath: null,
    element_text_quote: null,
    element_tag: null,
    element_text: null,
    element_html: null,
    element_context: null,
    element_attrs: null,
    computed_style: null,
    rel_x: null,
    rel_y: null,
    doc_x: null,
    doc_y: null,
    anchor_status: 'page',
    viewport: 'desktop',
    viewport_w: null,
    viewport_h: null,
    device_pixel_ratio: null,
    user_agent: null,
    browser: null,
    os: null,
    language: null,
    build_id: null,
    suggestion_original: null,
    suggestion_text: null,
    content_block_id: null,
    duplicate_of_id: null,
    fixed_commit_sha: null,
    fixed_pr_url: null,
    fixed_deploy_url: null,
    fixed_at: null,
    resolved_at: null,
    resolved_by_user_id: null,
    created_at: base.now,
    updated_at: base.now,
  };
}
