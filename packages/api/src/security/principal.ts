import type { Actor, ApiKeyScope } from '@croquis/shared';
import type { MiddlewareHandler } from 'hono';
import { getAuth } from '../auth';
import type { AppEnv, Env } from '../env';
import { background } from '../http/background';
import { unauthorized } from '../http/problem';
import { secretsEqual, sha256Hex } from './crypto';
import { API_KEY_PREFIX } from './tokens';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface ApiKeyIdentity {
  id: string;
  name: string;
  workspaceId: string;
  /** null = every project in the workspace. */
  projectId: string | null;
  scopes: ApiKeyScope[];
  createdBy: string | null;
}

/** Who is making the request. Resolved once per request by `resolvePrincipal`. */
export type Principal =
  | { type: 'anonymous' }
  /** The instance operator (ADMIN_TOKEN): every workspace, every permission. */
  | { type: 'admin' }
  | { type: 'user'; user: SessionUser }
  | { type: 'api_key'; key: ApiKeyIdentity; agent: boolean };

/** How the principal appears in the activity log and webhook payloads. */
export function actorOf(principal: Principal): Actor {
  switch (principal.type) {
    case 'user':
      return { type: 'user', id: principal.user.id, name: principal.user.name };
    case 'api_key':
      return {
        type: principal.agent ? 'agent' : 'api_key',
        id: principal.key.id,
        name: principal.key.name,
      };
    case 'admin':
      return { type: 'system', id: null, name: 'Instance admin' };
    default:
      return { type: 'system', id: null, name: null };
  }
}

function bearerToken(header: string | undefined): string | null {
  const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  return match?.[1] ?? null;
}

interface ApiKeyRow {
  id: string;
  name: string;
  workspace_id: string;
  project_id: string | null;
  scopes: string;
  created_by: string | null;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

/** last_used_at is informative; writing it on every call would double D1 writes. */
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000;

async function apiKeyPrincipal(
  env: Env,
  token: string,
  agent: boolean,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Principal | null> {
  const row = await env.DB.prepare(
    `SELECT id, name, workspace_id, project_id, scopes, created_by, last_used_at, expires_at, revoked_at
       FROM api_keys WHERE key_hash = ?`,
  )
    .bind(await sha256Hex(token))
    .first<ApiKeyRow>();
  const now = Date.now();
  if (!row || row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= now)) {
    return null;
  }
  if (row.last_used_at === null || now - row.last_used_at > LAST_USED_RESOLUTION_MS) {
    waitUntil(
      env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(now, row.id).run(),
    );
  }
  return {
    type: 'api_key',
    agent,
    key: {
      id: row.id,
      name: row.name,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      scopes: JSON.parse(row.scopes) as ApiKeyScope[],
      createdBy: row.created_by,
    },
  };
}

/**
 * Resolves the caller from, in order: an `Authorization: Bearer` API key or
 * admin token, then the Better Auth session cookie. A bearer token that is
 * present but invalid is rejected outright — it never falls back to cookies.
 */
export const resolvePrincipal: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearerToken(c.req.header('Authorization'));
  // MCP servers identify themselves so their writes are attributed to an agent.
  const agent = c.req.header('X-Croquis-Client')?.toLowerCase().startsWith('mcp') ?? false;
  const waitUntil = (p: Promise<unknown>) => void background(c, p);

  if (token) {
    let principal: Principal | null = null;
    if (token.startsWith(API_KEY_PREFIX)) {
      principal = await apiKeyPrincipal(c.env, token, agent, waitUntil);
    }
    if (!principal && c.env.ADMIN_TOKEN && (await secretsEqual(token, c.env.ADMIN_TOKEN))) {
      principal = { type: 'admin' };
    }
    if (!principal) throw unauthorized('The bearer token is invalid, expired or revoked');
    c.set('principal', principal);
    return next();
  }

  if (c.req.header('Cookie')) {
    const session = await getAuth(c.env, new URL(c.req.url).origin).api.getSession({
      headers: c.req.raw.headers,
    });
    if (session) {
      c.set('principal', {
        type: 'user',
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image ?? null,
        },
      });
      return next();
    }
  }

  c.set('principal', { type: 'anonymous' });
  return next();
};

/**
 * Cookie-authenticated writes must come from our own pages. SameSite=Lax
 * cookies already stop cross-site form posts; this also covers same-site
 * attackers (another app on a shared parent domain).
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (
    c.get('principal').type !== 'user' ||
    method === 'GET' ||
    method === 'HEAD' ||
    method === 'OPTIONS'
  ) {
    return next();
  }
  const origin = c.req.header('Origin');
  const own = new URL(c.req.url).origin;
  const trusted = origin === own || (origin !== undefined && trustedOrigin(c.env, origin));
  const fetchSite = c.req.header('Sec-Fetch-Site');
  if (
    origin
      ? !trusted
      : fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none'
  ) {
    throw unauthorized('Cross-origin requests must use an API key, not the session cookie');
  }
  return next();
};

export function trustedOrigin(env: Env, origin: string): boolean {
  const publicUrl = env.PUBLIC_URL?.replace(/\/$/, '');
  if (publicUrl && origin === publicUrl) return true;
  return (env.DASHBOARD_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .some((o) => o !== '' && o !== '*' && o === origin);
}
