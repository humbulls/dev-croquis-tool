import {
  type ActivityEvent,
  listQuery,
  normalizeOrigin,
  normalizePath,
  projectListQuery,
} from '@croquis/shared';
import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { PLAN_QUOTAS, runtimeConfig } from '../config';
import {
  getProjectWithStats,
  type LabelRow,
  listLabels,
  listOrigins,
  listShareLinks,
  type OriginRow,
  PROJECT_WITH_STATS_SELECT,
  type ProjectStatsRow,
  type ShareLinkRow,
  toLabel,
  toOrigin,
  toProjectWithStats,
  toShareLink,
  uniqueProjectSlug,
} from '../db/projects';
import type { AppEnv } from '../env';
import { background } from '../http/background';
import { body, createRouter, idParam, json, noContent, problem, route } from '../http/openapi';
import { decodeCursor, paginate } from '../http/pagination';
import {
  conflict,
  notFound,
  orThrow,
  quotaExceeded,
  unauthorized,
  unprocessable,
} from '../http/problem';
import * as S from '../http/schemas';
import { loadScoped, requireProject, requireWorkspace } from '../security/access';
import { hashPassword } from '../security/crypto';
import { actorOf } from '../security/principal';
import { newId, newIngestKey, newShareSlug, slugify } from '../security/tokens';
import { deleteObjects, deleteProjectObjects } from '../services/attachments';
import { UnitOfWork } from '../services/unit-of-work';

const app = createRouter();
const tags = ['Projects'];
const ProjectParams = idParam('projectId', 'Project id');

async function workspaceForNewProject(
  c: Context<AppEnv>,
  requested: string | undefined,
): Promise<string> {
  if (requested) return requested;
  const principal = c.get('principal');
  if (principal.type === 'api_key') return principal.key.workspaceId;
  let candidates: { id: string }[] = [];
  if (principal.type === 'user') {
    ({ results: candidates } = await c.env.DB.prepare(
      `SELECT workspace_id AS id FROM workspace_members WHERE user_id = ? AND role IN ('owner', 'admin')`,
    )
      .bind(principal.user.id)
      .all<{ id: string }>());
  } else if (principal.type === 'admin') {
    ({ results: candidates } = await c.env.DB.prepare('SELECT id FROM workspaces').all<{
      id: string;
    }>());
  } else {
    throw unauthorized();
  }
  if (candidates.length === 1) return (candidates[0] as { id: string }).id;
  throw unprocessable(
    'workspace_required',
    'Pass workspace_id: the caller can create projects in several workspaces, or none',
  );
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/projects',
    tags,
    summary: 'List projects',
    description: 'Every project the caller can see, newest first, with review counters.',
    request: { query: projectListQuery },
    responses: { 200: json(S.paginated(S.ProjectWithStats), 'Projects') },
  }),
  async (c) => {
    const { cursor, limit, workspace_id } = c.req.valid('query');
    const principal = c.get('principal');
    const where: string[] = [];
    const params: unknown[] = [];
    if (principal.type === 'user') {
      where.push(
        'p.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?)',
      );
      params.push(principal.user.id);
    } else if (principal.type === 'api_key') {
      where.push('p.workspace_id = ?');
      params.push(principal.key.workspaceId);
      if (principal.key.projectId) {
        where.push('p.id = ?');
        params.push(principal.key.projectId);
      }
    } else if (principal.type !== 'admin') {
      throw unauthorized();
    }
    if (workspace_id) {
      where.push('p.workspace_id = ?');
      params.push(workspace_id);
    }
    const after = decodeCursor(cursor);
    if (after) {
      where.push('(p.created_at < ? OR (p.created_at = ? AND p.id < ?))');
      params.push(after[0], after[0], after[1]);
    }
    const { results } = await c.env.DB.prepare(
      `${PROJECT_WITH_STATS_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
    )
      .bind(...params, limit + 1)
      .all<ProjectStatsRow>();
    return c.json(
      paginate(results.map(toProjectWithStats), limit, (p) => p.created_at),
      200,
    );
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/projects',
    tags,
    summary: 'Create a project',
    description:
      'A project is one website under review. Creating it issues the public ingest key for the widget snippet. Pass `origin` to allow the widget on that site right away.',
    request: body(S.CreateProjectInput),
    responses: {
      201: json(S.ProjectWithStats, 'Created'),
      402: problem('Plan quota reached (Croquis Cloud)'),
    },
  }),
  async (c) => {
    const input = c.req.valid('json');
    const workspaceId = await workspaceForNewProject(c, input.workspace_id);
    const { workspace } = await requireWorkspace(c, workspaceId, 'project.create');

    if (runtimeConfig(c.env).edition === 'cloud') {
      const count = await c.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM projects WHERE workspace_id = ?',
      )
        .bind(workspaceId)
        .first<{ n: number }>();
      const quota = PLAN_QUOTAS[workspace.plan].projects;
      if ((count?.n ?? 0) >= quota)
        throw quotaExceeded(`The ${workspace.plan} plan allows ${quota} projects`);
    }
    const origin = input.origin ? normalizeOrigin(input.origin) : null;
    if (input.origin && !origin)
      throw unprocessable('invalid_origin', 'origin must be an http(s) URL');

    const now = Date.now();
    const id = newId();
    const slug = await uniqueProjectSlug(c.env.DB, workspaceId, slugify(input.name));
    const uow = new UnitOfWork(c.env).add(
      c.env.DB.prepare(
        `INSERT INTO projects (id, workspace_id, name, slug, description, ingest_key, widget_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        workspaceId,
        input.name,
        slug,
        input.description,
        newIngestKey(),
        input.widget_mode,
        now,
        now,
      ),
    );
    if (origin) {
      uow.add(
        c.env.DB.prepare(
          `INSERT INTO project_origins (id, project_id, origin, base_path, environment, created_at)
           VALUES (?, ?, ?, '/', 'production', ?)`,
        ).bind(newId(), id, origin, now),
      );
    }
    uow.event({
      type: 'project.created',
      workspaceId,
      projectId: id,
      actor: actorOf(c.get('principal')),
      subjectType: 'project',
      subjectId: id,
      data: { name: input.name, slug },
    });
    await uow.commit(c);
    return c.json(orThrow(await getProjectWithStats(c.env.DB, id), notFound('project')), 201);
  },
);

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}',
    tags,
    summary: 'Get a project',
    request: { params: ProjectParams },
    responses: { 200: json(S.ProjectWithStats, 'The project') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    await requireProject(c, projectId, 'project.read');
    return c.json(
      orThrow(await getProjectWithStats(c.env.DB, projectId), notFound('project')),
      200,
    );
  },
);

app.openapi(
  route({
    method: 'patch',
    path: '/projects/{projectId}',
    tags,
    summary: 'Update a project',
    description: 'Only the fields present in the body change.',
    request: { params: ProjectParams, ...body(S.UpdateProjectInput) },
    responses: { 200: json(S.ProjectWithStats, 'Updated') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { row, scope } = await requireProject(c, projectId, 'project.update');
    const changes = Object.fromEntries(
      Object.entries(input).filter(
        ([key, value]) => value !== undefined && row[key as keyof typeof row] !== value,
      ),
    ) as Record<string, string>;
    if (Object.keys(changes).length > 0) {
      const columns = Object.keys(changes);
      const uow = new UnitOfWork(c.env).add(
        c.env.DB.prepare(
          `UPDATE projects SET ${columns.map((col) => `${col} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ).bind(...columns.map((col) => changes[col]), Date.now(), projectId),
      );
      uow.event({
        type: 'project.updated',
        workspaceId: scope.workspaceId,
        projectId,
        actor: actorOf(c.get('principal')),
        subjectType: 'project',
        subjectId: projectId,
        data: { changes },
      });
      await uow.commit(c);
    }
    return c.json(
      orThrow(await getProjectWithStats(c.env.DB, projectId), notFound('project')),
      200,
    );
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/projects/{projectId}',
    tags,
    summary: 'Delete a project',
    description:
      'Permanently deletes the project with its pages, comments, attachments, share links and webhooks.',
    request: { params: ProjectParams },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    await requireProject(c, projectId, 'project.delete');
    const { results: objects } = await c.env.DB.prepare(
      'SELECT r2_key FROM attachments WHERE project_id = ?',
    )
      .bind(projectId)
      .all<{ r2_key: string }>();
    await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run();
    const cleanup = (async () => {
      await deleteObjects(
        c.env.BUCKET,
        objects.map((o) => o.r2_key),
      );
      await deleteProjectObjects(c.env.BUCKET, projectId);
    })();
    await background(c, cleanup);
    return c.body(null, 204);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/ingest-key/rotate',
    tags,
    summary: 'Rotate the ingest key',
    description:
      'Issues a new widget ingest key; the old one stops working immediately. Update the snippet on every site afterwards.',
    request: { params: ProjectParams },
    responses: { 200: json(S.ProjectWithStats, 'Project with the new key') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { scope } = await requireProject(c, projectId, 'project.update');
    const uow = new UnitOfWork(c.env).add(
      c.env.DB.prepare('UPDATE projects SET ingest_key = ?, updated_at = ? WHERE id = ?').bind(
        newIngestKey(),
        Date.now(),
        projectId,
      ),
    );
    uow.event({
      type: 'project.updated',
      workspaceId: scope.workspaceId,
      projectId,
      actor: actorOf(c.get('principal')),
      subjectType: 'project',
      subjectId: projectId,
      data: { changes: { ingest_key: 'rotated' } },
    });
    await uow.commit(c);
    return c.json(
      orThrow(await getProjectWithStats(c.env.DB, projectId), notFound('project')),
      200,
    );
  },
);

// ---------------------------------------------------------------------------
// Origins — where the widget may run, and how URLs map to page paths
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}/origins',
    tags: ['Origins'],
    summary: 'List site origins',
    description:
      'The widget only accepts comments from these origins. With none configured it accepts any origin (not recommended in production).',
    request: { params: ProjectParams },
    responses: { 200: json(S.data(S.ProjectOrigin), 'Origins') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    await requireProject(c, projectId, 'project.read');
    return c.json({ data: await listOrigins(c.env.DB, projectId) }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/origins',
    tags: ['Origins'],
    summary: 'Add a site origin',
    description:
      'Any URL of the site; it is reduced to scheme://host[:port]. `base_path` strips a mount prefix before URLs are matched to pages.',
    request: { params: ProjectParams, ...body(S.CreateOriginInput) },
    responses: { 201: json(S.ProjectOrigin, 'Added'), 409: problem('Origin already registered') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const input = c.req.valid('json');
    await requireProject(c, projectId, 'project.update');
    const origin = normalizeOrigin(input.url);
    if (!origin) throw unprocessable('invalid_origin', 'url must be an http(s) URL');
    const row: OriginRow = {
      id: newId(),
      project_id: projectId,
      origin,
      base_path: normalizePath(input.base_path),
      environment: input.environment,
      created_at: Date.now(),
    };
    const inserted = await c.env.DB.prepare(
      `INSERT INTO project_origins (id, project_id, origin, base_path, environment, created_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (project_id, origin) DO NOTHING`,
    )
      .bind(row.id, row.project_id, row.origin, row.base_path, row.environment, row.created_at)
      .run();
    if (inserted.meta.changes === 0)
      throw conflict('origin_exists', `${origin} is already registered`);
    return c.json(toOrigin(row), 201);
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/origins/{originId}',
    tags: ['Origins'],
    summary: 'Remove a site origin',
    request: { params: idParam('originId', 'Origin id') },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { originId } = c.req.valid('param');
    await loadScoped<OriginRow>(c, {
      from: 'project_origins x JOIN projects p ON p.id = x.project_id',
      id: originId,
      permission: 'project.update',
      resource: 'origin',
    });
    await c.env.DB.prepare('DELETE FROM project_origins WHERE id = ?').bind(originId).run();
    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------------------
// Share links — the client-facing review surface
// ---------------------------------------------------------------------------

const ShareLinkParams = idParam('shareLinkId', 'Share link id');

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}/share-links',
    tags: ['Share links'],
    summary: 'List share links',
    request: { params: ProjectParams },
    responses: { 200: json(S.data(S.ShareLink), 'Share links (active first)') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    await requireProject(c, projectId, 'project.read');
    return c.json({ data: await listShareLinks(c.env.DB, projectId) }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/share-links',
    tags: ['Share links'],
    summary: 'Create a share link',
    description:
      'Gives clients a sign-up-free review link (`/s/{slug}`) to browse the sitemap, comment and approve pages. Optionally password-protected and time-limited.',
    request: { params: ProjectParams, ...body(S.CreateShareLinkInput) },
    responses: { 201: json(S.ShareLink, 'Created') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const input = c.req.valid('json');
    await requireProject(c, projectId, 'share.manage');
    const principal = c.get('principal');
    const row: ShareLinkRow = {
      id: newId(),
      project_id: projectId,
      slug: newShareSlug(),
      label: input.label,
      password_hash: input.password ? await hashPassword(input.password) : null,
      allow_comments: input.allow_comments ? 1 : 0,
      allow_approvals: input.allow_approvals ? 1 : 0,
      expires_at: input.expires_at ?? null,
      revoked_at: null,
      created_by: principal.type === 'user' ? principal.user.id : null,
      last_viewed_at: null,
      created_at: Date.now(),
    };
    await c.env.DB.prepare(
      `INSERT INTO share_links (id, project_id, slug, label, password_hash, allow_comments, allow_approvals,
                                expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        row.id,
        row.project_id,
        row.slug,
        row.label,
        row.password_hash,
        row.allow_comments,
        row.allow_approvals,
        row.expires_at,
        row.created_by,
        row.created_at,
      )
      .run();
    return c.json(toShareLink(row), 201);
  },
);

app.openapi(
  route({
    method: 'patch',
    path: '/share-links/{shareLinkId}',
    tags: ['Share links'],
    summary: 'Update a share link',
    description:
      '`password: null` removes the password; `revoked: true` disables the link immediately.',
    request: { params: ShareLinkParams, ...body(S.UpdateShareLinkInput) },
    responses: { 200: json(S.ShareLink, 'Updated') },
  }),
  async (c) => {
    const { shareLinkId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { row } = await loadScoped<ShareLinkRow>(c, {
      from: 'share_links x JOIN projects p ON p.id = x.project_id',
      id: shareLinkId,
      permission: 'share.manage',
      resource: 'share_link',
    });
    const next: ShareLinkRow = {
      ...row,
      label: input.label ?? row.label,
      allow_comments:
        input.allow_comments === undefined ? row.allow_comments : input.allow_comments ? 1 : 0,
      allow_approvals:
        input.allow_approvals === undefined ? row.allow_approvals : input.allow_approvals ? 1 : 0,
      expires_at: input.expires_at === undefined ? row.expires_at : input.expires_at,
      revoked_at:
        input.revoked === undefined
          ? row.revoked_at
          : input.revoked
            ? (row.revoked_at ?? Date.now())
            : null,
      password_hash:
        input.password === undefined
          ? row.password_hash
          : input.password === null
            ? null
            : await hashPassword(input.password),
    };
    await c.env.DB.prepare(
      `UPDATE share_links SET label = ?, allow_comments = ?, allow_approvals = ?, expires_at = ?, revoked_at = ?,
              password_hash = ? WHERE id = ?`,
    )
      .bind(
        next.label,
        next.allow_comments,
        next.allow_approvals,
        next.expires_at,
        next.revoked_at,
        next.password_hash,
        shareLinkId,
      )
      .run();
    return c.json(toShareLink(next), 200);
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/share-links/{shareLinkId}',
    tags: ['Share links'],
    summary: 'Delete a share link',
    description: 'Comments made through the link are kept.',
    request: { params: ShareLinkParams },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { shareLinkId } = c.req.valid('param');
    await loadScoped<ShareLinkRow>(c, {
      from: 'share_links x JOIN projects p ON p.id = x.project_id',
      id: shareLinkId,
      permission: 'share.manage',
      resource: 'share_link',
    });
    await c.env.DB.prepare('DELETE FROM share_links WHERE id = ?').bind(shareLinkId).run();
    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const LabelParams = idParam('labelId', 'Label id');

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}/labels',
    tags: ['Labels'],
    summary: 'List labels',
    request: { params: ProjectParams },
    responses: { 200: json(S.data(S.Label), 'Labels (alphabetical)') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    await requireProject(c, projectId, 'project.read');
    return c.json({ data: await listLabels(c.env.DB, projectId) }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/labels',
    tags: ['Labels'],
    summary: 'Create a label',
    request: { params: ProjectParams, ...body(S.CreateLabelInput) },
    responses: { 201: json(S.Label, 'Created'), 409: problem('A label with this name exists') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const input = c.req.valid('json');
    await requireProject(c, projectId, 'share.manage');
    const row: LabelRow = {
      id: newId(),
      project_id: projectId,
      name: input.name,
      color: input.color,
      created_at: Date.now(),
    };
    const inserted = await c.env.DB.prepare(
      `INSERT INTO labels (id, project_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (project_id, name) DO NOTHING`,
    )
      .bind(row.id, row.project_id, row.name, row.color, row.created_at)
      .run();
    if (inserted.meta.changes === 0)
      throw conflict('label_exists', `A label named "${input.name}" already exists`);
    return c.json(toLabel(row), 201);
  },
);

app.openapi(
  route({
    method: 'patch',
    path: '/labels/{labelId}',
    tags: ['Labels'],
    summary: 'Update a label',
    request: { params: LabelParams, ...body(S.UpdateLabelInput) },
    responses: { 200: json(S.Label, 'Updated'), 409: problem('A label with this name exists') },
  }),
  async (c) => {
    const { labelId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { row } = await loadScoped<LabelRow>(c, {
      from: 'labels x JOIN projects p ON p.id = x.project_id',
      id: labelId,
      permission: 'share.manage',
      resource: 'label',
    });
    const next = { ...row, name: input.name ?? row.name, color: input.color ?? row.color };
    try {
      await c.env.DB.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?')
        .bind(next.name, next.color, labelId)
        .run();
    } catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) {
        throw conflict('label_exists', `A label named "${next.name}" already exists`);
      }
      throw err;
    }
    return c.json(toLabel(next), 200);
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/labels/{labelId}',
    tags: ['Labels'],
    summary: 'Delete a label',
    description: 'Removes it from every comment.',
    request: { params: LabelParams },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { labelId } = c.req.valid('param');
    await loadScoped<LabelRow>(c, {
      from: 'labels x JOIN projects p ON p.id = x.project_id',
      id: labelId,
      permission: 'share.manage',
      resource: 'label',
    });
    await c.env.DB.prepare('DELETE FROM labels WHERE id = ?').bind(labelId).run();
    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

interface EventRow {
  id: string;
  type: ActivityEvent['type'];
  project_id: string | null;
  actor_type: ActivityEvent['actor']['type'];
  actor_id: string | null;
  actor_name: string | null;
  subject_type: string;
  subject_id: string;
  data: string;
  created_at: number;
}

export function toActivityEvent(row: EventRow): ActivityEvent {
  return {
    id: row.id,
    type: row.type,
    project_id: row.project_id,
    actor: { type: row.actor_type, id: row.actor_id, name: row.actor_name },
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    data: JSON.parse(row.data) as Record<string, unknown>,
    created_at: row.created_at,
  };
}

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}/activity',
    tags: ['Activity'],
    summary: 'Activity log',
    description:
      'Every change in the project, newest first. The same events are delivered to webhooks.',
    request: {
      params: ProjectParams,
      query: listQuery.extend({
        subject_id: z
          .string()
          .max(64)
          .optional()
          .openapi({ description: 'Only events about this resource' }),
      }),
    },
    responses: { 200: json(S.paginated(S.ActivityEvent), 'Events') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const { cursor, limit, subject_id } = c.req.valid('query');
    await requireProject(c, projectId, 'project.read');
    const after = decodeCursor(cursor);
    const where = ['project_id = ?'];
    const params: unknown[] = [projectId];
    if (subject_id) {
      where.push('subject_id = ?');
      params.push(subject_id);
    }
    if (after) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(after[0], after[0], after[1]);
    }
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM activity_events WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
      .bind(...params, limit + 1)
      .all<EventRow>();
    return c.json(
      paginate(results.map(toActivityEvent), limit, (e) => e.created_at),
      200,
    );
  },
);

export default app;
