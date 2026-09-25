import { describe, expect, it } from 'vitest';
import { createProject, json, request } from './helpers';

describe('share (public read-only)', () => {
  it('serves a public view without exposing keys/slugs', async () => {
    const project = await createProject('Shared');
    const res = await request(`/share/${project.share_slug}`);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.project.id).toBe(project.id);
    expect(data.project).not.toHaveProperty('ingest_key');
    expect(data.project).not.toHaveProperty('share_slug');
    expect(data.project).not.toHaveProperty('api_token');
  });

  it('requires the password when the share link is protected', async () => {
    const project = await createProject('Locked', 'secret123');
    const noPw = await request(`/share/${project.share_slug}`);
    expect(noPw.status).toBe(401);

    const withPw = await request(`/share/${project.share_slug}`, {
      headers: { 'X-Croquis-Share-Password': 'secret123' },
    });
    expect(withPw.status).toBe(200);

    const wrongPw = await request(`/share/${project.share_slug}`, {
      headers: { 'X-Croquis-Share-Password': 'nope' },
    });
    expect(wrongPw.status).toBe(401);
  });

  it('404s an unknown share slug', async () => {
    const res = await request('/share/doesnotexist');
    expect(res.status).toBe(404);
  });
});
