import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createCommentInput } from '@croquis/shared';
import type { Env, Variables } from '../env';
import { unauthorized, validateJson } from '../lib/http';
import { getProjectByIngestKey } from '../db/projects';
import { type CommentRow, insertComment } from '../db/comments';
import { getPageById } from '../db/pages';
import { newId } from '../lib/ids';
import { storeScreenshot } from '../lib/screenshots';

/**
 * Mounted at /ingest — the widget's write-only endpoint.
 * Authenticated by the public per-project ingest key (not the secret token).
 */
export const ingestRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

ingestRoute.use('*', async (c, next) => {
  const key = c.req.header('X-Croquis-Ingest-Key');
  if (!key) unauthorized('Missing ingest key');
  const project = await getProjectByIngestKey(c.env.DB, key);
  if (!project) unauthorized('Invalid ingest key');
  c.set('project', project);
  c.set('scope', 'project');
  await next();
});

/** Hard request-size cap: schema limits + headroom (screenshot data URL). */
const INGEST_BODY_LIMIT = 8 * 1024 * 1024;

ingestRoute.post(
  '/comments',
  bodyLimit({
    maxSize: INGEST_BODY_LIMIT,
    onError: (c) => c.json({ error: 'payload too large' }, 413),
  }),
  validateJson(createCommentInput),
  async (c) => {
  const input = c.req.valid('json');
  const project = c.get('project');

  // The widget may pass a page_id hint; accept it only if it belongs here.
  let pageId: string | null = null;
  if (input.page_id) {
    const page = await getPageById(c.env.DB, project.id, input.page_id);
    if (page) pageId = page.id;
  }

  let screenshotKey: string | null = null;
  if (input.screenshot) {
    try {
      const stored = await storeScreenshot(c.env.BUCKET, project.id, input.screenshot);
      screenshotKey = stored?.key ?? null;
    } catch {
      // Oversize/invalid image: keep the comment, drop the screenshot.
      screenshotKey = null;
    }
  }

  const row: CommentRow = {
    id: newId(),
    project_id: project.id,
    page_id: pageId,
    page_url: input.page_url,
    viewport: input.viewport,
    viewport_w: input.viewport_w,
    viewport_h: input.viewport_h,
    body: input.body,
    author_name: input.author_name,
    status: 'open',
    screenshot_key: screenshotKey,
    element_selector: input.element_selector,
    element_tag: input.element_tag,
    element_text: input.element_text,
    element_html: input.element_html,
    element_context: input.element_context,
    element_attrs: input.element_attrs,
    computed_style: input.computed_style,
    rel_x: input.rel_x,
    rel_y: input.rel_y,
    created_at: Date.now(),
  };
  await insertComment(c.env.DB, row);
  return c.json({ id: row.id, screenshot_stored: screenshotKey !== null }, 201);
  },
);
