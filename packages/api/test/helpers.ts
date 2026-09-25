import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';

export const ADMIN_TOKEN = 'test-admin-token';
export const BASE = 'http://localhost';

export interface Session {
  cookie: string;
  userId: string;
  email: string;
  workspaceId: string;
}

/** Send a request through the Worker with a real ExecutionContext. */
export async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`${BASE}${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export async function json(response: Response): Promise<any> {
  return response.json();
}

type Auth = { cookie?: string; token?: string };

function authHeaders(auth: Auth | undefined): Record<string, string> {
  if (!auth) return {};
  if (auth.token) return { Authorization: `Bearer ${auth.token}` };
  if (auth.cookie) return { Cookie: auth.cookie, Origin: BASE };
  return {};
}

export const api = {
  get: (path: string, auth?: Auth) => call(`/api/v1${path}`, { headers: authHeaders(auth) }),
  delete: (path: string, auth?: Auth) =>
    call(`/api/v1${path}`, { method: 'DELETE', headers: authHeaders(auth) }),
  post: (path: string, body: unknown, auth?: Auth, extra: Record<string, string> = {}) =>
    call(`/api/v1${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(auth), ...extra },
      body: JSON.stringify(body),
    }),
  patch: (path: string, body: unknown, auth?: Auth) =>
    call(`/api/v1${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(auth) },
      body: JSON.stringify(body),
    }),
  put: (path: string, body: unknown, auth?: Auth) =>
    call(`/api/v1${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders(auth) },
      body: JSON.stringify(body),
    }),
};

/** `name=value` pairs from Set-Cookie headers, ready for a Cookie header. */
export function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';', 1)[0])
    .filter((pair): pair is string => Boolean(pair) && !pair?.endsWith('='))
    .join('; ');
}

export const OWNER_EMAIL = 'owner@example.com';
const PASSWORD = 'correct horse battery';

export async function signIn(email: string): Promise<string> {
  const response = await call('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (response.status !== 200)
    throw new Error(`sign-in failed: ${response.status} ${await response.text()}`);
  return cookieFrom(response);
}

/**
 * The instance owner: runs /setup on a fresh database, or signs in when an
 * earlier test in the same storage already did.
 */
export async function setupOwner(): Promise<Session> {
  const response = await api.post('/setup', {
    admin_token: ADMIN_TOKEN,
    name: 'Olivia Owner',
    email: OWNER_EMAIL,
    password: PASSWORD,
    workspace_name: 'Acme',
  });
  let cookie: string;
  if (response.status === 201) {
    cookie = cookieFrom(response);
  } else if (response.status === 409) {
    cookie = await signIn(OWNER_EMAIL);
  } else {
    throw new Error(`setup failed: ${response.status} ${await response.text()}`);
  }
  const me = await json(await api.get('/me', { cookie }));
  return { cookie, userId: me.user.id, email: OWNER_EMAIL, workspaceId: me.workspaces[0].id };
}

let counter = 0;
/** A unique email per call, so tests never collide on the users table. */
export function uniqueEmail(name = 'user'): string {
  counter += 1;
  return `${name}.${Date.now().toString(36)}.${counter}@example.com`;
}

export async function signUp(email: string, name = 'Test User'): Promise<Response> {
  return call('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, name, password: PASSWORD }),
  });
}

/** Invite `email` into the owner's workspace, sign them up and accept. */
export async function addMember(
  owner: Session,
  email: string,
  role: 'member' | 'admin' = 'member',
): Promise<Session> {
  const invite = await json(
    await api.post(`/workspaces/${owner.workspaceId}/invitations`, { email, role }, owner),
  );
  const token = String(invite.url).split('/invite/')[1];
  const signup = await signUp(email);
  if (signup.status !== 200)
    throw new Error(`sign-up failed: ${signup.status} ${await signup.text()}`);
  const cookie = cookieFrom(signup);
  const accepted = await api.post(`/invitations/${token}/accept`, {}, { cookie });
  if (accepted.status !== 200)
    throw new Error(`accept failed: ${accepted.status} ${await accepted.text()}`);
  const me = await json(await api.get('/me', { cookie }));
  return { cookie, userId: me.user.id, email, workspaceId: owner.workspaceId };
}

export async function createProject(owner: Auth, body: Record<string, unknown> = {}) {
  const response = await api.post('/projects', { name: 'Marketing site', ...body }, owner);
  if (response.status !== 201)
    throw new Error(`createProject failed: ${response.status} ${await response.text()}`);
  return json(response);
}

export async function createApiKey(
  owner: Session,
  body: Record<string, unknown> = {},
): Promise<string> {
  const response = await api.post(
    `/workspaces/${owner.workspaceId}/api-keys`,
    { name: 'CI', ...body },
    owner,
  );
  if (response.status !== 201)
    throw new Error(`createApiKey failed: ${response.status} ${await response.text()}`);
  return (await json(response)).key;
}
