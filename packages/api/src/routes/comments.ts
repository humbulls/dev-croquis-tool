import {
  CLOSED_COMMENT_STATUSES,
  COMMENT_STATUSES,
  type Comment,
  commentListQuery,
  EXPORT_SCHEMA_VERSION,
  formatExportMarkdown,
  type ProjectExport,
} from '@croquis/shared';
import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  allComments,
  type CommentRow,
  emptyCommentRow,
  getComment,
  insertComment,
  insertReply,
  listComments,
  listExternalLinks,
  listReplies,
  type ReplyRow,
  toReply,
} from '../db/comments';
import {
  type ApprovalRow,
  type ContentBlockRow,
  listPages,
  toApproval,
  toContentBlock,
} from '../db/pages';
import { listOrigins, toProject } from '../db/projects';
import { isMember } from '../db/workspaces';
import type { AppEnv } from '../env';
import { background } from '../http/background';
import { body, createRouter, idParam, json, noContent, route } from '../http/openapi';
import { forbidden, notFound, orThrow, unprocessable } from '../http/problem';
import * as S from '../http/schemas';
import { loadScoped, requireProject, type Scope } from '../security/access';
import { roleAtLeast } from '../security/permissions';
import { actorOf, type Principal } from '../security/principal';
import { newId } from '../security/tokens';
import { type AttachmentRow, deleteObjects, toAttachment } from '../services/attachments';
import { anchorColumns, detectLanguage, matchContentBlock, resolvePage } from '../services/intake';
import { notifyIntegrations } from '../services/integrations';
import { UnitOfWork } from '../services/unit-of-work';

const app = createRouter();
const tags = ['Comments'];
const ProjectParams = idParam('projectId', 'Project id');
const CommentParams = idParam('commentId', 'Comment id');

type Ctx = Context<AppEnv>;
const COMMENT_FROM = 'comments x JOIN projects p ON p.id = x.project_id';

function requireComment(c: Ctx, commentId: string, permission: 'comment.read' | 'comment.write') {
  return loadScoped<CommentRow>(c, {
    from: COMMENT_FROM,
    id: commentId,
    permission,
    resource: 'comment',
  });
}

function sourceOf(principal: Principal): Comment['source'] {
  if (principal.type === 'user') return 'dashboard';
  if (principal.type === 'api_key' && principal.agent) return 'mcp';
  return 'api';
}

async function assertLabels(c: Ctx, projectId: string, labelIds: string[]): Promise<void> {
  if (labelIds.length === 0) return;
  const found = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM labels WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))',
  )
    .bind(projectId, JSON.stringify([...new Set(labelIds)]))
    .first<{ n: number }>();
  if ((found?.n ?? 0) !== new Set(labelIds).size) {
    throw unprocessable('invalid_labels', 'Every label must belong to the project');
  }
}

async function assertAssignee(
  c: Ctx,
  scope: Scope,
  userId: string | null | undefined,
): Promise<void> {
  if (userId && !(await isMember(c.env.DB, scope.workspaceId, userId))) {
    throw unprocessable('invalid_assignee', 'The assignee must be a member of the workspace');
  }
}

function labelStatements(c: Ctx, commentId: string, labelIds: string[]): D1PreparedStatement[] {
  return [
    c.env.DB.prepare('DELETE FROM comment_labels WHERE comment_id = ?').bind(commentId),
    ...[...new Set(labelIds)].map((labelId) =>
      c.env.DB.prepare('INSERT INTO comment_labels (comment_id, label_id) VALUES (?, ?)').bind(
        commentId,
        labelId,
      ),
    ),
  ];
}

/** The minimal comment summary carried in events and webhook payloads. */
export function eventData(
  comment: Pick<CommentRow, 'id' | 'body' | 'page_url' | 'page_path' | 'kind'> & {
    number?: number;
  },
) {
  return {
    number: comment.number,
    kind: comment.kind,
    body: comment.body.slice(0, 500),
    page_url: comment.page_url,
    page_path: comment.page_path,
  };
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}/comments',
    tags,
    summary: 'List comments (inbox)',
    description:
      'Filters combine with AND. Defaults to active comments (open, in progress, in review), newest first. `q` searches text, or finds `#42` by number.',
    request: { params: ProjectParams, query: commentListQuery },
    responses: { 200: json(S.paginated(S.Comment), 'Comments') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    await requireProject(c, projectId, 'comment.read');
    const principal = c.get('principal');
    const viewer = principal.type === 'user' ? principal.user.id : null;
    return c.json(await listComments(c.env.DB, projectId, c.req.valid('query'), viewer), 200);
  },
);

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}/comments/counts',
    tags,
    summary: 'Count comments by status',
    description: 'Totals for inbox tabs and board columns, optionally for one page.',
    request: {
      params: ProjectParams,
      query: z.object({ page: z.union([z.uuid(), z.literal('unassigned')]).optional() }),
    },
    responses: { 200: json(S.CommentCounts, 'Counts') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { page } = c.req.valid('query');
    await requireProject(c, projectId, 'comment.read');
    const filter = page === 'unassigned' ? 'AND page_id IS NULL' : page ? 'AND page_id = ?' : '';
    const params = page && page !== 'unassigned' ? [projectId, page] : [projectId];
    const { results } = await c.env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM comments WHERE project_id = ? ${filter} GROUP BY status`,
    )
      .bind(...params)
      .all<{ status: Comment['status']; n: number }>();
    const unassigned = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM comments WHERE project_id = ? AND page_id IS NULL
          AND status IN ('open', 'in_progress', 'in_review')`,
    )
      .bind(projectId)
      .first<{ n: number }>();
    const byStatus = Object.fromEntries(COMMENT_STATUSES.map((s) => [s, 0])) as Record<
      Comment['status'],
      number
    >;
    for (const row of results) byStatus[row.status] = row.n;
    return c.json({ by_status: byStatus, unassigned: unassigned?.n ?? 0 }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/comments',
    tags,
    summary: 'Create a comment',
    description:
      'For members, scripts and agents. Pass `page_id`, or `page_url` to have the page matched automatically. Comments from the widget use the public ingest endpoint instead.',
    request: { params: ProjectParams, ...body(S.CreateCommentInput) },
    responses: { 201: json(S.Comment, 'Created') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { scope } = await requireProject(c, projectId, 'comment.write');
    const principal = c.get('principal');
    await assertLabels(c, projectId, input.label_ids);
    await assertAssignee(c, scope, input.assignee_user_id);

    let pageId: string | null = null;
    let pagePath = '/';
    if (input.page_id) {
      const page = await c.env.DB.prepare('SELECT path FROM pages WHERE id = ? AND project_id = ?')
        .bind(input.page_id, projectId)
        .first<{ path: string }>();
      if (!page) throw unprocessable('invalid_page', 'page_id must be a page of this project');
      pageId = input.page_id;
      pagePath = page.path;
    } else if (input.page_url) {
      ({ pageId, pagePath } = await resolvePage(
        c.env.DB,
        projectId,
        input.page_url,
        await listOrigins(c.env.DB, projectId),
      ));
    }

    const now = Date.now();
    const actor = actorOf(principal);
    const row: Omit<CommentRow, 'number'> = {
      ...emptyCommentRow({
        id: newId(),
        project_id: projectId,
        body: input.body,
        page_url: input.page_url ?? '',
        page_path: pagePath,
        now,
      }),
      page_id: pageId,
      kind: input.kind,
      source: sourceOf(principal),
      priority: input.priority,
      title: input.title ?? null,
      body_lang: detectLanguage(input.body),
      author_user_id: principal.type === 'user' ? principal.user.id : null,
      author_name: actor.name,
      author_verified: 1,
      assignee_user_id: input.assignee_user_id ?? null,
      due_at: input.due_at ?? null,
      ...anchorColumns(input.anchor),
      suggestion_original: input.suggestion?.original ?? null,
      suggestion_text: input.suggestion?.text ?? null,
      content_block_id: input.suggestion
        ? await matchContentBlock(c.env.DB, pageId, input.suggestion.original)
        : null,
    };
    const uow = new UnitOfWork(c.env).add(
      insertComment(c.env.DB, row),
      ...labelStatements(c, row.id, input.label_ids),
    );
    const event = {
      type: 'comment.created' as const,
      workspaceId: scope.workspaceId,
      projectId,
      actor,
      subjectType: 'comment',
      subjectId: row.id,
      data: eventData(row),
    };
    uow.event(event);
    await uow.commit(c);
    const comment = orThrow(await getComment(c.env.DB, row.id), notFound('comment'));
    await background(
      c,
      notifyIntegrations(c.env, { ...event, data: { ...event.data, number: comment.number } }),
    );
    return c.json(comment, 201);
  },
);

// ---------------------------------------------------------------------------
// One comment
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/comments/{commentId}',
    tags,
    summary: 'Get a comment with its thread',
    description: 'Includes replies (internal notes too), attachments and links to external issues.',
    request: { params: CommentParams },
    responses: { 200: json(S.CommentDetail, 'The comment') },
  }),
  async (c) => {
    const { commentId } = c.req.valid('param');
    await requireComment(c, commentId, 'comment.read');
    const comment = orThrow(await getComment(c.env.DB, commentId), notFound('comment'));
    const [replies, attachments, links] = await Promise.all([
      listReplies(c.env.DB, commentId, true),
      c.env.DB.prepare('SELECT * FROM attachments WHERE comment_id = ? ORDER BY created_at')
        .bind(commentId)
        .all<AttachmentRow>(),
      listExternalLinks(c.env.DB, commentId),
    ]);
    return c.json(
      {
        ...comment,
        replies: replies.map(toReply),
        attachments: attachments.results.map(toAttachment),
        external_links: links,
      },
      200,
    );
  },
);

app.openapi(
  route({
    method: 'patch',
    path: '/comments/{commentId}',
    tags,
    summary: 'Triage a comment',
    description:
      'Change status, priority, kind, title, page, assignee, due date, labels or duplicate link. Moving a comment to a page with `learn_path_alias` teaches Croquis that its URL belongs to that page, and adopts other unassigned comments from the same URL.',
    request: { params: CommentParams, ...body(S.UpdateCommentInput) },
    responses: { 200: json(S.Comment, 'Updated') },
  }),
  async (c) => {
    const { commentId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { row, scope } = await requireComment(c, commentId, 'comment.write');
    const principal = c.get('principal');
    const now = Date.now();

    if (input.label_ids) await assertLabels(c, scope.projectId, input.label_ids);
    if (input.assignee_user_id !== undefined)
      await assertAssignee(c, scope, input.assignee_user_id);
    if (input.page_id) {
      const page = await c.env.DB.prepare(
        'SELECT 1 AS ok FROM pages WHERE id = ? AND project_id = ?',
      )
        .bind(input.page_id, scope.projectId)
        .first();
      if (!page) throw unprocessable('invalid_page', 'page_id must be a page of this project');
    }
    if (input.duplicate_of_id) {
      if (input.duplicate_of_id === commentId)
        throw unprocessable('invalid_duplicate', 'A comment cannot duplicate itself');
      const original = await c.env.DB.prepare(
        'SELECT 1 AS ok FROM comments WHERE id = ? AND project_id = ?',
      )
        .bind(input.duplicate_of_id, scope.projectId)
        .first();
      if (!original)
        throw unprocessable(
          'invalid_duplicate',
          'duplicate_of_id must be a comment of this project',
        );
    }

    let status = input.status ?? row.status;
    // Marking a duplicate closes it unless a status was given explicitly.
    if (
      input.duplicate_of_id &&
      input.status === undefined &&
      !CLOSED_COMMENT_STATUSES.includes(row.status as never)
    ) {
      status = 'wont_fix';
    }
    const closing = CLOSED_COMMENT_STATUSES.includes(status as never);
    const wasClosed = CLOSED_COMMENT_STATUSES.includes(row.status as never);
    const next: CommentRow = {
      ...row,
      status,
      priority: input.priority ?? row.priority,
      kind: input.kind ?? row.kind,
      title: input.title === undefined ? row.title : input.title,
      page_id: input.page_id === undefined ? row.page_id : input.page_id,
      assignee_user_id:
        input.assignee_user_id === undefined ? row.assignee_user_id : input.assignee_user_id,
      due_at: input.due_at === undefined ? row.due_at : input.due_at,
      duplicate_of_id:
        input.duplicate_of_id === undefined ? row.duplicate_of_id : input.duplicate_of_id,
      resolved_at: closing ? (wasClosed ? row.resolved_at : now) : null,
      resolved_by_user_id: closing
        ? wasClosed
          ? row.resolved_by_user_id
          : principal.type === 'user'
            ? principal.user.id
            : null
        : null,
      updated_at: now,
    };

    const fields = [
      'status',
      'priority',
      'kind',
      'title',
      'page_id',
      'assignee_user_id',
      'due_at',
      'duplicate_of_id',
    ] as const;
    const changes = Object.fromEntries(
      fields.filter((f) => next[f] !== row[f]).map((f) => [f, next[f]]),
    );
    const labelsChanged = input.label_ids !== undefined;
    const uow = new UnitOfWork(c.env);
    if (Object.keys(changes).length > 0 || labelsChanged) {
      uow.add(
        c.env.DB.prepare(
          `UPDATE comments SET status = ?, priority = ?, kind = ?, title = ?, page_id = ?, assignee_user_id = ?, due_at = ?,
                  duplicate_of_id = ?, resolved_at = ?, resolved_by_user_id = ?, updated_at = ? WHERE id = ?`,
        ).bind(
          next.status,
          next.priority,
          next.kind,
          next.title,
          next.page_id,
          next.assignee_user_id,
          next.due_at,
          next.duplicate_of_id,
          next.resolved_at,
          next.resolved_by_user_id,
          now,
          commentId,
        ),
      );
    }
    if (input.label_ids) uow.add(...labelStatements(c, commentId, input.label_ids));
    if (input.learn_path_alias && next.page_id && next.page_id !== row.page_id) {
      uow.add(
        c.env.DB.prepare(
          `INSERT INTO page_path_aliases (id, project_id, page_id, path, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (project_id, path) DO UPDATE SET page_id = excluded.page_id`,
        ).bind(newId(), scope.projectId, next.page_id, row.page_path, now),
        c.env.DB.prepare(
          'UPDATE comments SET page_id = ?, updated_at = ? WHERE project_id = ? AND page_id IS NULL AND page_path = ?',
        ).bind(next.page_id, now, scope.projectId, row.page_path),
      );
    }

    const actor = actorOf(principal);
    const base = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actor,
      subjectType: 'comment',
      subjectId: commentId,
    };
    if (changes.status !== undefined) {
      uow.event({
        ...base,
        type: 'comment.status_changed',
        data: { ...eventData(row), from: row.status, to: next.status },
      });
    }
    if (changes.assignee_user_id !== undefined) {
      uow.event({
        ...base,
        type: 'comment.assigned',
        data: { ...eventData(row), assignee_user_id: next.assignee_user_id },
      });
    }
    const other = Object.fromEntries(
      Object.entries(changes).filter(([k]) => k !== 'status' && k !== 'assignee_user_id'),
    );
    if (Object.keys(other).length > 0 || labelsChanged) {
      uow.event({
        ...base,
        type: 'comment.updated',
        data: {
          ...eventData(row),
          changes: { ...other, ...(labelsChanged ? { label_ids: input.label_ids } : {}) },
        },
      });
    }
    await uow.commit(c);
    return c.json(orThrow(await getComment(c.env.DB, commentId), notFound('comment')), 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/comments/{commentId}/fix',
    tags,
    summary: 'Report a fix',
    description:
      'Closes the agent loop: record the commit, pull request or deploy that addresses the feedback. `in_review` (default) asks the reviewer to confirm; `resolved` closes it directly. A reply summarising the fix is added to the thread.',
    request: { params: CommentParams, ...body(S.FixCommentInput) },
    responses: { 200: json(S.Comment, 'Updated') },
  }),
  async (c) => {
    const { commentId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { row, scope } = await requireComment(c, commentId, 'comment.write');
    const principal = c.get('principal');
    const actor = actorOf(principal);
    const now = Date.now();
    const summary = [
      input.note,
      input.commit_sha ? `Commit: ${input.commit_sha}` : null,
      input.pr_url ? `Pull request: ${input.pr_url}` : null,
      input.deploy_url ? `Preview: ${input.deploy_url}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const reply: ReplyRow = {
      id: newId(),
      comment_id: commentId,
      author_user_id: principal.type === 'user' ? principal.user.id : null,
      author_guest_id: null,
      author_name: actor.name,
      body: summary,
      internal: 0,
      created_at: now,
    };
    const resolved = input.status === 'resolved';
    const uow = new UnitOfWork(c.env).add(
      c.env.DB.prepare(
        `UPDATE comments SET status = ?, fixed_commit_sha = COALESCE(?, fixed_commit_sha), fixed_pr_url = COALESCE(?, fixed_pr_url),
                fixed_deploy_url = COALESCE(?, fixed_deploy_url), fixed_at = ?, resolved_at = ?, resolved_by_user_id = ?,
                updated_at = ? WHERE id = ?`,
      ).bind(
        input.status,
        input.commit_sha ?? null,
        input.pr_url ?? null,
        input.deploy_url ?? null,
        now,
        resolved ? now : null,
        resolved && principal.type === 'user' ? principal.user.id : null,
        now,
        commentId,
      ),
      insertReply(c.env.DB, reply),
    );
    uow.event({
      type: 'comment.fixed',
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actor,
      subjectType: 'comment',
      subjectId: commentId,
      data: {
        ...eventData(row),
        status: input.status,
        commit_sha: input.commit_sha ?? null,
        pr_url: input.pr_url ?? null,
        deploy_url: input.deploy_url ?? null,
      },
    });
    await uow.commit(c);
    return c.json(orThrow(await getComment(c.env.DB, commentId), notFound('comment')), 200);
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/comments/{commentId}',
    tags,
    summary: 'Delete a comment',
    description: 'Removes the thread and its attachments. Prefer `wont_fix` to keep history.',
    request: { params: CommentParams },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { commentId } = c.req.valid('param');
    const { row, scope } = await requireComment(c, commentId, 'comment.write');
    const { results: objects } = await c.env.DB.prepare(
      'SELECT r2_key FROM attachments WHERE comment_id = ?',
    )
      .bind(commentId)
      .all<{ r2_key: string }>();
    const uow = new UnitOfWork(c.env).add(
      c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(commentId),
    );
    uow.event({
      type: 'comment.deleted',
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actor: actorOf(c.get('principal')),
      subjectType: 'comment',
      subjectId: commentId,
      data: eventData(row),
    });
    await uow.commit(c);
    await background(
      c,
      deleteObjects(
        c.env.BUCKET,
        objects.map((o) => o.r2_key),
      ),
    );
    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'post',
    path: '/comments/{commentId}/replies',
    tags,
    summary: 'Reply to a comment',
    description:
      '`internal: true` makes a note only members can see (never shown in the share viewer or widget).',
    request: { params: CommentParams, ...body(S.CreateReplyInput) },
    responses: { 201: json(S.Reply, 'Created') },
  }),
  async (c) => {
    const { commentId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { row, scope } = await requireComment(c, commentId, 'comment.write');
    const principal = c.get('principal');
    const actor = actorOf(principal);
    const reply: ReplyRow = {
      id: newId(),
      comment_id: commentId,
      author_user_id: principal.type === 'user' ? principal.user.id : null,
      author_guest_id: null,
      author_name: actor.name,
      body: input.body,
      internal: input.internal ? 1 : 0,
      created_at: Date.now(),
      author_user_name: principal.type === 'user' ? principal.user.name : null,
    };
    const uow = new UnitOfWork(c.env).add(
      insertReply(c.env.DB, reply),
      c.env.DB.prepare('UPDATE comments SET updated_at = ? WHERE id = ?').bind(
        reply.created_at,
        commentId,
      ),
    );
    uow.event({
      type: 'reply.created',
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actor,
      subjectType: 'comment',
      subjectId: commentId,
      data: {
        ...eventData(row),
        reply_id: reply.id,
        reply: input.body.slice(0, 500),
        internal: input.internal,
      },
    });
    await uow.commit(c);
    return c.json(toReply(reply), 201);
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/replies/{replyId}',
    tags,
    summary: 'Delete a reply',
    description: 'Authors can delete their own replies; admins can delete any.',
    request: { params: idParam('replyId', 'Reply id') },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { replyId } = c.req.valid('param');
    const { row, scope } = await loadScoped<ReplyRow>(c, {
      from: 'comment_replies x JOIN comments cm ON cm.id = x.comment_id JOIN projects p ON p.id = cm.project_id',
      id: replyId,
      permission: 'comment.write',
      resource: 'reply',
    });
    const principal = c.get('principal');
    const own = principal.type === 'user' && principal.user.id === row.author_user_id;
    const elevated =
      principal.type === 'admin' || (scope.role !== null && roleAtLeast(scope.role, 'admin'));
    if (!own && !elevated) throw forbidden('Only the author or an admin can delete this reply');
    await c.env.DB.prepare('DELETE FROM comment_replies WHERE id = ?').bind(replyId).run();
    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/attachments/{attachmentId}',
    tags,
    summary: 'Download an attachment',
    description: 'Screenshots and captured console/network logs.',
    request: { params: idParam('attachmentId', 'Attachment id') },
    responses: {
      200: {
        description: 'The file',
        content: { 'image/*': { schema: z.any() }, 'application/json': { schema: z.any() } },
      },
    },
  }),
  async (c) => {
    const { attachmentId } = c.req.valid('param');
    const { row } = await loadScoped<AttachmentRow>(c, {
      from: 'attachments x JOIN projects p ON p.id = x.project_id',
      id: attachmentId,
      permission: 'comment.read',
      resource: 'attachment',
    });
    const object = await c.env.BUCKET.get(row.r2_key);
    if (!object) throw notFound('attachment');
    return new Response(object.body, {
      headers: {
        'Content-Type': row.content_type,
        'Content-Length': String(object.size),
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': 'inline',
      },
    });
  },
);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}/export',
    tags: ['Export'],
    summary: 'Export for AI agents',
    description:
      'The whole project — sitemap, content, approvals and every comment thread — as JSON or as Markdown ready to paste into an LLM. Reviewer text is fenced as untrusted input.',
    request: {
      params: ProjectParams,
      query: z.object({ format: z.enum(['json', 'markdown']).default('json') }),
    },
    responses: {
      200: {
        description: 'The export',
        content: {
          'application/json': { schema: S.ProjectExport },
          'text/markdown': { schema: z.string() },
        },
      },
    },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { format } = c.req.valid('query');
    const { row } = await requireProject(c, projectId, 'comment.read');
    // Fixed number of queries regardless of project size (D1 caps queries per invocation).
    const [pages, comments, blocks, approvals, replyRows] = await Promise.all([
      listPages(c.env.DB, projectId),
      allComments(c.env.DB, projectId),
      c.env.DB.prepare(
        `SELECT b.* FROM content_blocks b JOIN pages pg ON pg.id = b.page_id
          WHERE pg.project_id = ? ORDER BY b.position, b.created_at, b.id`,
      )
        .bind(projectId)
        .all<ContentBlockRow>(),
      c.env.DB.prepare(
        `SELECT a.* FROM page_approvals a JOIN pages pg ON pg.id = a.page_id
          WHERE pg.project_id = ? ORDER BY a.created_at DESC, a.id DESC`,
      )
        .bind(projectId)
        .all<ApprovalRow>(),
      c.env.DB.prepare(
        `SELECT r.*, u.name AS author_user_name FROM comment_replies r
           JOIN comments cm ON cm.id = r.comment_id LEFT JOIN users u ON u.id = r.author_user_id
          WHERE cm.project_id = ? AND r.internal = 0 ORDER BY r.created_at, r.id`,
      )
        .bind(projectId)
        .all<ReplyRow>(),
    ]);
    const group = <T, K extends string>(items: T[], key: (item: T) => K) => {
      const map = new Map<K, T[]>();
      for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
      return map;
    };
    const blocksBy = group(blocks.results.map(toContentBlock), (b) => b.page_id);
    const approvalsBy = group(approvals.results.map(toApproval), (a) => a.page_id);
    const repliesBy = group(replyRows.results.map(toReply), (r) => r.comment_id);
    const withReplies = (comment: Comment) => ({
      ...comment,
      replies: repliesBy.get(comment.id) ?? [],
    });
    const { ingest_key: _secret, ...project } = toProject(row);
    const exported: ProjectExport = {
      schema_version: EXPORT_SCHEMA_VERSION,
      exported_at: Date.now(),
      project,
      pages: pages.map(({ comments_active: _a, comments_total: _t, approval: _p, ...page }) => ({
        ...page,
        content_blocks: blocksBy.get(page.id) ?? [],
        approvals: approvalsBy.get(page.id) ?? [],
        comments: comments.filter((cm) => cm.page_id === page.id).map(withReplies),
      })),
      unassigned_comments: comments.filter((cm) => cm.page_id === null).map(withReplies),
    };
    if (format === 'markdown') {
      return c.body(formatExportMarkdown(exported), 200, {
        'Content-Type': 'text/markdown; charset=utf-8',
      });
    }
    return c.json(exported, 200);
  },
);

export default app;
