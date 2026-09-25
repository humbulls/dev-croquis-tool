import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { APIError as AuthApiError } from 'better-auth';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { getAuth } from './auth';
import { VERSION } from './config';
import type { AppEnv } from './env';
import { ApiError, problem, validationError } from './http/problem';
import { rateLimit } from './http/rate-limit';
import ai from './routes/ai';
import comments from './routes/comments';
import pages from './routes/pages';
import platform from './routes/platform';
import projects from './routes/projects';
import publicRoutes from './routes/public';
import workspaces from './routes/workspaces';
import { csrfGuard, resolvePrincipal, trustedOrigin } from './security/principal';
import { handleMcp } from './services/mcp-remote';

const app = new OpenAPIHono<AppEnv>();

const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.header('cf-ray') ?? crypto.randomUUID();
  c.set('requestId', id);
  await next();
  c.header('X-Request-Id', id);
};

const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
};

/**
 * Two CORS policies:
 * - `/api/v1/public/*` (widget, share viewer): any origin, no credentials —
 *   access is controlled by keys, origins lists and share tokens.
 * - everything else: credentials only for trusted origins (PUBLIC_URL,
 *   DASHBOARD_ORIGIN); other origins may still call with an API key.
 */
const cors: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('Origin');
  const isPublic = c.req.path.startsWith('/api/v1/public/');
  const credentialed = !isPublic && origin !== undefined && trustedOrigin(c.env, origin);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': credentialed ? (origin as string) : '*',
    'Access-Control-Expose-Headers': 'X-Request-Id, Retry-After',
  };
  if (credentialed) {
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers.Vary = 'Origin';
  }
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          'Authorization, Content-Type, X-Croquis-Ingest-Key, X-Croquis-Client, X-Croquis-Share-Token',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  await next();
  for (const [name, value] of Object.entries(headers)) c.res.headers.set(name, value);
};

app.use('*', requestId, securityHeaders);
app.use('/api/*', cors);

// --- Better Auth -------------------------------------------------------------------

app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
  if (c.req.method === 'POST' && /\/(sign-in|sign-up|request-password-reset)/.test(c.req.path)) {
    await rateLimit(c, 'auth');
  }
  return getAuth(c.env, new URL(c.req.url).origin).handler(c.req.raw);
});

// --- API v1 ------------------------------------------------------------------------

app.use('/api/v1/*', async (c, next) => {
  if (c.req.path.startsWith('/api/v1/public/')) return next();
  await resolvePrincipal(c, async () => {
    await csrfGuard(c, next);
  });
});

app.get('/api/health', (c) => c.json({ ok: true, version: VERSION }));

// --- Remote MCP ----------------------------------------------------------------------

app.on(['GET', 'POST', 'DELETE'], '/mcp', (c) =>
  handleMcp(c, (request) => Promise.resolve(app.fetch(request, c.env, c.executionCtx))),
);

app.route('/api/v1', workspaces);
app.route('/api/v1', projects);
app.route('/api/v1', pages);
app.route('/api/v1', comments);
app.route('/api/v1', platform);
app.route('/api/v1', ai);
app.route('/api/v1', publicRoutes);

app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'An API key (`crq_…`) created in workspace settings, or the instance ADMIN_TOKEN.',
});
app.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'better-auth.session_token',
  description:
    'Dashboard session (sign in through /api/auth). Prefixed with `__Secure-` over HTTPS.',
});

app.doc31('/api/v1/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Croquis API',
    version: VERSION,
    description:
      'Sitemap → content → review, in one place. Every dashboard action is available here and through the MCP server. Errors use RFC 9457 problem details; lists use cursor pagination.',
    license: { name: 'AGPL-3.0-or-later', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Setup' },
    { name: 'Account' },
    { name: 'Workspaces' },
    { name: 'Members' },
    { name: 'API keys' },
    { name: 'Projects' },
    { name: 'Origins' },
    { name: 'Share links' },
    { name: 'Labels' },
    { name: 'Activity' },
    { name: 'Pages' },
    { name: 'Content' },
    { name: 'Review' },
    { name: 'Comments' },
    { name: 'Export' },
    { name: 'Webhooks' },
    { name: 'Integrations' },
    { name: 'AI' },
    { name: 'Widget' },
    { name: 'Share viewer' },
  ],
});

app.get('/api/docs', Scalar({ url: '/api/v1/openapi.json', pageTitle: 'Croquis API reference' }));

// --- Errors ----------------------------------------------------------------------------

app.notFound((c) =>
  problem(
    c,
    new ApiError(404, 'route_not_found', 'Not found', `No route for ${c.req.method} ${c.req.path}`),
  ),
);

app.onError((err, c) => {
  if (err instanceof ApiError) return problem(c, err);
  if (err instanceof ZodError) return problem(c, validationError(err));
  if (err instanceof AuthApiError) {
    const code = (typeof err.body?.code === 'string' ? err.body.code : 'auth_error').toLowerCase();
    return problem(
      c,
      new ApiError(
        err.statusCode as ApiError['status'],
        code,
        'Authentication error',
        err.body?.message,
      ),
    );
  }
  if (err instanceof HTTPException) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 500;
    return problem(
      c,
      new ApiError(status as ApiError['status'], 'http_error', err.message || 'Error'),
    );
  }
  console.error(
    JSON.stringify({
      level: 'error',
      request_id: c.get('requestId'),
      message: String(err),
      stack: (err as Error).stack,
    }),
  );
  return problem(
    c,
    new ApiError(
      500,
      'internal_error',
      'Internal server error',
      'Something went wrong on our side',
    ),
  );
});

export default app;
