import { createContentBlockInput, updateContentBlockInput } from '@croquis/shared';
import { Hono } from 'hono';
import {
  type ContentBlockRow,
  type ContentBlockUpdate,
  deleteContentBlock,
  getContentBlockById,
  insertContentBlock,
  listContentBlocksByPage,
  nextContentPosition,
  toContentBlock,
  updateContentBlock,
} from '../db/content-blocks';
import { getPageById } from '../db/pages';
import type { Env, Variables } from '../env';
import { requireProjectAccess } from '../lib/auth';
import { notFound, validateJson } from '../lib/http';
import { newId } from '../lib/ids';

/** Mounted at /projects/:projectId/pages/:pageId/content-blocks */
export const contentBlocksRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

contentBlocksRoute.use('*', requireProjectAccess);
contentBlocksRoute.use('*', async (c, next) => {
  const pageId = c.req.param('pageId');
  const page = pageId ? await getPageById(c.env.DB, c.get('project').id, pageId) : null;
  if (!page) notFound('Page not found');
  c.set('page', page);
  await next();
});

contentBlocksRoute.get('/', async (c) => {
  const rows = await listContentBlocksByPage(c.env.DB, c.get('page').id);
  return c.json({ content_blocks: rows.map(toContentBlock) });
});

contentBlocksRoute.post('/', validateJson(createContentBlockInput), async (c) => {
  const input = c.req.valid('json');
  const page = c.get('page');
  const now = Date.now();
  const position = input.position ?? (await nextContentPosition(c.env.DB, page.id));
  const row: ContentBlockRow = {
    id: newId(),
    page_id: page.id,
    type: input.type,
    position,
    content: input.content,
    ai_generated: input.ai_generated ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
  await insertContentBlock(c.env.DB, row);
  return c.json(toContentBlock(row), 201);
});

contentBlocksRoute.get('/:blockId', async (c) => {
  const row = await getContentBlockById(c.env.DB, c.get('page').id, c.req.param('blockId'));
  if (!row) notFound('Content block not found');
  return c.json(toContentBlock(row));
});

contentBlocksRoute.patch('/:blockId', validateJson(updateContentBlockInput), async (c) => {
  const input = c.req.valid('json');
  const page = c.get('page');
  const blockId = c.req.param('blockId');
  const existing = await getContentBlockById(c.env.DB, page.id, blockId);
  if (!existing) notFound('Content block not found');
  const update: ContentBlockUpdate = { ...input, updated_at: Date.now() };
  await updateContentBlock(c.env.DB, page.id, blockId, update);
  const fresh = await getContentBlockById(c.env.DB, page.id, blockId);
  return c.json(toContentBlock(fresh ?? existing));
});

contentBlocksRoute.delete('/:blockId', async (c) => {
  const page = c.get('page');
  const existing = await getContentBlockById(c.env.DB, page.id, c.req.param('blockId'));
  if (!existing) notFound('Content block not found');
  await deleteContentBlock(c.env.DB, page.id, c.req.param('blockId'));
  return c.json({ ok: true });
});
