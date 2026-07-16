import { describe, it, expect } from 'vitest';
import { createProject, json, jsonHeaders, request } from './helpers';

// 1x1 transparent PNG as a data URL.
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

function ingestHeaders(key: string): HeadersInit {
  return { 'Content-Type': 'application/json', 'X-Croquis-Ingest-Key': key };
}

describe('ingest + comments', () => {
  it('ingests a comment with the ingest key and stores + serves a screenshot', async () => {
    const project = await createProject('Review');
    const res = await request('/ingest/comments', {
      method: 'POST',
      headers: ingestHeaders(project.ingest_key),
      body: JSON.stringify({
        page_url: 'https://example.test/',
        body: 'fix hero spacing',
        element_selector: '.hero',
        computed_style: '{"color":"#000"}',
        screenshot: PIXEL_PNG,
      }),
    });
    expect(res.status).toBe(201);
    const { id } = await json(res);

    const list = await json(
      await request(`/projects/${project.id}/comments`, {
        headers: jsonHeaders(project.api_token),
      }),
    );
    expect(list.comments).toHaveLength(1);
    expect(list.comments[0].id).toBe(id);
    expect(list.comments[0].element_selector).toBe('.hero');
    expect(list.comments[0].status).toBe('open');
    expect(list.comments[0].screenshot_key).toBeTruthy();

    const shot = await request(`/projects/${project.id}/comments/${id}/screenshot`, {
      headers: jsonHeaders(project.api_token),
    });
    expect(shot.status).toBe(200);
    expect(shot.headers.get('Content-Type')).toBe('image/png');
  });

  it('rejects ingest with a bad key', async () => {
    const res = await request('/ingest/comments', {
      method: 'POST',
      headers: ingestHeaders('ing_invalid'),
      body: JSON.stringify({ page_url: 'https://example.test/', body: 'hi' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an empty comment body', async () => {
    const project = await createProject();
    const res = await request('/ingest/comments', {
      method: 'POST',
      headers: ingestHeaders(project.ingest_key),
      body: JSON.stringify({ page_url: 'https://example.test/', body: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('adds a reply and resolves a comment', async () => {
    const project = await createProject();
    const h = jsonHeaders(project.api_token);
    const { id } = await json(
      await request('/ingest/comments', {
        method: 'POST',
        headers: ingestHeaders(project.ingest_key),
        body: JSON.stringify({ page_url: 'https://example.test/', body: 'typo here' }),
      }),
    );

    const reply = await request(`/projects/${project.id}/comments/${id}/replies`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ body: 'fixed', author_name: 'Dev' }),
    });
    expect(reply.status).toBe(201);

    const resolved = await json(
      await request(`/projects/${project.id}/comments/${id}`, {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({ status: 'resolved' }),
      }),
    );
    expect(resolved.status).toBe('resolved');
    expect(resolved.replies).toHaveLength(1);
    expect(resolved.replies[0].body).toBe('fixed');
  });

  it('rejects an invalid status filter with 400', async () => {
    const project = await createProject();
    const res = await request(`/projects/${project.id}/comments?status=bogus`, {
      headers: jsonHeaders(project.api_token),
    });
    expect(res.status).toBe(400);
  });

  it('filters comments by status', async () => {
    const project = await createProject();
    const h = jsonHeaders(project.api_token);
    for (const body of ['a', 'b']) {
      await request('/ingest/comments', {
        method: 'POST',
        headers: ingestHeaders(project.ingest_key),
        body: JSON.stringify({ page_url: 'https://example.test/', body }),
      });
    }
    const open = await json(
      await request(`/projects/${project.id}/comments?status=open`, { headers: h }),
    );
    expect(open.comments).toHaveLength(2);
    const resolved = await json(
      await request(`/projects/${project.id}/comments?status=resolved`, { headers: h }),
    );
    expect(resolved.comments).toHaveLength(0);
  });

  it('exports a project as AI JSON with public projection', async () => {
    const project = await createProject('Export');
    const h = jsonHeaders(project.api_token);
    const page = await json(
      await request(`/projects/${project.id}/pages`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ path: '/' }),
      }),
    );
    await request(`/projects/${project.id}/pages/${page.id}/content-blocks`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ type: 'heading', content: 'Welcome' }),
    });
    await request('/ingest/comments', {
      method: 'POST',
      headers: ingestHeaders(project.ingest_key),
      body: JSON.stringify({ page_url: 'https://example.test/', body: 'orphan comment' }),
    });

    const exported = await json(await request(`/projects/${project.id}/export`, { headers: h }));
    expect(exported.schema_version).toBeTruthy();
    expect(exported.project.id).toBe(project.id);
    expect(exported.project).not.toHaveProperty('ingest_key');
    expect(exported.pages).toHaveLength(1);
    expect(exported.pages[0].content_blocks).toHaveLength(1);
    expect(exported.orphan_comments).toHaveLength(1);
  });
});
