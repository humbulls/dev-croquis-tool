import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { signWebhook } from '../src/services/webhooks';
import {
  type Session,
  addMember,
  api,
  call,
  createApiKey,
  createProject,
  json,
  setupOwner,
  uniqueEmail,
} from './helpers';

let owner: Session;

beforeAll(async () => {
  owner = await setupOwner();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('projects', () => {
  it('creates a project with an ingest key, counters and an optional origin', async () => {
    const project = await createProject(owner, { name: 'Landing Page', origin: 'https://Staging.Example.com/pricing?x=1' });
    expect(project).toMatchObject({
      workspace_id: owner.workspaceId,
      name: 'Landing Page',
      slug: 'landing-page',
      widget_mode: 'activated',
      stats: { pages: 0, comments_active: 0, comments_unassigned: 0, comments_total: 0 },
    });
    expect(project.ingest_key).toMatch(/^ing_/);
    const origins = await json(await api.get(`/projects/${project.id}/origins`, owner));
    expect(origins.data).toEqual([expect.objectContaining({ origin: 'https://staging.example.com', base_path: '/' })]);
  });

  it('keeps slugs unique per workspace and survives non-ASCII names', async () => {
    const a = await createProject(owner, { name: 'Dup Name' });
    const b = await createProject(owner, { name: 'Dup Name' });
    expect(a.slug).toBe('dup-name');
    expect(b.slug).toBe('dup-name-2');
    const ja = await createProject(owner, { name: 'コーポレートサイト' });
    expect(ja.slug).toMatch(/^[a-z0-9]{8}$/);
  });

  it('paginates with an opaque cursor', async () => {
    const token = await createApiKey(owner);
    for (let i = 0; i < 3; i++) await createProject({ token }, { name: `Paged ${i}` });
    const first = await json(await api.get('/projects?limit=2', { token }));
    expect(first.data).toHaveLength(2);
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = await json(await api.get(`/projects?limit=2&cursor=${first.next_cursor}`, { token }));
    const ids = new Set([...first.data, ...second.data].map((p: { id: string }) => p.id));
    expect(ids.size).toBe(first.data.length + second.data.length);

    const bad = await api.get('/projects?cursor=not-a-cursor', { token });
    expect(bad.status).toBe(400);
    expect((await json(bad)).code).toBe('invalid_cursor');
  });

  it('PATCH changes only the fields sent and logs the change', async () => {
    const project = await createProject(owner, { name: 'Patch me', description: 'keep this' });
    const updated = await json(await api.patch(`/projects/${project.id}`, { widget_mode: 'always' }, owner));
    expect(updated).toMatchObject({ name: 'Patch me', description: 'keep this', widget_mode: 'always' });

    const activity = await json(await api.get(`/projects/${project.id}/activity`, owner));
    expect(activity.data.map((e: { type: string }) => e.type)).toEqual(['project.updated', 'project.created']);
    expect(activity.data[0]).toMatchObject({
      actor: { type: 'user', id: owner.userId, name: 'Olivia Owner' },
      data: { changes: { widget_mode: 'always' } },
    });
  });

  it('validates input with field-level 422 errors', async () => {
    const response = await api.post('/projects', { name: '', widget_mode: 'sometimes' }, owner);
    expect(response.status).toBe(422);
    const problem = await json(response);
    expect(problem.code).toBe('validation_failed');
    expect(problem.errors.map((e: { path: string }) => e.path).sort()).toEqual(['name', 'widget_mode']);
  });

  it('members read and share, admins manage settings', async () => {
    const project = await createProject(owner);
    const member = await addMember(owner, uniqueEmail('member'));
    expect((await api.get(`/projects/${project.id}`, member)).status).toBe(200);
    expect((await api.patch(`/projects/${project.id}`, { name: 'x' }, member)).status).toBe(403);
    expect((await api.post(`/projects/${project.id}/share-links`, {}, member)).status).toBe(201);
    expect((await api.post(`/projects/${project.id}/labels`, { name: 'Copy' }, member)).status).toBe(201);
    expect((await api.post('/projects', { name: 'Nope', workspace_id: owner.workspaceId }, member)).status).toBe(403);
  });

  it('rotates the ingest key', async () => {
    const project = await createProject(owner);
    const rotated = await json(await api.post(`/projects/${project.id}/ingest-key/rotate`, {}, owner));
    expect(rotated.ingest_key).toMatch(/^ing_/);
    expect(rotated.ingest_key).not.toBe(project.ingest_key);
  });

  it('deletes the project and its stored objects', async () => {
    const project = await createProject(owner);
    const key = `attachments/${project.id}/leftover.png`;
    await env.BUCKET.put(key, new Uint8Array([1, 2, 3]));
    expect((await api.delete(`/projects/${project.id}`, owner)).status).toBe(204);
    expect((await api.get(`/projects/${project.id}`, owner)).status).toBe(404);
    expect(await env.BUCKET.get(key)).toBeNull();
  });
});

describe('origins', () => {
  it('normalizes and de-duplicates', async () => {
    const project = await createProject(owner);
    const added = await api.post(
      `/projects/${project.id}/origins`,
      { url: 'http://localhost:4321/app/', base_path: '/app/', environment: 'local' },
      owner,
    );
    expect(added.status).toBe(201);
    const origin = await json(added);
    expect(origin).toMatchObject({ origin: 'http://localhost:4321', base_path: '/app', environment: 'local' });
    const dup = await api.post(`/projects/${project.id}/origins`, { url: 'http://localhost:4321' }, owner);
    expect(dup.status).toBe(409);
    const { id } = origin;
    expect((await api.delete(`/origins/${id}`, owner)).status).toBe(204);
  });
});

describe('share links and labels', () => {
  it('manages password, expiry and revocation', async () => {
    const project = await createProject(owner);
    const link = await json(
      await api.post(`/projects/${project.id}/share-links`, { label: 'Client review', password: 'hunter2hunter2' }, owner),
    );
    expect(link).toMatchObject({ label: 'Client review', password_protected: true, allow_comments: true, revoked_at: null });
    expect(link.slug).toMatch(/^[a-z0-9]{12}$/);
    expect(JSON.stringify(link)).not.toContain('hunter2');

    const updated = await json(await api.patch(`/share-links/${link.id}`, { password: null, revoked: true }, owner));
    expect(updated).toMatchObject({ password_protected: false, revoked_at: expect.any(Number), label: 'Client review' });
  });

  it('rejects duplicate label names', async () => {
    const project = await createProject(owner);
    await api.post(`/projects/${project.id}/labels`, { name: 'Bug', color: 'red' }, owner);
    const dup = await api.post(`/projects/${project.id}/labels`, { name: 'Bug' }, owner);
    expect(dup.status).toBe(409);
    const labels = await json(await api.get(`/projects/${project.id}/labels`, owner));
    expect(labels.data).toEqual([expect.objectContaining({ name: 'Bug', color: 'red' })]);
  });
});

describe('webhook outbox', () => {
  it('delivers signed Standard Webhooks for committed events', async () => {
    const project = await createProject(owner);
    const secret = `whsec_${btoa('0123456789abcdef0123456789abcdef')}`;
    await env.DB.prepare(
      `INSERT INTO webhook_endpoints (id, project_id, url, secret, event_types, created_at, updated_at)
       VALUES (?, ?, 'https://hooks.example/croquis', ?, '["project.updated"]', 0, 0)`,
    )
      .bind(crypto.randomUUID(), project.id, secret)
      .run();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    await api.patch(`/projects/${project.id}`, { name: 'Renamed' }, owner);

    const hookCalls = fetchSpy.mock.calls.filter(([url]) => String(url) === 'https://hooks.example/croquis');
    expect(hookCalls).toHaveLength(1);
    const [, init] = hookCalls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    const payload = JSON.parse(body);
    expect(payload).toMatchObject({ type: 'project.updated', project_id: project.id, data: { changes: { name: 'Renamed' } } });
    expect(headers['webhook-id']).toBe(payload.id);
    const expected = await signWebhook(secret, headers['webhook-id'] as string, Number(headers['webhook-timestamp']), body);
    expect(headers['webhook-signature']).toBe(expected);

    const delivery = await env.DB.prepare('SELECT status, attempt_count FROM webhook_deliveries WHERE event_id = ?')
      .bind(payload.id)
      .first();
    expect(delivery).toEqual({ status: 'succeeded', attempt_count: 1 });
  });

  it('schedules a retry when the receiver fails', async () => {
    const project = await createProject(owner);
    await env.DB.prepare(
      `INSERT INTO webhook_endpoints (id, project_id, url, secret, created_at, updated_at)
       VALUES (?, ?, 'https://hooks.example/down', ?, 0, 0)`,
    )
      .bind(crypto.randomUUID(), project.id, `whsec_${btoa('x'.repeat(32))}`)
      .run();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 503 }));
    const before = Date.now();
    await api.patch(`/projects/${project.id}`, { description: 'retry me' }, owner);
    const delivery = await env.DB.prepare(
      `SELECT d.status, d.attempt_count, d.next_attempt_at, d.last_status_code FROM webhook_deliveries d
         JOIN activity_events e ON e.id = d.event_id WHERE e.project_id = ? AND e.type = 'project.updated'`,
    )
      .bind(project.id)
      .first<{ status: string; attempt_count: number; next_attempt_at: number; last_status_code: number }>();
    expect(delivery).toMatchObject({ status: 'failed', attempt_count: 1, last_status_code: 503 });
    expect(delivery?.next_attempt_at).toBeGreaterThanOrEqual(before + 60_000);
  });
});

describe('API surface', () => {
  it('serves an OpenAPI 3.1 document with named components', async () => {
    const response = await call('/api/v1/openapi.json');
    expect(response.status).toBe(200);
    const doc = await json(response);
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/api/v1/projects', '/api/v1/projects/{projectId}']));
    expect(doc.components.schemas).toHaveProperty('ProjectWithStats');
    expect(doc.components.schemas).toHaveProperty('Problem');
    expect(doc.components.securitySchemes).toHaveProperty('bearerAuth');
  });

  it('serves the API reference UI', async () => {
    const response = await call('/api/docs');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('answers unknown routes with problem details', async () => {
    const response = await call('/api/v1/nope');
    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({ code: 'route_not_found' });
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('answers CORS preflights', async () => {
    const response = await call('/api/v1/public/ingest/comments', {
      method: 'OPTIONS',
      headers: { Origin: 'https://client.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });
});
