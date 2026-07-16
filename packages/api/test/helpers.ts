import { env } from 'cloudflare:test';
import type { CreatedProject } from '@croquis/shared';
import app from '../src/index';

export const ADMIN_TOKEN = 'test-admin-token';

export function jsonHeaders(token: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export const adminHeaders = (extra: Record<string, string> = {}): HeadersInit =>
  jsonHeaders(ADMIN_TOKEN, extra);

/** Send a request through the app with the test env bindings. */
export async function request(path: string, init?: RequestInit): Promise<Response> {
  return app.request(path, init, env);
}

/** Parse a JSON response body (loosely typed for test ergonomics). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function json(res: Response): Promise<any> {
  return res.json();
}

/** Create a project via the API and return the created project (with token). */
export async function createProject(
  name = 'Test Project',
  sharePassword?: string,
): Promise<CreatedProject> {
  const res = await request('/projects', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(sharePassword ? { name, share_password: sharePassword } : { name }),
  });
  if (res.status !== 201) {
    throw new Error(`createProject failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as CreatedProject;
}
