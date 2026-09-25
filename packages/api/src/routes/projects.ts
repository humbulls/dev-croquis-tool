import { createProjectInput, updateProjectInput } from '@croquis/shared';
import { Hono } from 'hono';
import {
  deleteProjectCascade,
  getProjectById,
  insertProject,
  listProjects,
  type ProjectRow,
  type ProjectUpdate,
  toOwnerProject,
  updateProject,
} from '../db/projects';
import type { Env, Variables } from '../env';
import { requireAdmin, requireProjectAccess } from '../lib/auth';
import { hashPassword, sha256Hex } from '../lib/crypto';
import { buildProjectExport } from '../lib/export';
import { validateJson } from '../lib/http';
import { newApiToken, newId, newIngestKey, newShareSlug, slugify } from '../lib/ids';
import { deleteProjectScreenshots } from '../lib/screenshots';

export const projectsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Create a project (admin). Returns the secret API token exactly once. */
projectsRoute.post('/', requireAdmin, validateJson(createProjectInput), async (c) => {
  const input = c.req.valid('json');
  const now = Date.now();
  const apiToken = newApiToken();
  const row: ProjectRow = {
    id: newId(),
    name: input.name,
    slug: slugify(input.name),
    api_token_hash: await sha256Hex(apiToken),
    ingest_key: newIngestKey(),
    share_slug: newShareSlug(),
    share_password_hash: input.share_password ? await hashPassword(input.share_password) : null,
    created_at: now,
    updated_at: now,
  };
  await insertProject(c.env.DB, row);
  return c.json({ ...toOwnerProject(row), api_token: apiToken }, 201);
});

/** List all projects (admin). */
projectsRoute.get('/', requireAdmin, async (c) => {
  const rows = await listProjects(c.env.DB);
  return c.json({ projects: rows.map(toOwnerProject) });
});

/** Get one project (owner/admin). */
projectsRoute.get('/:projectId', requireProjectAccess, (c) => {
  return c.json(toOwnerProject(c.get('project')));
});

/** Update a project (owner/admin). */
projectsRoute.patch(
  '/:projectId',
  requireProjectAccess,
  validateJson(updateProjectInput),
  async (c) => {
    const input = c.req.valid('json');
    const project = c.get('project');
    const update: ProjectUpdate = { updated_at: Date.now() };
    if (input.name !== undefined) update.name = input.name;
    if ('share_password' in input) {
      update.share_password_hash = input.share_password
        ? await hashPassword(input.share_password)
        : null;
    }
    await updateProject(c.env.DB, project.id, update);
    const fresh = await getProjectById(c.env.DB, project.id);
    return c.json(toOwnerProject(fresh ?? project));
  },
);

/** Delete a project and all its data, including stored screenshots (owner/admin). */
projectsRoute.delete('/:projectId', requireProjectAccess, async (c) => {
  const projectId = c.get('project').id;
  await deleteProjectScreenshots(c.env.BUCKET, projectId);
  await deleteProjectCascade(c.env.DB, projectId);
  return c.json({ ok: true });
});

/** Full AI/JSON export for a project (owner/admin). */
projectsRoute.get('/:projectId/export', requireProjectAccess, async (c) => {
  const data = await buildProjectExport(c.env.DB, c.get('project'));
  return c.json(data);
});
