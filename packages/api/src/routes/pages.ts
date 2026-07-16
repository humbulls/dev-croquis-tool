import { Hono } from 'hono';
import { createPageInput, updatePageInput } from '@croquis/shared';
import type { Env, Variables } from '../env';
import { requireProjectAccess } from '../lib/auth';
import { badRequest, notFound, validateJson } from '../lib/http';
import { newId } from '../lib/ids';
import {
  deletePageCascade,
  getPageById,
  insertPage,
  listPagesByProject,
  nextSortIndex,
  type PageRow,
  type PageUpdate,
  toPage,
  updatePage,
} from '../db/pages';

/** Mounted at /projects/:projectId/pages */
export const pagesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

pagesRoute.use('*', requireProjectAccess);

pagesRoute.get('/', async (c) => {
  const rows = await listPagesByProject(c.env.DB, c.get('project').id);
  return c.json({ pages: rows.map(toPage) });
});

pagesRoute.post('/', validateJson(createPageInput), async (c) => {
  const input = c.req.valid('json');
  const project = c.get('project');
  const parentId = input.parent_id ?? null;
  if (parentId) {
    const parent = await getPageById(c.env.DB, project.id, parentId);
    if (!parent) badRequest('parent_id does not exist in this project');
  }
  const now = Date.now();
  const sortIndex = input.sort_index ?? (await nextSortIndex(c.env.DB, project.id, parentId));
  const row: PageRow = {
    id: newId(),
    project_id: project.id,
    parent_id: parentId,
    path: input.path,
    title: input.title,
    purpose: input.purpose,
    audience: input.audience,
    status: input.status,
    sort_index: sortIndex,
    created_at: now,
    updated_at: now,
  };
  await insertPage(c.env.DB, row);
  return c.json(toPage(row), 201);
});

pagesRoute.get('/:pageId', async (c) => {
  const page = await getPageById(c.env.DB, c.get('project').id, c.req.param('pageId'));
  if (!page) notFound('Page not found');
  return c.json(toPage(page));
});

pagesRoute.patch('/:pageId', validateJson(updatePageInput), async (c) => {
  const input = c.req.valid('json');
  const project = c.get('project');
  const pageId = c.req.param('pageId');
  const existing = await getPageById(c.env.DB, project.id, pageId);
  if (!existing) notFound('Page not found');

  if ('parent_id' in input && input.parent_id) {
    if (input.parent_id === pageId) badRequest('a page cannot be its own parent');
    const all = await listPagesByProject(c.env.DB, project.id);
    const byId = new Map(all.map((p) => [p.id, p]));
    const parent = byId.get(input.parent_id);
    if (!parent) badRequest('parent_id does not exist in this project');

    // Reject cycles: walking up from the new parent must never reach pageId
    // (that would mean re-parenting under one's own descendant).
    let cursor: string | null = parent.id;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === pageId) badRequest('parent_id would create a cycle');
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = byId.get(cursor)?.parent_id ?? null;
    }
  }

  const update: PageUpdate = { ...input, updated_at: Date.now() };
  // When moving to a different parent without an explicit sort_index,
  // append to the end of the new sibling list to avoid order collisions.
  if (
    'parent_id' in input &&
    input.parent_id !== existing.parent_id &&
    input.sort_index === undefined
  ) {
    update.sort_index = await nextSortIndex(c.env.DB, project.id, input.parent_id ?? null);
  }
  await updatePage(c.env.DB, project.id, pageId, update);
  const fresh = await getPageById(c.env.DB, project.id, pageId);
  return c.json(toPage(fresh ?? existing));
});

pagesRoute.delete('/:pageId', async (c) => {
  const project = c.get('project');
  const existing = await getPageById(c.env.DB, project.id, c.req.param('pageId'));
  if (!existing) notFound('Page not found');
  await deletePageCascade(c.env.DB, project.id, existing);
  return c.json({ ok: true });
});
