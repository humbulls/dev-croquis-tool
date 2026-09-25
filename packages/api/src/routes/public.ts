import { normalizeOrigin, pagePathFromUrl } from '@croquis/shared';
import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { PLAN_QUOTAS, runtimeConfig } from '../config';
import {
  type CommentListRow,
  type CommentRow,
  emptyCommentRow,
  getComment,
  hydrate,
  insertComment,
  insertReply,
  listReplies,
  type ReplyRow,
  toPublicComment,
  toPublicReply,
} from '../db/comments';
import { type ApprovalRow, insertApproval, listPages, toApproval } from '../db/pages';
import { listOrigins, type OriginRow, type ShareLinkRow } from '../db/projects';
import type { AppEnv } from '../env';
import { background } from '../http/background';
import { body, createRouter, idParam, json, problem, publicRoute } from '../http/openapi';
import {
  ApiError,
  forbidden,
  notFound,
  orThrow,
  quotaExceeded,
  unauthorized,
} from '../http/problem';
import { rateLimit } from '../http/rate-limit';
import * as S from '../http/schemas';
import type { ProjectRow } from '../security/access';
import { sha256Hex, verifyPassword } from '../security/crypto';
import { issueShareToken, SHARE_SESSION_TTL_MS, verifyShareToken } from '../security/share-token';
import { newId, newReviewerToken } from '../security/tokens';
import {
  insertAttachment,
  type StagedObject,
  stageJson,
  stageScreenshot,
} from '../services/attachments';
import {
  anchorColumns,
  detectLanguage,
  environmentColumns,
  matchContentBlock,
  resolvePage,
} from '../services/intake';
import { notifyIntegrations } from '../services/integrations';
import { UnitOfWork } from '../services/unit-of-work';
import { eventData } from './comments';

/**
 * Unauthenticated surfaces: the embeddable widget (ingest key + optional share
 * session) and the client share viewer (share link + session token). Nothing
 * here exposes emails, internal notes, assignees or environment details.
 */

const app = createRouter();
type Ctx = Context<AppEnv>;

const SHARE_TOKEN_HEADER = 'X-Croquis-Share-Token';

// Optional in the schema so a missing token yields 401 rather than a 422 validation error.
const shareTokenHeader = z.object({
  'x-croquis-share-token': z.string().max(1000).optional().openapi({
    description: 'Share session token from POST /public/share/{slug}/session (required)',
  }),
});

interface GuestRow {
  id: string;
  project_id: string;
  name: string;
  email: string | null;
}

interface ShareContext {
  link: ShareLinkRow;
  project: ProjectRow;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function loadShareLink(c: Ctx, slug: string): Promise<ShareContext> {
  const row = await c.env.DB.prepare(
    `SELECT l.*, p.id AS p_id, p.workspace_id AS p_workspace_id, p.name AS p_name, p.slug AS p_slug,
            p.description AS p_description, p.ingest_key AS p_ingest_key, p.widget_mode AS p_widget_mode,
            p.created_at AS p_created_at, p.updated_at AS p_updated_at
       FROM share_links l JOIN projects p ON p.id = l.project_id WHERE l.slug = ?`,
  )
    .bind(slug)
    .first<ShareLinkRow & Record<`p_${string}`, never>>();
  if (!row || row.revoked_at !== null) throw notFound('share_link');
  if (row.expires_at !== null && row.expires_at <= Date.now()) {
    throw new ApiError(
      410,
      'share_link_expired',
      'Gone',
      'This review link has expired; ask for a new one',
    );
  }
  const r = row as unknown as Record<string, unknown>;
  const project: ProjectRow = {
    id: r.p_id as string,
    workspace_id: r.p_workspace_id as string,
    name: r.p_name as string,
    slug: r.p_slug as string,
    description: r.p_description as string,
    ingest_key: r.p_ingest_key as string,
    widget_mode: r.p_widget_mode as ProjectRow['widget_mode'],
    created_at: r.p_created_at as number,
    updated_at: r.p_updated_at as number,
  };
  const link = Object.fromEntries(
    Object.entries(r).filter(([k]) => !k.startsWith('p_')),
  ) as unknown as ShareLinkRow;
  return { link, project };
}

/** Resolve and validate the share session sent in the header (or `?token=` for images). */
async function shareSession(
  c: Ctx,
  token: string | undefined,
): Promise<(ShareContext & { reviewer: GuestRow }) | null> {
  const claims = await verifyShareToken(c.env, token);
  if (!claims) return null;
  const row = await c.env.DB.prepare('SELECT slug FROM share_links WHERE id = ?')
    .bind(claims.link)
    .first<{ slug: string }>();
  if (!row) return null;
  const context = await loadShareLink(c, row.slug);
  const reviewer = await c.env.DB.prepare(
    'SELECT id, project_id, name, email FROM guest_reviewers WHERE id = ? AND project_id = ?',
  )
    .bind(claims.reviewer, context.project.id)
    .first<GuestRow>();
  return reviewer ? { ...context, reviewer } : null;
}

async function requireShareSession(c: Ctx, slug: string, token?: string) {
  const session = await shareSession(c, token ?? c.req.header(SHARE_TOKEN_HEADER));
  if (!session || session.link.slug !== slug) {
    throw unauthorized('Start a review session first (POST /api/v1/public/share/{slug}/session)');
  }
  return session;
}

/** Widget requests must come from one of the project's registered origins (when any are registered). */
function assertOrigin(c: Ctx, origins: OriginRow[], pageUrl?: string): void {
  if (origins.length === 0) return;
  const allowed = new Set(origins.map((o) => o.origin));
  const header = c.req.header('Origin');
  const requestOrigin = header && header !== 'null' ? normalizeOrigin(header) : null;
  if (header && (!requestOrigin || !allowed.has(requestOrigin))) {
    throw new ApiError(
      403,
      'origin_not_allowed',
      'Forbidden',
      `${header} is not a registered origin for this project`,
    );
  }
  if (pageUrl !== undefined) {
    const pageOrigin = normalizeOrigin(pageUrl);
    if (!pageOrigin || !allowed.has(pageOrigin)) {
      throw new ApiError(
        403,
        'origin_not_allowed',
        'Forbidden',
        'page_url is not on a registered origin',
      );
    }
  }
}

async function projectByIngestKey(c: Ctx, key: string | undefined): Promise<ProjectRow> {
  if (!key)
    throw new ApiError(
      401,
      'invalid_ingest_key',
      'Unauthorized',
      'Send the project ingest key (X-Croquis-Ingest-Key)',
    );
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE ingest_key = ?')
    .bind(key)
    .first<ProjectRow>();
  if (!project) throw new ApiError(401, 'invalid_ingest_key', 'Unauthorized', 'Unknown ingest key');
  if (project.widget_mode === 'off')
    throw new ApiError(
      403,
      'widget_disabled',
      'Forbidden',
      'Feedback is turned off for this project',
    );
  return project;
}

async function verifyTurnstile(c: Ctx, token: string | undefined): Promise<void> {
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) return;
  if (!token)
    throw new ApiError(
      403,
      'turnstile_required',
      'Forbidden',
      'Complete the verification challenge',
    );
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  const ip = c.req.header('cf-connecting-ip');
  if (ip) form.append('remoteip', ip);
  const result = (await (
    await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    })
  ).json()) as { success?: boolean };
  if (!result.success)
    throw new ApiError(403, 'turnstile_failed', 'Forbidden', 'Verification failed; try again');
}

async function assertDailyQuota(c: Ctx, project: ProjectRow): Promise<void> {
  if (runtimeConfig(c.env).edition !== 'cloud') return;
  const row = await c.env.DB.prepare(
    `SELECT w.plan, (SELECT COUNT(*) FROM comments cm JOIN projects p ON p.id = cm.project_id
                      WHERE p.workspace_id = w.id AND cm.created_at > ?) AS today
       FROM workspaces w WHERE w.id = ?`,
  )
    .bind(Date.now() - 86_400_000, project.workspace_id)
    .first<{ plan: keyof typeof PLAN_QUOTAS; today: number }>();
  if (row && row.today >= PLAN_QUOTAS[row.plan].commentsPerDay) {
    throw quotaExceeded('This workspace reached its daily comment limit');
  }
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

app.openapi(
  publicRoute({
    method: 'get',
    path: '/public/widget/config',
    tags: ['Widget'],
    summary: 'Widget bootstrap',
    description:
      'Called by the embedded widget before it renders. Checks the ingest key and the calling origin.',
    request: {
      query: z.object({
        key: z.string().min(1).max(100).openapi({ description: 'Project ingest key' }),
      }),
    },
    responses: { 200: json(S.WidgetConfig, 'Configuration') },
  }),
  async (c) => {
    await rateLimit(c, 'widget');
    const project = await projectByIngestKey(c, c.req.valid('query').key);
    assertOrigin(c, await listOrigins(c.env.DB, project.id));
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(
      {
        project: { id: project.id, name: project.name },
        widget_mode: project.widget_mode,
        requires_reviewer: project.widget_mode === 'activated',
        turnstile_site_key: c.env.TURNSTILE_SECRET ? (c.env.TURNSTILE_SITE_KEY ?? null) : null,
      },
      200,
    );
  },
);

app.openapi(
  publicRoute({
    method: 'post',
    path: '/public/ingest/comments',
    tags: ['Widget'],
    summary: 'Submit feedback from the widget',
    description:
      'Authenticated by `X-Croquis-Ingest-Key`. In `activated` mode the reviewer’s share session (`X-Croquis-Share-Token`) is required; in `always` mode anonymous feedback is accepted (and marked unverified).',
    request: {
      headers: z.object({
        'x-croquis-ingest-key': z
          .string()
          .max(100)
          .optional()
          .openapi({ description: 'Project ingest key' }),
        'x-croquis-share-token': z
          .string()
          .max(1000)
          .optional()
          .openapi({ description: 'Share session token' }),
      }),
      ...body(S.IngestCommentInput),
    },
    responses: { 201: json(S.IngestResult, 'Stored') },
  }),
  async (c) => {
    await rateLimit(c, 'ingest');
    const input = c.req.valid('json');
    const project = await projectByIngestKey(c, c.req.header('X-Croquis-Ingest-Key'));
    const origins = await listOrigins(c.env.DB, project.id);
    assertOrigin(c, origins, input.page_url);

    const session = await shareSession(c, c.req.header(SHARE_TOKEN_HEADER));
    if (session && session.project.id !== project.id)
      throw forbidden('The review session belongs to another project');
    if (session && session.link.allow_comments !== 1)
      throw forbidden('This review link does not accept comments');
    if (!session && project.widget_mode === 'activated') {
      throw new ApiError(
        403,
        'reviewer_required',
        'Forbidden',
        'Open the site through its review link to leave feedback',
      );
    }
    if (!session) await verifyTurnstile(c, input.turnstile_token);
    await assertDailyQuota(c, project);

    const { pageId, pagePath } = await resolvePage(c.env.DB, project.id, input.page_url, origins);
    const now = Date.now();
    const id = newId();
    const kind = input.suggestion && input.kind === 'feedback' ? 'text_edit' : input.kind;
    const row: Omit<CommentRow, 'number'> = {
      ...emptyCommentRow({
        id,
        project_id: project.id,
        body: input.body,
        page_url: input.page_url,
        page_path: pagePath,
        now,
      }),
      page_id: pageId,
      kind,
      source: 'widget',
      body_lang: detectLanguage(input.body),
      author_guest_id: session?.reviewer.id ?? null,
      author_name: session?.reviewer.name ?? input.author_name ?? null,
      author_verified: session ? 1 : 0,
      ...anchorColumns(input.anchor),
      ...environmentColumns(input.environment, c.req.header('User-Agent') ?? null),
      suggestion_original: input.suggestion?.original ?? null,
      suggestion_text: input.suggestion?.text ?? null,
      content_block_id: input.suggestion
        ? await matchContentBlock(c.env.DB, pageId, input.suggestion.original)
        : null,
    };

    const staged: StagedObject[] = [];
    if (input.screenshot)
      staged.push(stageScreenshot(project.id, id, input.screenshot, c.env.BUCKET));
    if (input.diagnostics?.console.length)
      staged.push(
        stageJson(project.id, id, 'console_log', input.diagnostics.console, c.env.BUCKET),
      );
    if (input.diagnostics?.network.length)
      staged.push(
        stageJson(project.id, id, 'network_log', input.diagnostics.network, c.env.BUCKET),
      );
    // Objects first: a failed upload leaves no row pointing at a missing file.
    await Promise.all(staged.map((object) => object.put()));

    const uow = new UnitOfWork(c.env).add(
      insertComment(c.env.DB, row),
      ...staged.map((o) => insertAttachment(c.env.DB, o.row)),
    );
    const event = {
      type: 'comment.created' as const,
      workspaceId: project.workspace_id,
      projectId: project.id,
      actor: session
        ? { type: 'guest' as const, id: session.reviewer.id, name: session.reviewer.name }
        : { type: 'guest' as const, id: null, name: row.author_name },
      subjectType: 'comment',
      subjectId: id,
      data: eventData(row),
    };
    uow.event(event);
    await uow.commit(c);
    const saved = await c.env.DB.prepare('SELECT number FROM comments WHERE id = ?')
      .bind(id)
      .first<{ number: number }>();
    await background(
      c,
      notifyIntegrations(c.env, { ...event, data: { ...event.data, number: saved?.number } }),
    );
    return c.json(
      {
        id,
        number: saved?.number ?? 0,
        page_id: pageId,
        screenshot_stored: staged.some((o) => o.row.kind === 'screenshot'),
      },
      201,
    );
  },
);

app.openapi(
  publicRoute({
    method: 'get',
    path: '/public/pins',
    tags: ['Widget'],
    summary: 'Comments pinned on a page',
    description:
      'Lets a reviewer with a share session see existing pins on the page they are viewing.',
    request: {
      query: z.object({ page_url: z.string().url().max(2048) }),
      headers: shareTokenHeader,
    },
    responses: { 200: json(S.data(S.PublicComment), 'Pins on the page') },
  }),
  async (c) => {
    const session = await shareSession(c, c.req.header(SHARE_TOKEN_HEADER));
    if (!session) throw unauthorized('A review session is required to see comments');
    const { page_url } = c.req.valid('query');
    const origins = await listOrigins(c.env.DB, session.project.id);
    assertOrigin(c, origins, page_url);
    const basePath = origins.find((o) => o.origin === normalizeOrigin(page_url))?.base_path ?? '/';
    const path = pagePathFromUrl(page_url, basePath);
    const { results } = await c.env.DB.prepare(
      `SELECT c.*, NULL AS author_user_name, NULL AS assignee_name, NULL AS assignee_email, NULL AS assignee_image,
              (SELECT COUNT(*) FROM comment_replies r WHERE r.comment_id = c.id AND r.internal = 0) AS reply_count
         FROM comments c WHERE c.project_id = ? AND c.page_path = ? AND c.status != 'wont_fix'
        ORDER BY c.created_at LIMIT 300`,
    )
      .bind(session.project.id, path)
      .all<CommentListRow>();
    return c.json({ data: (await hydrate(c.env.DB, results)).map(toPublicComment) }, 200);
  },
);

// ---------------------------------------------------------------------------
// Share viewer
// ---------------------------------------------------------------------------

const SlugParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]{6,32}$/)
    .openapi({ param: { name: 'slug', in: 'path' }, description: 'Share link slug' }),
});
const tags = ['Share viewer'];

app.openapi(
  publicRoute({
    method: 'get',
    path: '/public/share/{slug}',
    tags,
    summary: 'Share link details',
    description: 'Enough to render the entry gate (project name, whether a password is needed).',
    request: { params: SlugParams },
    responses: { 200: json(S.ShareMeta, 'The link'), 410: problem('Expired') },
  }),
  async (c) => {
    await rateLimit(c, 'share');
    const { link, project } = await loadShareLink(c, c.req.valid('param').slug);
    return c.json(
      {
        project: { id: project.id, name: project.name, slug: project.slug },
        label: link.label,
        password_required: link.password_hash !== null,
        allow_comments: link.allow_comments === 1,
        allow_approvals: link.allow_approvals === 1,
      },
      200,
    );
  },
);

app.openapi(
  publicRoute({
    method: 'post',
    path: '/public/share/{slug}/session',
    tags,
    summary: 'Start a review session',
    description:
      'Exchanges the password (if any) and a display name for a session token. Keep `reviewer_token` in the browser to stay the same reviewer next time.',
    request: { params: SlugParams, ...body(S.ShareSessionInput) },
    responses: { 201: json(S.ShareSession, 'Session started'), 410: problem('Expired') },
  }),
  async (c) => {
    const { slug } = c.req.valid('param');
    const input = c.req.valid('json');
    await rateLimit(c, 'share-session', `${slug}:${c.req.header('cf-connecting-ip') ?? ''}`);
    const { link, project } = await loadShareLink(c, slug);
    if (link.password_hash) {
      if (!input.password || !(await verifyPassword(input.password, link.password_hash))) {
        throw new ApiError(401, 'invalid_password', 'Unauthorized', 'The password is not correct');
      }
    }
    const now = Date.now();
    let reviewerToken = input.reviewer_token ?? null;
    let reviewer: GuestRow | null = null;
    if (reviewerToken) {
      reviewer = await c.env.DB.prepare(
        'SELECT id, project_id, name, email FROM guest_reviewers WHERE token_hash = ? AND project_id = ?',
      )
        .bind(await sha256Hex(reviewerToken), project.id)
        .first<GuestRow>();
    }
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare('UPDATE share_links SET last_viewed_at = ? WHERE id = ?').bind(now, link.id),
    ];
    if (reviewer) {
      reviewer = { ...reviewer, name: input.name, email: input.email ?? reviewer.email };
      statements.push(
        c.env.DB.prepare(
          'UPDATE guest_reviewers SET name = ?, email = ?, last_seen_at = ? WHERE id = ?',
        ).bind(reviewer.name, reviewer.email, now, reviewer.id),
      );
    } else {
      reviewerToken = newReviewerToken();
      reviewer = {
        id: newId(),
        project_id: project.id,
        name: input.name,
        email: input.email ?? null,
      };
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO guest_reviewers (id, project_id, name, email, token_hash, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          reviewer.id,
          project.id,
          reviewer.name,
          reviewer.email,
          await sha256Hex(reviewerToken),
          now,
          now,
        ),
      );
    }
    await c.env.DB.batch(statements);
    const expires = Math.min(
      now + SHARE_SESSION_TTL_MS,
      link.expires_at ?? Number.MAX_SAFE_INTEGER,
    );
    return c.json(
      {
        token: await issueShareToken(c.env, { link: link.id, reviewer: reviewer.id, exp: expires }),
        expires_at: expires,
        reviewer_token: reviewerToken as string,
        reviewer: { id: reviewer.id, name: reviewer.name },
      },
      201,
    );
  },
);

app.openapi(
  publicRoute({
    method: 'get',
    path: '/public/share/{slug}/pages',
    tags,
    summary: 'Sitemap for reviewers',
    request: { params: SlugParams, headers: shareTokenHeader },
    responses: { 200: json(S.data(S.SharePage), 'Pages') },
  }),
  async (c) => {
    const { project } = await requireShareSession(c, c.req.valid('param').slug);
    const pages = await listPages(c.env.DB, project.id);
    return c.json(
      {
        data: pages.map((p) => ({
          id: p.id,
          parent_id: p.parent_id,
          path: p.path,
          title: p.title,
          status: p.status,
          sort_index: p.sort_index,
          comments_active: p.comments_active,
          approval: p.approval,
        })),
      },
      200,
    );
  },
);

app.openapi(
  publicRoute({
    method: 'get',
    path: '/public/share/{slug}/comments',
    tags,
    summary: 'Comments visible to reviewers',
    request: {
      params: SlugParams,
      headers: shareTokenHeader,
      query: z.object({
        page: z.union([z.uuid(), z.literal('unassigned')]).optional(),
        include_closed: z.coerce.boolean().default(false),
      }),
    },
    responses: { 200: json(S.data(S.PublicComment), 'Comments, newest first') },
  }),
  async (c) => {
    const { project } = await requireShareSession(c, c.req.valid('param').slug);
    const { page, include_closed } = c.req.valid('query');
    const where = ['c.project_id = ?'];
    const params: unknown[] = [project.id];
    if (page === 'unassigned') where.push('c.page_id IS NULL');
    else if (page) {
      where.push('c.page_id = ?');
      params.push(page);
    }
    where.push(
      include_closed
        ? "c.status != 'wont_fix'"
        : "c.status IN ('open', 'in_progress', 'in_review')",
    );
    const { results } = await c.env.DB.prepare(
      `SELECT c.*, NULL AS author_user_name, NULL AS assignee_name, NULL AS assignee_email, NULL AS assignee_image,
              (SELECT COUNT(*) FROM comment_replies r WHERE r.comment_id = c.id AND r.internal = 0) AS reply_count
         FROM comments c WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT 500`,
    )
      .bind(...params)
      .all<CommentListRow>();
    return c.json({ data: (await hydrate(c.env.DB, results)).map(toPublicComment) }, 200);
  },
);

const ShareCommentParams = SlugParams.extend(idParam('commentId', 'Comment id').shape);

async function sharedComment(c: Ctx, projectId: string, commentId: string) {
  const comment = await getComment(c.env.DB, commentId);
  if (!comment || comment.project_id !== projectId) throw notFound('comment');
  return comment;
}

app.openapi(
  publicRoute({
    method: 'get',
    path: '/public/share/{slug}/comments/{commentId}',
    tags,
    summary: 'A comment thread for reviewers',
    description: 'Internal notes are never included.',
    request: { params: ShareCommentParams, headers: shareTokenHeader },
    responses: { 200: json(S.ShareCommentDetail, 'The thread') },
  }),
  async (c) => {
    const { slug, commentId } = c.req.valid('param');
    const token = c.req.header(SHARE_TOKEN_HEADER);
    const { project } = await requireShareSession(c, slug, token);
    const comment = await sharedComment(c, project.id, commentId);
    const replies = await listReplies(c.env.DB, commentId, false);
    return c.json(
      {
        ...toPublicComment(comment),
        replies: replies.map(toPublicReply),
        screenshot_url: comment.screenshot
          ? `/api/v1/public/share/${slug}/attachments/${comment.screenshot.id}?token=${encodeURIComponent(token ?? '')}`
          : null,
      },
      200,
    );
  },
);

app.openapi(
  publicRoute({
    method: 'post',
    path: '/public/share/{slug}/comments',
    tags,
    summary: 'Comment on a page',
    description:
      'Page-level feedback from the share viewer (pinned feedback comes from the widget on the site itself).',
    request: { params: SlugParams, headers: shareTokenHeader, ...body(S.ShareCommentInput) },
    responses: { 201: json(S.PublicComment, 'Created') },
  }),
  async (c) => {
    await rateLimit(c, 'share-write');
    const { link, project, reviewer } = await requireShareSession(c, c.req.valid('param').slug);
    if (link.allow_comments !== 1) throw forbidden('This review link does not accept comments');
    const input = c.req.valid('json');
    const page = await c.env.DB.prepare('SELECT path FROM pages WHERE id = ? AND project_id = ?')
      .bind(input.page_id, project.id)
      .first<{ path: string }>();
    if (!page) throw notFound('page');
    await assertDailyQuota(c, project);
    const now = Date.now();
    const row: Omit<CommentRow, 'number'> = {
      ...emptyCommentRow({
        id: newId(),
        project_id: project.id,
        body: input.body,
        page_url: '',
        page_path: page.path,
        now,
      }),
      page_id: input.page_id,
      kind: input.kind,
      source: 'share',
      body_lang: detectLanguage(input.body),
      author_guest_id: reviewer.id,
      author_name: reviewer.name,
      author_verified: 1,
    };
    const uow = new UnitOfWork(c.env).add(insertComment(c.env.DB, row));
    const event = {
      type: 'comment.created' as const,
      workspaceId: project.workspace_id,
      projectId: project.id,
      actor: { type: 'guest' as const, id: reviewer.id, name: reviewer.name },
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
    return c.json(toPublicComment(comment), 201);
  },
);

app.openapi(
  publicRoute({
    method: 'post',
    path: '/public/share/{slug}/comments/{commentId}/replies',
    tags,
    summary: 'Reply as a reviewer',
    request: { params: ShareCommentParams, headers: shareTokenHeader, ...body(S.ShareReplyInput) },
    responses: { 201: json(S.PublicReply, 'Created') },
  }),
  async (c) => {
    await rateLimit(c, 'share-write');
    const { slug, commentId } = c.req.valid('param');
    const { link, project, reviewer } = await requireShareSession(c, slug);
    if (link.allow_comments !== 1) throw forbidden('This review link does not accept comments');
    const comment = await sharedComment(c, project.id, commentId);
    const input = c.req.valid('json');
    const reply: ReplyRow = {
      id: newId(),
      comment_id: commentId,
      author_user_id: null,
      author_guest_id: reviewer.id,
      author_name: reviewer.name,
      body: input.body,
      internal: 0,
      created_at: Date.now(),
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
      workspaceId: project.workspace_id,
      projectId: project.id,
      actor: { type: 'guest', id: reviewer.id, name: reviewer.name },
      subjectType: 'comment',
      subjectId: commentId,
      data: {
        number: comment.number,
        kind: comment.kind,
        page_path: comment.page_path,
        reply_id: reply.id,
        reply: input.body.slice(0, 500),
        internal: false,
      },
    });
    await uow.commit(c);
    return c.json(toPublicReply(reply), 201);
  },
);

app.openapi(
  publicRoute({
    method: 'post',
    path: '/public/share/{slug}/pages/{pageId}/approvals',
    tags,
    summary: 'Approve a page or request changes',
    request: {
      params: SlugParams.extend(idParam('pageId', 'Page id').shape),
      headers: shareTokenHeader,
      ...body(S.ShareApprovalInput),
    },
    responses: { 201: json(S.PageApproval, 'Recorded') },
  }),
  async (c) => {
    await rateLimit(c, 'share-write');
    const { slug, pageId } = c.req.valid('param');
    const { link, project, reviewer } = await requireShareSession(c, slug);
    if (link.allow_approvals !== 1) throw forbidden('This review link does not accept approvals');
    const page = await c.env.DB.prepare(
      'SELECT path, title FROM pages WHERE id = ? AND project_id = ?',
    )
      .bind(pageId, project.id)
      .first<{ path: string; title: string }>();
    if (!page) throw notFound('page');
    const input = c.req.valid('json');
    const openRound = await c.env.DB.prepare(
      `SELECT id FROM review_rounds WHERE project_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(project.id)
      .first<{ id: string }>();
    const row: ApprovalRow = {
      id: newId(),
      page_id: pageId,
      review_round_id: openRound?.id ?? null,
      decision: input.decision,
      approver_user_id: null,
      approver_guest_id: reviewer.id,
      approver_name: reviewer.name,
      note: input.note,
      created_at: Date.now(),
    };
    const uow = new UnitOfWork(c.env).add(insertApproval(c.env.DB, row));
    const event = {
      type:
        row.decision === 'approved'
          ? ('page.approved' as const)
          : ('page.changes_requested' as const),
      workspaceId: project.workspace_id,
      projectId: project.id,
      actor: { type: 'guest' as const, id: reviewer.id, name: reviewer.name },
      subjectType: 'page',
      subjectId: pageId,
      data: {
        path: page.path,
        title: page.title,
        note: row.note,
        review_round_id: row.review_round_id,
      },
    };
    uow.event(event);
    await uow.commit(c);
    await background(c, notifyIntegrations(c.env, event));
    return c.json(toApproval(row), 201);
  },
);

app.openapi(
  publicRoute({
    method: 'get',
    path: '/public/share/{slug}/attachments/{attachmentId}',
    tags,
    summary: 'Screenshot for reviewers',
    description: 'Takes the session token as `?token=` so it works in <img> tags.',
    request: {
      params: SlugParams.extend(idParam('attachmentId', 'Attachment id').shape),
      query: z.object({ token: z.string().max(1000) }),
    },
    responses: { 200: { description: 'The image', content: { 'image/*': { schema: z.any() } } } },
  }),
  async (c) => {
    const { slug, attachmentId } = c.req.valid('param');
    const { project } = await requireShareSession(c, slug, c.req.valid('query').token);
    const row = await c.env.DB.prepare(
      `SELECT r2_key, content_type FROM attachments WHERE id = ? AND project_id = ? AND kind = 'screenshot'`,
    )
      .bind(attachmentId, project.id)
      .first<{ r2_key: string; content_type: string }>();
    const object = row ? await c.env.BUCKET.get(row.r2_key) : null;
    if (!row || !object) throw notFound('attachment');
    return new Response(object.body, {
      headers: { 'Content-Type': row.content_type, 'Cache-Control': 'private, max-age=3600' },
    });
  },
);

export default app;
