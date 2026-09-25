import { normalizePath } from '@croquis/shared';
import type { Context } from 'hono';
import {
  type ApprovalRow,
  adoptableComments,
  ancestorIds,
  type ContentBlockRow,
  getPageWithStats,
  insertApproval,
  insertContentBlock,
  isSelfOrDescendant,
  listApprovals,
  listContentBlocks,
  listPages,
  nextBlockPosition,
  nextSortIndex,
  type PageRow,
  type ReviewRoundRow,
  toApproval,
  toContentBlock,
  toReviewRound,
} from '../db/pages';
import type { AppEnv } from '../env';
import { body, createRouter, idParam, json, noContent, problem, route } from '../http/openapi';
import { conflict, notFound, orThrow, unprocessable } from '../http/problem';
import * as S from '../http/schemas';
import { loadScoped, requireProject, type Scope } from '../security/access';
import { requireUser } from '../security/permissions';
import { actorOf } from '../security/principal';
import { newId } from '../security/tokens';
import { UnitOfWork } from '../services/unit-of-work';

const app = createRouter();
const tags = ['Pages'];
const ProjectParams = idParam('projectId', 'Project id');
const PageParams = idParam('pageId', 'Page id');

type Ctx = Context<AppEnv>;

const PAGE_FROM = 'pages x JOIN projects p ON p.id = x.project_id';

function requirePage(
  c: Ctx,
  pageId: string,
  permission: 'page.read' | 'page.write' | 'comment.write',
) {
  return loadScoped<PageRow>(c, { from: PAGE_FROM, id: pageId, permission, resource: 'page' });
}

/** Move the given unassigned comments onto a page in a single statement. */
function adoptStatement(
  c: Ctx,
  pageId: string,
  commentIds: string[],
  now: number,
): D1PreparedStatement {
  return c.env.DB.prepare(
    'UPDATE comments SET page_id = ?, updated_at = ? WHERE id IN (SELECT value FROM json_each(?)) AND page_id IS NULL',
  ).bind(pageId, now, JSON.stringify(commentIds));
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

function pageEvent(
  c: Ctx,
  uow: UnitOfWork,
  scope: Scope,
  type: 'page.created' | 'page.updated' | 'page.deleted',
  page: PageRow,
  data: Record<string, unknown> = {},
) {
  uow.event({
    type,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    actor: actorOf(c.get('principal')),
    subjectType: 'page',
    subjectId: page.id,
    data: { path: page.path, title: page.title, ...data },
  });
}

async function assertParent(
  c: Ctx,
  projectId: string,
  parentId: string | null | undefined,
): Promise<void> {
  if (!parentId) return;
  const parent = await c.env.DB.prepare('SELECT 1 AS ok FROM pages WHERE id = ? AND project_id = ?')
    .bind(parentId, projectId)
    .first();
  if (!parent)
    throw unprocessable('invalid_parent', 'parent_id must be a page in the same project');
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}/pages',
    tags,
    summary: 'List the sitemap',
    description:
      'Every page with its review counters and latest approval, ordered for display. The hierarchy is expressed with `parent_id`.',
    request: { params: ProjectParams },
    responses: { 200: json(S.data(S.PageWithStats), 'Pages') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    await requireProject(c, projectId, 'page.read');
    return c.json({ data: await listPages(c.env.DB, projectId) }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/pages',
    tags,
    summary: 'Create a page',
    description:
      'Paths may be patterns: `/blog/:slug` or `/docs/*`. Unassigned comments whose URL matches the new path are moved onto the page.',
    request: { params: ProjectParams, ...body(S.CreatePageInput) },
    responses: {
      201: json(S.PageWithStats, 'Created'),
      409: problem('A page with this path exists'),
    },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { scope } = await requireProject(c, projectId, 'page.write');
    await assertParent(c, projectId, input.parent_id);
    const parentId = input.parent_id ?? null;
    const now = Date.now();
    const row: PageRow = {
      id: newId(),
      project_id: projectId,
      parent_id: parentId,
      path: normalizePath(input.path),
      title: input.title,
      purpose: input.purpose,
      audience: input.audience,
      status: input.status,
      sort_index: input.sort_index ?? (await nextSortIndex(c.env.DB, projectId, parentId)),
      created_at: now,
      updated_at: now,
    };
    const adopted = await adoptableComments(c.env.DB, projectId, row.path);
    const uow = new UnitOfWork(c.env).add(
      c.env.DB.prepare(
        `INSERT INTO pages (id, project_id, parent_id, path, title, purpose, audience, status, sort_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        row.id,
        row.project_id,
        row.parent_id,
        row.path,
        row.title,
        row.purpose,
        row.audience,
        row.status,
        row.sort_index,
        now,
        now,
      ),
      adoptStatement(c, row.id, adopted, now),
    );
    pageEvent(c, uow, scope, 'page.created', row, { adopted_comments: adopted.length });
    try {
      await uow.commit(c);
    } catch (err) {
      if (isUniqueViolation(err))
        throw conflict('page_path_exists', `A page with the path ${row.path} already exists`);
      throw err;
    }
    return c.json(orThrow(await getPageWithStats(c.env.DB, row.id), notFound('page')), 201);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/pages/reorder',
    tags,
    summary: 'Reorder or move pages',
    description: 'Puts the listed pages under `parent_id` in the given order (sort_index 0…n-1).',
    request: { params: ProjectParams, ...body(S.ReorderPagesInput) },
    responses: { 200: json(S.data(S.PageWithStats), 'The updated sitemap') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { parent_id, page_ids } = c.req.valid('json');
    await requireProject(c, projectId, 'page.write');
    await assertParent(c, projectId, parent_id);
    const unique = [...new Set(page_ids)];
    const placeholders = unique.map(() => '?').join(', ');
    const found = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pages WHERE project_id = ? AND id IN (${placeholders})`,
    )
      .bind(projectId, ...unique)
      .first<{ n: number }>();
    if ((found?.n ?? 0) !== unique.length)
      throw unprocessable('invalid_pages', 'Every page_id must belong to the project');
    if (parent_id) {
      const ancestors = await ancestorIds(c.env.DB, parent_id);
      if (unique.some((id) => ancestors.has(id))) {
        throw unprocessable('page_cycle', 'A page cannot be moved under itself or its descendants');
      }
    }
    // One statement for the whole move: json_each's key is the array index.
    await c.env.DB.prepare(
      `UPDATE pages SET parent_id = ?1, updated_at = ?3,
              sort_index = (SELECT key FROM json_each(?2) WHERE value = pages.id)
        WHERE id IN (SELECT value FROM json_each(?2))`,
    )
      .bind(parent_id, JSON.stringify(unique), Date.now())
      .run();
    return c.json({ data: await listPages(c.env.DB, projectId) }, 200);
  },
);

app.openapi(
  route({
    method: 'get',
    path: '/pages/{pageId}',
    tags,
    summary: 'Get a page',
    request: { params: PageParams },
    responses: { 200: json(S.PageWithStats, 'The page') },
  }),
  async (c) => {
    const { pageId } = c.req.valid('param');
    await requirePage(c, pageId, 'page.read');
    return c.json(orThrow(await getPageWithStats(c.env.DB, pageId), notFound('page')), 200);
  },
);

app.openapi(
  route({
    method: 'patch',
    path: '/pages/{pageId}',
    tags,
    summary: 'Update a page',
    description:
      'Only the fields present in the body change. Re-parenting under the page itself or its descendants is rejected.',
    request: { params: PageParams, ...body(S.UpdatePageInput) },
    responses: {
      200: json(S.PageWithStats, 'Updated'),
      409: problem('A page with this path exists'),
    },
  }),
  async (c) => {
    const { pageId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { row, scope } = await requirePage(c, pageId, 'page.write');
    if (input.parent_id !== undefined && input.parent_id !== null) {
      await assertParent(c, scope.projectId, input.parent_id);
      if (await isSelfOrDescendant(c.env.DB, pageId, input.parent_id)) {
        throw unprocessable('page_cycle', 'A page cannot be moved under itself or its descendants');
      }
    }
    const next: PageRow = {
      ...row,
      parent_id: input.parent_id === undefined ? row.parent_id : input.parent_id,
      path: input.path === undefined ? row.path : normalizePath(input.path),
      title: input.title ?? row.title,
      purpose: input.purpose ?? row.purpose,
      audience: input.audience ?? row.audience,
      status: input.status ?? row.status,
      sort_index: input.sort_index ?? row.sort_index,
      updated_at: Date.now(),
    };
    const changes = Object.fromEntries(
      (['parent_id', 'path', 'title', 'purpose', 'audience', 'status', 'sort_index'] as const)
        .filter((key) => next[key] !== row[key])
        .map((key) => [key, next[key]]),
    );
    if (Object.keys(changes).length === 0) {
      return c.json(orThrow(await getPageWithStats(c.env.DB, pageId), notFound('page')), 200);
    }
    const uow = new UnitOfWork(c.env).add(
      c.env.DB.prepare(
        `UPDATE pages SET parent_id = ?, path = ?, title = ?, purpose = ?, audience = ?, status = ?, sort_index = ?,
                updated_at = ? WHERE id = ?`,
      ).bind(
        next.parent_id,
        next.path,
        next.title,
        next.purpose,
        next.audience,
        next.status,
        next.sort_index,
        next.updated_at,
        pageId,
      ),
    );
    if (changes.path !== undefined) {
      const adopted = await adoptableComments(c.env.DB, scope.projectId, next.path);
      uow.add(adoptStatement(c, pageId, adopted, next.updated_at));
    }
    pageEvent(c, uow, scope, 'page.updated', next, { changes });
    try {
      await uow.commit(c);
    } catch (err) {
      if (isUniqueViolation(err))
        throw conflict('page_path_exists', `A page with the path ${next.path} already exists`);
      throw err;
    }
    return c.json(orThrow(await getPageWithStats(c.env.DB, pageId), notFound('page')), 200);
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/pages/{pageId}',
    tags,
    summary: 'Delete a page',
    description:
      'Child pages move up to the deleted page’s parent. Its comments go back to the unassigned inbox; its content blocks and approvals are deleted.',
    request: { params: PageParams },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { pageId } = c.req.valid('param');
    const { row, scope } = await requirePage(c, pageId, 'page.write');
    const base = await nextSortIndex(c.env.DB, scope.projectId, row.parent_id);
    const now = Date.now();
    const uow = new UnitOfWork(c.env).add(
      c.env.DB.prepare(
        `UPDATE pages SET parent_id = ?, sort_index = ? + sort_index, updated_at = ? WHERE parent_id = ?`,
      ).bind(row.parent_id, base, now, pageId),
      c.env.DB.prepare('UPDATE comments SET page_id = NULL, updated_at = ? WHERE page_id = ?').bind(
        now,
        pageId,
      ),
      c.env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(pageId),
    );
    pageEvent(c, uow, scope, 'page.deleted', row);
    await uow.commit(c);
    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

const BlockParams = idParam('blockId', 'Content block id');
const BLOCK_FROM =
  'content_blocks x JOIN pages pg ON pg.id = x.page_id JOIN projects p ON p.id = pg.project_id';

app.openapi(
  route({
    method: 'get',
    path: '/pages/{pageId}/content-blocks',
    tags: ['Content'],
    summary: 'List a page’s content',
    request: { params: PageParams },
    responses: { 200: json(S.data(S.ContentBlock), 'Blocks in order') },
  }),
  async (c) => {
    const { pageId } = c.req.valid('param');
    await requirePage(c, pageId, 'page.read');
    return c.json({ data: await listContentBlocks(c.env.DB, pageId) }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/pages/{pageId}/content-blocks',
    tags: ['Content'],
    summary: 'Add a content block',
    request: { params: PageParams, ...body(S.CreateContentBlockInput) },
    responses: { 201: json(S.ContentBlock, 'Created') },
  }),
  async (c) => {
    const { pageId } = c.req.valid('param');
    const input = c.req.valid('json');
    await requirePage(c, pageId, 'page.write');
    const now = Date.now();
    const row: ContentBlockRow = {
      id: newId(),
      page_id: pageId,
      type: input.type,
      position: input.position ?? (await nextBlockPosition(c.env.DB, pageId)),
      content: input.content,
      ai_generated: input.ai_generated ? 1 : 0,
      created_at: now,
      updated_at: now,
    };
    await insertContentBlock(c.env.DB, row).run();
    return c.json(toContentBlock(row), 201);
  },
);

app.openapi(
  route({
    method: 'patch',
    path: '/content-blocks/{blockId}',
    tags: ['Content'],
    summary: 'Update a content block',
    request: { params: BlockParams, ...body(S.UpdateContentBlockInput) },
    responses: { 200: json(S.ContentBlock, 'Updated') },
  }),
  async (c) => {
    const { blockId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { row } = await loadScoped<ContentBlockRow>(c, {
      from: BLOCK_FROM,
      id: blockId,
      permission: 'page.write',
      resource: 'content_block',
    });
    const next: ContentBlockRow = {
      ...row,
      type: input.type ?? row.type,
      position: input.position ?? row.position,
      content: input.content ?? row.content,
      // Editing AI text by hand makes it human-authored unless told otherwise.
      ai_generated:
        input.ai_generated === undefined
          ? input.content !== undefined
            ? 0
            : row.ai_generated
          : input.ai_generated
            ? 1
            : 0,
      updated_at: Date.now(),
    };
    await c.env.DB.prepare(
      'UPDATE content_blocks SET type = ?, position = ?, content = ?, ai_generated = ?, updated_at = ? WHERE id = ?',
    )
      .bind(next.type, next.position, next.content, next.ai_generated, next.updated_at, blockId)
      .run();
    return c.json(toContentBlock(next), 200);
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/content-blocks/{blockId}',
    tags: ['Content'],
    summary: 'Delete a content block',
    request: { params: BlockParams },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { blockId } = c.req.valid('param');
    await loadScoped<ContentBlockRow>(c, {
      from: BLOCK_FROM,
      id: blockId,
      permission: 'page.write',
      resource: 'content_block',
    });
    await c.env.DB.prepare('DELETE FROM content_blocks WHERE id = ?').bind(blockId).run();
    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------------------
// Review rounds
// ---------------------------------------------------------------------------

const RoundParams = idParam('roundId', 'Review round id');

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}/review-rounds',
    tags: ['Review'],
    summary: 'List review rounds',
    description: 'Rounds group feedback and approvals per preview deploy (“Round 2 — new hero”).',
    request: { params: ProjectParams },
    responses: { 200: json(S.data(S.ReviewRound), 'Rounds, newest first') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    await requireProject(c, projectId, 'project.read');
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM review_rounds WHERE project_id = ? ORDER BY created_at DESC, id DESC',
    )
      .bind(projectId)
      .all<ReviewRoundRow>();
    return c.json({ data: results.map(toReviewRound) }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/review-rounds',
    tags: ['Review'],
    summary: 'Open a review round',
    request: { params: ProjectParams, ...body(S.CreateReviewRoundInput) },
    responses: { 201: json(S.ReviewRound, 'Opened') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { scope } = await requireProject(c, projectId, 'share.manage');
    const principal = c.get('principal');
    const row: ReviewRoundRow = {
      id: newId(),
      project_id: projectId,
      name: input.name,
      preview_url: input.preview_url ?? null,
      status: 'open',
      created_by: principal.type === 'user' ? principal.user.id : null,
      created_at: Date.now(),
      closed_at: null,
    };
    const uow = new UnitOfWork(c.env).add(
      c.env.DB.prepare(
        `INSERT INTO review_rounds (id, project_id, name, preview_url, status, created_by, created_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?)`,
      ).bind(row.id, projectId, row.name, row.preview_url, row.created_by, row.created_at),
    );
    uow.event({
      type: 'review_round.opened',
      workspaceId: scope.workspaceId,
      projectId,
      actor: actorOf(principal),
      subjectType: 'review_round',
      subjectId: row.id,
      data: { name: row.name, preview_url: row.preview_url },
    });
    await uow.commit(c);
    return c.json(toReviewRound(row), 201);
  },
);

app.openapi(
  route({
    method: 'patch',
    path: '/review-rounds/{roundId}',
    tags: ['Review'],
    summary: 'Rename, re-point or close a round',
    request: { params: RoundParams, ...body(S.UpdateReviewRoundInput) },
    responses: { 200: json(S.ReviewRound, 'Updated') },
  }),
  async (c) => {
    const { roundId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { row, scope } = await loadScoped<ReviewRoundRow>(c, {
      from: 'review_rounds x JOIN projects p ON p.id = x.project_id',
      id: roundId,
      permission: 'share.manage',
      resource: 'review_round',
    });
    const status = input.status ?? row.status;
    const next: ReviewRoundRow = {
      ...row,
      name: input.name ?? row.name,
      preview_url: input.preview_url === undefined ? row.preview_url : input.preview_url,
      status,
      closed_at: status === 'closed' ? (row.closed_at ?? Date.now()) : null,
    };
    const uow = new UnitOfWork(c.env).add(
      c.env.DB.prepare(
        'UPDATE review_rounds SET name = ?, preview_url = ?, status = ?, closed_at = ? WHERE id = ?',
      ).bind(next.name, next.preview_url, next.status, next.closed_at, roundId),
    );
    if (status !== row.status) {
      uow.event({
        type: status === 'closed' ? 'review_round.closed' : 'review_round.opened',
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        actor: actorOf(c.get('principal')),
        subjectType: 'review_round',
        subjectId: roundId,
        data: { name: next.name },
      });
    }
    await uow.commit(c);
    return c.json(toReviewRound(next), 200);
  },
);

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/pages/{pageId}/approvals',
    tags: ['Review'],
    summary: 'Approval history of a page',
    request: { params: PageParams },
    responses: { 200: json(S.data(S.PageApproval), 'Decisions, newest first') },
  }),
  async (c) => {
    const { pageId } = c.req.valid('param');
    await requirePage(c, pageId, 'page.read');
    return c.json({ data: await listApprovals(c.env.DB, pageId) }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/pages/{pageId}/approvals',
    tags: ['Review'],
    summary: 'Approve a page or request changes',
    description:
      'Clients usually decide through a share link; members can record a decision here (e.g. from a call). Signed-in members only — API keys and agents cannot approve.',
    request: { params: PageParams, ...body(S.CreateApprovalInput) },
    responses: { 201: json(S.PageApproval, 'Recorded') },
  }),
  async (c) => {
    const { pageId } = c.req.valid('param');
    const input = c.req.valid('json');
    const principal = c.get('principal');
    requireUser(principal);
    const { row: page, scope } = await requirePage(c, pageId, 'comment.write');
    if (input.review_round_id) {
      const round = await c.env.DB.prepare(
        'SELECT 1 AS ok FROM review_rounds WHERE id = ? AND project_id = ?',
      )
        .bind(input.review_round_id, scope.projectId)
        .first();
      if (!round)
        throw unprocessable('invalid_review_round', 'review_round_id must belong to the project');
    }
    const actor = actorOf(principal);
    const row: ApprovalRow = {
      id: newId(),
      page_id: pageId,
      review_round_id: input.review_round_id ?? null,
      decision: input.decision,
      approver_user_id: principal.user.id,
      approver_guest_id: null,
      approver_name: principal.user.name,
      note: input.note,
      created_at: Date.now(),
    };
    const uow = new UnitOfWork(c.env).add(insertApproval(c.env.DB, row));
    uow.event({
      type: row.decision === 'approved' ? 'page.approved' : 'page.changes_requested',
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actor,
      subjectType: 'page',
      subjectId: pageId,
      data: {
        path: page.path,
        title: page.title,
        note: row.note,
        review_round_id: row.review_round_id,
      },
    });
    await uow.commit(c);
    return c.json(toApproval(row), 201);
  },
);

export default app;
