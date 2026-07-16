import { Hono } from 'hono';
import { z } from 'zod';
import { uuid } from '@croquis/shared';
import type { Env, Variables } from '../env';
import { requireProjectAccess } from '../lib/auth';
import { badRequest, validateJson } from '../lib/http';
import { newId } from '../lib/ids';
import { aiComplete, extractJson } from '../lib/ai';
import { aiContentPlanSchema, aiSitemapPlanSchema, orderSitemapPlan } from '../lib/ai-plans';
import {
  getPageById,
  insertPage,
  listPagesByProject,
  nextSortIndex,
  type PageRow,
  toPage,
} from '../db/pages';
import {
  type ContentBlockRow,
  insertContentBlock,
  listContentBlocksByPage,
  nextContentPosition,
  toContentBlock,
} from '../db/content-blocks';
import { listCommentsByProject } from '../db/comments';
import { listRepliesByProject } from '../db/replies';

/** Mounted at /projects/:projectId/ai — AI generation (provider-pluggable). */
export const aiRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

aiRoute.use('*', requireProjectAccess);

const JSON_ONLY = 'Respond with ONLY valid JSON. No prose before or after.';

const sitemapInput = z.object({
  brief: z.string().trim().min(1).max(4000),
});

/** Generate a sitemap draft from a brief and insert the pages. */
aiRoute.post('/sitemap', validateJson(sitemapInput), async (c) => {
  const { brief } = c.req.valid('json');
  const project = c.get('project');

  const text = await aiComplete(c.env, {
    system: `You are a senior web information architect. ${JSON_ONLY}`,
    user: `Design a sitemap for the website described below. Return a JSON array of pages:
[{"path": "/", "title": "…", "purpose": "…", "audience": "…", "parent_path": null}]
Rules:
- paths start with "/" and are unique
- parent_path references another page's path in the same array (null = top level)
- 5-15 pages unless the brief clearly demands otherwise
- write title/purpose/audience in the same language as the brief

Website brief:
${brief}`,
  });

  const parsed = aiSitemapPlanSchema.safeParse(extractJson(text));
  if (!parsed.success) badRequest('AI returned an invalid sitemap plan — please retry');
  const ordered = orderSitemapPlan(parsed.data);

  const existing = await listPagesByProject(c.env.DB, project.id);
  const idByPath = new Map(existing.map((p) => [p.path, p.id]));
  const created: PageRow[] = [];

  for (const entry of ordered) {
    if (idByPath.has(entry.path)) continue;
    const parentId = entry.parent_path ? (idByPath.get(entry.parent_path) ?? null) : null;
    const now = Date.now();
    const row: PageRow = {
      id: newId(),
      project_id: project.id,
      parent_id: parentId,
      path: entry.path,
      title: entry.title,
      purpose: entry.purpose,
      audience: entry.audience,
      status: 'todo',
      sort_index: await nextSortIndex(c.env.DB, project.id, parentId),
      created_at: now,
      updated_at: now,
    };
    await insertPage(c.env.DB, row);
    idByPath.set(row.path, row.id);
    created.push(row);
  }

  return c.json(
    { created: created.map(toPage), skipped_existing: ordered.length - created.length },
    201,
  );
});

const contentInput = z.object({
  page_id: uuid,
  brief: z.string().trim().max(4000).optional(),
});

/** Generate draft content blocks for a page (marked ai_generated). */
aiRoute.post('/content', validateJson(contentInput), async (c) => {
  const { page_id, brief } = c.req.valid('json');
  const project = c.get('project');
  const page = await getPageById(c.env.DB, project.id, page_id);
  if (!page) badRequest('page_id does not exist in this project');

  const existingBlocks = await listContentBlocksByPage(c.env.DB, page.id);
  const existingNote =
    existingBlocks.length > 0
      ? `Existing blocks (do not repeat): ${existingBlocks
          .map((b) => `${b.type}: ${b.content.slice(0, 80)}`)
          .join(' | ')}`
      : '';

  const text = await aiComplete(c.env, {
    system: `You are a senior web copywriter. ${JSON_ONLY}`,
    user: `Draft the content blocks for one web page. Return a JSON array:
[{"type": "heading" | "body" | "cta" | "image", "content": "…"}]
Rules:
- 3-8 blocks, concrete copy (never lorem ipsum)
- "image" content is a short art-direction note
- write in the same language as the page metadata / brief

Project: ${project.name}
Page path: ${page.path}
Title: ${page.title || '(none)'}
Purpose: ${page.purpose || '(none)'}
Audience: ${page.audience || '(none)'}
${brief ? `Extra brief: ${brief}` : ''}
${existingNote}`,
  });

  const parsed = aiContentPlanSchema.safeParse(extractJson(text));
  if (!parsed.success) badRequest('AI returned invalid content blocks — please retry');

  let position = await nextContentPosition(c.env.DB, page.id);
  const created: ContentBlockRow[] = [];
  for (const block of parsed.data) {
    const now = Date.now();
    const row: ContentBlockRow = {
      id: newId(),
      page_id: page.id,
      type: block.type,
      position: position++,
      content: block.content,
      ai_generated: 1,
      created_at: now,
      updated_at: now,
    };
    await insertContentBlock(c.env.DB, row);
    created.push(row);
  }

  return c.json({ created: created.map(toContentBlock) }, 201);
});

/** Summarize open review comments into a prioritized Markdown digest. */
aiRoute.get('/digest', async (c) => {
  const project = c.get('project');
  const comments = await listCommentsByProject(c.env.DB, project.id, { status: 'open' });
  if (comments.length === 0) {
    return c.json({ digest: 'No open comments.', open_count: 0 });
  }
  const replies = await listRepliesByProject(c.env.DB, project.id);
  const repliesByComment = new Map<string, string[]>();
  for (const reply of replies) {
    const bucket = repliesByComment.get(reply.comment_id) ?? [];
    bucket.push(`${reply.author_name ?? 'reply'}: ${reply.body}`);
    repliesByComment.set(reply.comment_id, bucket);
  }

  const lines = comments.map((comment) => {
    const target = comment.element_selector ?? 'page';
    const context = comment.element_context ? ` / ${comment.element_context}` : '';
    const thread = repliesByComment.get(comment.id)?.join(' · ') ?? '';
    return `- ${comment.body} (target: ${target}${context}, url: ${comment.page_url})${
      thread ? ` [replies: ${thread}]` : ''
    }`;
  });

  const digest = await aiComplete(c.env, {
    system:
      'You are a meticulous project manager for web production. Respond in Markdown, keeping the original language of the comments.',
    user: `Summarize these open review comments into a prioritized action digest. Group related items, keep target selectors visible, and suggest an order of execution:\n\n${lines.join('\n')}`,
    maxTokens: 2000,
  });

  return c.json({ digest, open_count: comments.length });
});
