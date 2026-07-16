import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from './env';
import { projectsRoute } from './routes/projects';
import { pagesRoute } from './routes/pages';
import { contentBlocksRoute } from './routes/content-blocks';
import { commentsRoute } from './routes/comments';
import { ingestRoute } from './routes/ingest';
import { shareRoute } from './routes/share';
import { aiRoute } from './routes/ai';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * CORS is split by route family:
 * - /ingest and /share are PUBLIC surfaces (widget on arbitrary client sites,
 *   password-gated share views) — always `*`; auth is header/key based.
 * - /projects (admin/project routes) can be locked to DASHBOARD_ORIGIN.
 */
const publicCors = cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'X-Croquis-Ingest-Key', 'X-Croquis-Share-Password'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  maxAge: 86400,
});
app.use('/ingest/*', publicCors);
app.use('/share/*', publicCors);

app.use('/projects/*', (c, next) => {
  const handler = cors({
    origin: (origin) => {
      const configured = c.env.DASHBOARD_ORIGIN;
      if (configured && configured !== '*') {
        return configured === origin ? origin : null;
      }
      return origin ?? '*';
    },
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  });
  return handler(c, next);
});

app.get('/', (c) => c.json({ name: 'croquis-api', status: 'ok' }));
app.get('/health', (c) => c.json({ ok: true }));

app.route('/projects', projectsRoute);
app.route('/projects/:projectId/pages', pagesRoute);
app.route('/projects/:projectId/pages/:pageId/content-blocks', contentBlocksRoute);
app.route('/projects/:projectId/comments', commentsRoute);
app.route('/projects/:projectId/ai', aiRoute);
app.route('/ingest', ingestRoute);
app.route('/share/:shareSlug', shareRoute);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
