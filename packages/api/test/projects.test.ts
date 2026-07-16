import { describe, it, expect } from 'vitest';
import { adminHeaders, createProject, json, jsonHeaders, request } from './helpers';

describe('projects', () => {
  it('rejects unauthenticated create', async () => {
    const res = await request('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(res.status).toBe(401);
  });

  it('creates a project and reveals token/keys exactly once', async () => {
    const project = await createProject('Acme Site');
    expect(project.id).toBeTruthy();
    expect(project.slug).toBe('acme-site');
    expect(project.api_token).toMatch(/^crq_/);
    expect(project.ingest_key).toMatch(/^ing_/);
    expect(project.share_slug).toHaveLength(12);
    expect(project.share_password_protected).toBe(false);
  });

  it('lists projects for admin with owner fields but no api_token', async () => {
    await createProject('Listed Site');
    const res = await request('/projects', { headers: adminHeaders() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.projects.length).toBeGreaterThanOrEqual(1);
    expect(body.projects[0]).toHaveProperty('ingest_key');
    expect(body.projects[0]).not.toHaveProperty('api_token');
  });

  it('allows access with the project token but not a wrong one', async () => {
    const project = await createProject('Scoped');
    const ok = await request(`/projects/${project.id}`, { headers: jsonHeaders(project.api_token) });
    expect(ok.status).toBe(200);

    const wrong = await request(`/projects/${project.id}`, { headers: jsonHeaders('crq_wrong') });
    expect(wrong.status).toBe(401);
  });

  it('updates the name and toggles the share password', async () => {
    const project = await createProject('Old Name');
    const h = jsonHeaders(project.api_token);
    const res = await request(`/projects/${project.id}`, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ name: 'New Name', share_password: 'pw1234567' }),
    });
    const body = await json(res);
    expect(body.name).toBe('New Name');
    expect(body.share_password_protected).toBe(true);
  });

  it('rejects too-short share passwords with a readable error envelope', async () => {
    const project = await createProject('Weak PW');
    const res = await request(`/projects/${project.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(project.api_token),
      body: JSON.stringify({ share_password: 'short' }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(typeof body.error).toBe('string');
    expect(body.error).toContain('share_password');
  });

  it('deletes a project', async () => {
    const project = await createProject('Doomed');
    const del = await request(`/projects/${project.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(project.api_token),
    });
    expect(del.status).toBe(200);
    const after = await request(`/projects/${project.id}`, { headers: adminHeaders() });
    expect(after.status).toBe(404);
  });
});
