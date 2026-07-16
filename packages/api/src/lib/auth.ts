import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../env';
import { getProjectById } from '../db/projects';
import { secretsEqual, verifyTokenHash } from './crypto';
import { notFound, unauthorized } from './http';

type AppBindings = { Bindings: Env; Variables: Variables };

function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? null;
}

/** Length-safe admin comparison (both sides digested before comparing). */
async function isAdminToken(env: Env, token: string): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  return secretsEqual(token, env.ADMIN_TOKEN);
}

/** Require the operator/admin token. */
export const requireAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
  const token = bearerToken(c.req.header('Authorization'));
  if (!token || !(await isAdminToken(c.env, token))) unauthorized();
  c.set('scope', 'admin');
  await next();
};

/**
 * Require access to the project in the `:projectId` path param: either the
 * admin token or that project's own API token. Sets `project` and `scope`.
 *
 * Non-admin callers receive 401 (not 404) for unknown project ids, so the
 * endpoint does not reveal which project ids exist.
 */
export const requireProjectAccess: MiddlewareHandler<AppBindings> = async (c, next) => {
  const projectId = c.req.param('projectId');
  const token = bearerToken(c.req.header('Authorization'));
  if (!token) unauthorized();

  const admin = await isAdminToken(c.env, token);
  const project = projectId ? await getProjectById(c.env.DB, projectId) : null;

  if (!project) {
    if (admin) notFound('Project not found');
    unauthorized();
  }

  if (admin) {
    c.set('project', project);
    c.set('scope', 'admin');
    return next();
  }

  if (await verifyTokenHash(token, project.api_token_hash)) {
    c.set('project', project);
    c.set('scope', 'project');
    return next();
  }

  unauthorized();
};
