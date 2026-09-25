import { Hono } from 'hono';
import { getCommentById } from '../db/comments';
import { getProjectByShareSlug } from '../db/projects';
import type { Env, Variables } from '../env';
import { verifyPassword } from '../lib/crypto';
import { buildProjectExport } from '../lib/export';
import { notFound, unauthorized } from '../lib/http';
import { getScreenshot } from '../lib/screenshots';

/**
 * Mounted at /share/:shareSlug — public, read-only client review view.
 * Optionally password-protected. Exposes no keys (public project projection).
 */
export const shareRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

shareRoute.use('*', async (c, next) => {
  const shareSlug = c.req.param('shareSlug');
  const project = shareSlug ? await getProjectByShareSlug(c.env.DB, shareSlug) : null;
  if (!project) notFound('Share link not found');
  if (project.share_password_hash) {
    const password = c.req.header('X-Croquis-Share-Password');
    if (!password || !(await verifyPassword(password, project.share_password_hash))) {
      unauthorized('Share password required');
    }
  }
  c.set('project', project);
  c.set('scope', 'project');
  await next();
});

shareRoute.get('/', async (c) => {
  const data = await buildProjectExport(c.env.DB, c.get('project'));
  return c.json(data);
});

shareRoute.get('/comments/:commentId/screenshot', async (c) => {
  const project = c.get('project');
  const comment = await getCommentById(c.env.DB, project.id, c.req.param('commentId'));
  if (!comment?.screenshot_key) notFound('Screenshot not found');
  const object = await getScreenshot(c.env.BUCKET, comment.screenshot_key);
  if (!object) notFound('Screenshot object missing');
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'image/png',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
