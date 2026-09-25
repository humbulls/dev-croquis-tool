import { type AiRun, listQuery, normalizePath } from '@croquis/shared';
import type { Context } from 'hono';
import { type CommentRow, emptyCommentRow, insertComment, listComments } from '../db/comments';
import {
  type ContentBlockRow,
  insertContentBlock,
  listPages,
  nextBlockPosition,
  type PageRow,
  toContentBlock,
} from '../db/pages';
import type { AppEnv } from '../env';
import { body, createRouter, idParam, json, problem, route } from '../http/openapi';
import { decodeCursor, paginate } from '../http/pagination';
import { unprocessable } from '../http/problem';
import * as S from '../http/schemas';
import { loadScoped, requireProject, type Scope } from '../security/access';
import { actorOf } from '../security/principal';
import { newId } from '../security/tokens';
import { type AiContext, generate, insertRun } from '../services/ai';
import {
  contentPrompt,
  digestPrompt,
  orderSitemap,
  sitemapPrompt,
  translatePrompt,
  triagePrompt,
  typoPrompt,
} from '../services/ai-tasks';
import { UnitOfWork } from '../services/unit-of-work';

const app = createRouter();
const tags = ['AI'];
const ProjectParams = idParam('projectId', 'Project id');
type Ctx = Context<AppEnv>;

const AI_ERRORS = {
  501: problem('No AI provider is configured'),
  502: problem('The AI provider failed or returned an invalid answer'),
} as const;

function aiContext(c: Ctx, scope: Scope, kind: AiRun['kind']): AiContext {
  const principal = c.get('principal');
  return {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    kind,
    actorId:
      principal.type === 'user'
        ? principal.user.id
        : principal.type === 'api_key'
          ? principal.key.id
          : null,
  };
}

// ---------------------------------------------------------------------------
// Production: sitemap and content drafts
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/ai/sitemap',
    tags,
    summary: 'Draft a sitemap from a brief',
    description:
      'Adds the suggested pages (existing paths are kept). Returns only the pages that were created.',
    request: { params: ProjectParams, ...body(S.AiBriefInput) },
    responses: { 201: json(S.data(S.PageWithStats), 'Created pages'), ...AI_ERRORS },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { brief } = c.req.valid('json');
    const { scope } = await requireProject(c, projectId, 'ai.run');
    const ctx = aiContext(c, scope, 'sitemap');
    const existing = await listPages(c.env.DB, projectId);
    const { value, run } = await generate(
      c.env,
      ctx,
      sitemapPrompt(
        brief,
        existing.map((p) => p.path),
      ),
    );

    const idByPath = new Map(existing.map((p) => [p.path, p.id]));
    const rootCount = existing.filter((p) => p.parent_id === null).length;
    const childCounts = new Map<string | null, number>();
    const now = Date.now();
    const created: PageRow[] = [];
    for (const entry of orderSitemap(value.pages)) {
      const path = normalizePath(entry.path);
      if (idByPath.has(path)) continue;
      const parentId = entry.parent_path
        ? (idByPath.get(normalizePath(entry.parent_path)) ?? null)
        : null;
      const siblings =
        childCounts.get(parentId) ??
        (parentId === null ? rootCount : existing.filter((p) => p.parent_id === parentId).length);
      childCounts.set(parentId, siblings + 1);
      const row: PageRow = {
        id: newId(),
        project_id: projectId,
        parent_id: parentId,
        path,
        title: entry.title,
        purpose: entry.purpose,
        audience: entry.audience,
        status: 'todo',
        sort_index: siblings,
        created_at: now,
        updated_at: now,
      };
      idByPath.set(path, row.id);
      created.push(row);
    }
    const uow = new UnitOfWork(c.env).add(insertRun(c.env.DB, ctx, run));
    for (const row of created) {
      uow.add(
        c.env.DB.prepare(
          `INSERT INTO pages (id, project_id, parent_id, path, title, purpose, audience, status, sort_index, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?)`,
        ).bind(
          row.id,
          projectId,
          row.parent_id,
          row.path,
          row.title,
          row.purpose,
          row.audience,
          row.sort_index,
          now,
          now,
        ),
      );
      uow.event({
        type: 'page.created',
        workspaceId: scope.workspaceId,
        projectId,
        actor: actorOf(c.get('principal')),
        subjectType: 'page',
        subjectId: row.id,
        data: { path: row.path, title: row.title, ai_generated: true },
      });
    }
    await uow.commit(c);
    const pages = await listPages(c.env.DB, projectId);
    const createdIds = new Set(created.map((p) => p.id));
    return c.json({ data: pages.filter((p) => createdIds.has(p.id)) }, 201);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/pages/{pageId}/ai/content',
    tags,
    summary: 'Draft a page’s content',
    description: 'Appends AI-drafted blocks (marked `ai_generated`) after the existing ones.',
    request: { params: idParam('pageId', 'Page id'), ...body(S.AiContentInput) },
    responses: { 201: json(S.data(S.ContentBlock), 'Created blocks'), ...AI_ERRORS },
  }),
  async (c) => {
    const { pageId } = c.req.valid('param');
    const { brief } = c.req.valid('json');
    const { row: page, scope } = await loadScoped<PageRow>(c, {
      from: 'pages x JOIN projects p ON p.id = x.project_id',
      id: pageId,
      permission: 'ai.run',
      resource: 'page',
    });
    const ctx = aiContext(c, scope, 'content');
    const { value, run } = await generate(c.env, ctx, contentPrompt(page, brief));
    const start = await nextBlockPosition(c.env.DB, pageId);
    const now = Date.now();
    const rows: ContentBlockRow[] = value.blocks.map((block, index) => ({
      id: newId(),
      page_id: pageId,
      type: block.type,
      position: start + index,
      content: block.content,
      ai_generated: 1,
      created_at: now,
      updated_at: now,
    }));
    await new UnitOfWork(c.env)
      .add(insertRun(c.env.DB, ctx, run), ...rows.map((r) => insertContentBlock(c.env.DB, r)))
      .commit(c);
    return c.json({ data: rows.map(toContentBlock) }, 201);
  },
);

// ---------------------------------------------------------------------------
// Review: digest, triage, copy check, translation
// ---------------------------------------------------------------------------

async function activeComments(c: Ctx, projectId: string, limit = 150) {
  return (await listComments(c.env.DB, projectId, { limit, sort: 'newest' }, null)).data;
}

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/ai/digest',
    tags,
    summary: 'Summarise open feedback',
    description: 'A prioritised Markdown action plan of the active feedback, grouped by page.',
    request: { params: ProjectParams },
    responses: { 200: json(S.AiDigest, 'Digest'), ...AI_ERRORS },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { row: project, scope } = await requireProject(c, projectId, 'ai.run');
    const comments = await activeComments(c, projectId);
    if (comments.length === 0) {
      return c.json(
        { markdown: 'No open feedback — nothing to summarise.', active_count: 0, run: null },
        200,
      );
    }
    const ctx = aiContext(c, scope, 'digest');
    const { value, run } = await generate(c.env, ctx, digestPrompt(project.name, comments));
    await insertRun(c.env.DB, ctx, run).run();
    return c.json({ markdown: value.markdown, active_count: comments.length, run }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/ai/triage',
    tags,
    summary: 'Title and de-duplicate feedback',
    description:
      'Suggests short titles for untitled comments and groups duplicates. With `apply` (default) titles are saved and duplicates are linked to the canonical comment (their status is left unchanged).',
    request: { params: ProjectParams, ...body(S.AiTriageInput) },
    responses: { 200: json(S.AiTriage, 'Triage result'), ...AI_ERRORS },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { apply } = c.req.valid('json');
    const { scope } = await requireProject(c, projectId, 'ai.run');
    const comments = await activeComments(c, projectId, 100);
    if (comments.length === 0)
      return c.json({ titled: 0, duplicates_marked: 0, groups: [], run: null }, 200);
    const ctx = aiContext(c, scope, 'triage');
    const { value, run } = await generate(c.env, ctx, triagePrompt(comments));

    const byNumber = new Map(comments.map((cm) => [cm.number, cm]));
    const titles = value.titles.filter(
      (t) => byNumber.has(t.number) && !byNumber.get(t.number)?.title,
    );
    const groups = value.duplicates
      .map((g) => ({
        canonical: byNumber.get(g.canonical),
        duplicates: g.duplicates
          .filter((n) => n !== g.canonical)
          .map((n) => byNumber.get(n))
          .filter((x) => x !== undefined),
        reason: g.reason,
      }))
      .filter((g) => g.canonical && g.duplicates.length > 0);

    const uow = new UnitOfWork(c.env).add(insertRun(c.env.DB, ctx, run));
    if (apply) {
      const now = Date.now();
      for (const t of titles) {
        uow.add(
          c.env.DB.prepare('UPDATE comments SET title = ?, updated_at = ? WHERE id = ?').bind(
            t.title,
            now,
            byNumber.get(t.number)?.id,
          ),
        );
      }
      for (const g of groups) {
        for (const d of g.duplicates) {
          uow.add(
            c.env.DB.prepare(
              'UPDATE comments SET duplicate_of_id = ?, updated_at = ? WHERE id = ? AND duplicate_of_id IS NULL',
            ).bind(g.canonical?.id, now, d.id),
          );
        }
      }
    }
    await uow.commit(c);
    return c.json(
      {
        titled: apply ? titles.length : 0,
        duplicates_marked: apply ? groups.reduce((n, g) => n + g.duplicates.length, 0) : 0,
        groups: groups.map((g) => ({
          canonical_id: g.canonical?.id as string,
          duplicate_ids: g.duplicates.map((d) => d.id),
          reason: g.reason,
        })),
        run,
      },
      200,
    );
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/ai/copy-check',
    tags,
    summary: 'Check copy for typos and inconsistent wording',
    description:
      'Proofreads page content (Japanese and English): typos and wrong conversions, inconsistent terms (表記ゆれ), grammar and mixed styles. By default each finding becomes a `typo` comment with a text suggestion, skipping ones already reported.',
    request: { params: ProjectParams, ...body(S.AiTypoCheckInput) },
    responses: { 200: json(S.AiTypoCheck, 'Findings'), ...AI_ERRORS },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { page_id, create_comments } = c.req.valid('json');
    const { scope } = await requireProject(c, projectId, 'ai.run');
    const { results: blocks } = await c.env.DB.prepare(
      `SELECT b.id, b.page_id, b.content, pg.path FROM content_blocks b JOIN pages pg ON pg.id = b.page_id
        WHERE pg.project_id = ? ${page_id ? 'AND pg.id = ?' : ''} AND b.type != 'image' AND length(trim(b.content)) > 0
        ORDER BY pg.sort_index, pg.path, b.position LIMIT 120`,
    )
      .bind(...(page_id ? [projectId, page_id] : [projectId]))
      .all<{ id: string; page_id: string; content: string; path: string }>();
    if (blocks.length === 0)
      throw unprocessable('no_content', 'There is no text content to check yet');

    const ctx = aiContext(c, scope, 'typo_check');
    const { value, run } = await generate(
      c.env,
      ctx,
      typoPrompt(blocks.map((b) => ({ page: b.path, content: b.content }))),
    );
    const findings = value.findings
      .map((f) => ({ ...f, source: blocks[f.block] }))
      .filter((f) => f.source?.content.includes(f.original) && f.original !== f.suggestion);

    const uow = new UnitOfWork(c.env).add(insertRun(c.env.DB, ctx, run));
    let created = 0;
    if (create_comments && findings.length > 0) {
      const { results: reported } = await c.env.DB.prepare(
        `SELECT content_block_id, suggestion_original FROM comments
          WHERE project_id = ? AND kind = 'typo' AND status IN ('open', 'in_progress', 'in_review')`,
      )
        .bind(projectId)
        .all<{ content_block_id: string | null; suggestion_original: string | null }>();
      const seen = new Set(
        reported.map((r) => `${r.content_block_id}\u0000${r.suggestion_original}`),
      );
      const now = Date.now();
      for (const f of findings) {
        const source = f.source as (typeof blocks)[number];
        const key = `${source.id}\u0000${f.original}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const row: Omit<CommentRow, 'number'> = {
          ...emptyCommentRow({
            id: newId(),
            project_id: projectId,
            body: f.reason,
            page_url: '',
            page_path: source.path,
            now,
          }),
          page_id: source.page_id,
          kind: 'typo',
          source: 'ai',
          priority: f.category === 'typo' ? 'medium' : 'low',
          title:
            f.category === 'inconsistency' ? `表記ゆれ / Inconsistent term: ${f.original}` : null,
          author_name: 'Croquis AI',
          author_verified: 1,
          suggestion_original: f.original,
          suggestion_text: f.suggestion,
          content_block_id: source.id,
        };
        uow.add(insertComment(c.env.DB, row));
        created++;
      }
    }
    await uow.commit(c);
    return c.json(
      {
        findings: findings.map((f) => ({
          content_block_id: f.source?.id ?? null,
          original: f.original,
          suggestion: f.suggestion,
          reason: f.reason,
          category: f.category,
        })),
        comments_created: created,
        run,
      },
      200,
    );
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/comments/{commentId}/ai/translate',
    tags,
    summary: 'Translate a comment',
    description: 'Translations are cached per language.',
    request: { params: idParam('commentId', 'Comment id'), ...body(S.AiTranslateInput) },
    responses: { 200: json(S.AiTranslation, 'Translation'), ...AI_ERRORS },
  }),
  async (c) => {
    const { commentId } = c.req.valid('param');
    const { lang } = c.req.valid('json');
    const { row, scope } = await loadScoped<CommentRow>(c, {
      from: 'comments x JOIN projects p ON p.id = x.project_id',
      id: commentId,
      permission: 'comment.read',
      resource: 'comment',
    });
    if (row.body_lang === lang) return c.json({ lang, body: row.body, cached: true }, 200);
    const cached = await c.env.DB.prepare(
      'SELECT body FROM comment_translations WHERE comment_id = ? AND lang = ?',
    )
      .bind(commentId, lang)
      .first<{ body: string }>();
    if (cached) return c.json({ lang, body: cached.body, cached: true }, 200);
    const ctx = aiContext(c, scope, 'translate');
    const { value, run } = await generate(c.env, ctx, translatePrompt(row.body, lang));
    await c.env.DB.batch([
      insertRun(c.env.DB, ctx, run),
      c.env.DB.prepare(
        `INSERT INTO comment_translations (comment_id, lang, body, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (comment_id, lang) DO UPDATE SET body = excluded.body, created_at = excluded.created_at`,
      ).bind(commentId, lang, value.text, Date.now()),
    ]);
    return c.json({ lang, body: value.text, cached: false }, 200);
  },
);

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}/ai/runs',
    tags,
    summary: 'AI usage log',
    description: 'Every AI call with provider, model, token counts, duration and errors.',
    request: { params: ProjectParams, query: listQuery },
    responses: { 200: json(S.paginated(S.AiRun), 'Runs, newest first') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { cursor, limit } = c.req.valid('query');
    await requireProject(c, projectId, 'project.read');
    const after = decodeCursor(cursor);
    const { results } = await c.env.DB.prepare(
      `SELECT id, kind, provider, model, status, input_tokens, output_tokens, duration_ms, error, created_at
         FROM ai_runs WHERE project_id = ? ${after ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''}
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
      .bind(projectId, ...(after ? [after[0], after[0], after[1]] : []), limit + 1)
      .all<AiRun>();
    return c.json(
      paginate(results, limit, (r) => r.created_at),
      200,
    );
  },
);

export default app;
