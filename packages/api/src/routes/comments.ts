import { Hono } from 'hono';
import {
  COMMENT_STATUSES,
  type CommentStatus,
  createCommentReplyInput,
  updateCommentInput,
} from '@croquis/shared';
import type { Env, Variables } from '../env';
import { requireProjectAccess } from '../lib/auth';
import { badRequest, notFound, validateJson } from '../lib/http';
import { newId } from '../lib/ids';
import { getPageById } from '../db/pages';
import {
  deleteCommentCascade,
  getCommentById,
  listCommentsByProject,
  toComment,
  updateComment,
} from '../db/comments';
import { insertReply, listRepliesByComment, type ReplyRow, toReply } from '../db/replies';
import { deleteScreenshot, getScreenshot } from '../lib/screenshots';

/** Mounted at /projects/:projectId/comments */
export const commentsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

commentsRoute.use('*', requireProjectAccess);

commentsRoute.get('/', async (c) => {
  const statusParam = c.req.query('status');
  if (statusParam && !(COMMENT_STATUSES as readonly string[]).includes(statusParam)) {
    badRequest(`invalid status: expected one of ${COMMENT_STATUSES.join(', ')}`);
  }
  const status = statusParam as CommentStatus | undefined;
  const pageId = c.req.query('page_id') || undefined;
  const rows = await listCommentsByProject(c.env.DB, c.get('project').id, { status, pageId });
  return c.json({ comments: rows.map(toComment) });
});

commentsRoute.get('/:commentId', async (c) => {
  const project = c.get('project');
  const row = await getCommentById(c.env.DB, project.id, c.req.param('commentId'));
  if (!row) notFound('Comment not found');
  const replies = await listRepliesByComment(c.env.DB, row.id);
  return c.json({ ...toComment(row), replies: replies.map(toReply) });
});

commentsRoute.patch('/:commentId', validateJson(updateCommentInput), async (c) => {
  const input = c.req.valid('json');
  const project = c.get('project');
  const commentId = c.req.param('commentId');
  const existing = await getCommentById(c.env.DB, project.id, commentId);
  if (!existing) notFound('Comment not found');

  if ('page_id' in input && input.page_id) {
    const page = await getPageById(c.env.DB, project.id, input.page_id);
    if (!page) badRequest('page_id does not exist in this project');
  }

  await updateComment(c.env.DB, project.id, commentId, input);
  const fresh = await getCommentById(c.env.DB, project.id, commentId);
  const replies = await listRepliesByComment(c.env.DB, commentId);
  return c.json({ ...toComment(fresh ?? existing), replies: replies.map(toReply) });
});

commentsRoute.delete('/:commentId', async (c) => {
  const project = c.get('project');
  const existing = await getCommentById(c.env.DB, project.id, c.req.param('commentId'));
  if (!existing) notFound('Comment not found');
  await deleteScreenshot(c.env.BUCKET, existing.screenshot_key);
  await deleteCommentCascade(c.env.DB, project.id, c.req.param('commentId'));
  return c.json({ ok: true });
});

commentsRoute.get('/:commentId/replies', async (c) => {
  const project = c.get('project');
  const comment = await getCommentById(c.env.DB, project.id, c.req.param('commentId'));
  if (!comment) notFound('Comment not found');
  const replies = await listRepliesByComment(c.env.DB, comment.id);
  return c.json({ replies: replies.map(toReply) });
});

commentsRoute.post('/:commentId/replies', validateJson(createCommentReplyInput), async (c) => {
  const input = c.req.valid('json');
  const project = c.get('project');
  const comment = await getCommentById(c.env.DB, project.id, c.req.param('commentId'));
  if (!comment) notFound('Comment not found');
  const row: ReplyRow = {
    id: newId(),
    comment_id: comment.id,
    author_name: input.author_name,
    body: input.body,
    created_at: Date.now(),
  };
  await insertReply(c.env.DB, row);
  return c.json(toReply(row), 201);
});

commentsRoute.get('/:commentId/screenshot', async (c) => {
  const project = c.get('project');
  const comment = await getCommentById(c.env.DB, project.id, c.req.param('commentId'));
  if (!comment) notFound('Comment not found');
  if (!comment.screenshot_key) notFound('No screenshot for this comment');
  const object = await getScreenshot(c.env.BUCKET, comment.screenshot_key);
  if (!object) notFound('Screenshot object missing');
  const contentType = object.httpMetadata?.contentType ?? 'image/png';
  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
