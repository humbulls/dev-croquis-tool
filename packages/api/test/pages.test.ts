import { describe, expect, it } from 'vitest';
import { createProject, json, jsonHeaders, request } from './helpers';

describe('pages', () => {
  it('creates pages with auto sort_index and supports hierarchy', async () => {
    const project = await createProject('Sitemap');
    const h = jsonHeaders(project.api_token);

    const home = await json(
      await request(`/projects/${project.id}/pages`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ path: '/', title: 'Home' }),
      }),
    );
    expect(home.sort_index).toBe(0);
    expect(home.status).toBe('todo');

    const about = await json(
      await request(`/projects/${project.id}/pages`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ path: '/about', parent_id: home.id }),
      }),
    );
    expect(about.parent_id).toBe(home.id);
    expect(about.sort_index).toBe(0); // first child under home

    const list = await json(await request(`/projects/${project.id}/pages`, { headers: h }));
    expect(list.pages).toHaveLength(2);
  });

  it('rejects a page with an unknown parent', async () => {
    const project = await createProject('BadParent');
    const res = await request(`/projects/${project.id}/pages`, {
      method: 'POST',
      headers: jsonHeaders(project.api_token),
      body: JSON.stringify({ path: '/x', parent_id: crypto.randomUUID() }),
    });
    expect(res.status).toBe(400);
  });

  it('updates status and promotes children when a parent is deleted', async () => {
    const project = await createProject('Tree');
    const h = jsonHeaders(project.api_token);
    const parent = await json(
      await request(`/projects/${project.id}/pages`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ path: '/parent' }),
      }),
    );
    const child = await json(
      await request(`/projects/${project.id}/pages`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ path: '/parent/child', parent_id: parent.id }),
      }),
    );

    const updated = await json(
      await request(`/projects/${project.id}/pages/${child.id}`, {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({ status: 'done' }),
      }),
    );
    expect(updated.status).toBe('done');

    const del = await request(`/projects/${project.id}/pages/${parent.id}`, {
      method: 'DELETE',
      headers: h,
    });
    expect(del.status).toBe(200);

    const promoted = await json(
      await request(`/projects/${project.id}/pages/${child.id}`, { headers: h }),
    );
    expect(promoted.parent_id).toBeNull();
  });

  it('rejects re-parenting under a descendant (cycle prevention)', async () => {
    const project = await createProject('Cycle');
    const h = jsonHeaders(project.api_token);
    const a = await json(
      await request(`/projects/${project.id}/pages`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ path: '/a' }),
      }),
    );
    const b = await json(
      await request(`/projects/${project.id}/pages`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ path: '/a/b', parent_id: a.id }),
      }),
    );
    const c = await json(
      await request(`/projects/${project.id}/pages`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ path: '/a/b/c', parent_id: b.id }),
      }),
    );

    // a → (descendant c) must be rejected, as must self-parenting.
    const cycle = await request(`/projects/${project.id}/pages/${a.id}`, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ parent_id: c.id }),
    });
    expect(cycle.status).toBe(400);

    const self = await request(`/projects/${project.id}/pages/${a.id}`, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ parent_id: a.id }),
    });
    expect(self.status).toBe(400);

    // A legal move still works and lands at the end of the new sibling list.
    const legal = await json(
      await request(`/projects/${project.id}/pages/${c.id}`, {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({ parent_id: a.id }),
      }),
    );
    expect(legal.parent_id).toBe(a.id);
    expect(legal.sort_index).toBe(1); // after /a/b under /a
  });

  it('manages content blocks under a page', async () => {
    const project = await createProject('Content');
    const h = jsonHeaders(project.api_token);
    const page = await json(
      await request(`/projects/${project.id}/pages`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ path: '/' }),
      }),
    );

    const block = await json(
      await request(`/projects/${project.id}/pages/${page.id}/content-blocks`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ type: 'heading', content: 'Welcome', ai_generated: true }),
      }),
    );
    expect(block.type).toBe('heading');
    expect(block.ai_generated).toBe(true);
    expect(block.position).toBe(0);

    const list = await json(
      await request(`/projects/${project.id}/pages/${page.id}/content-blocks`, { headers: h }),
    );
    expect(list.content_blocks).toHaveLength(1);
  });
});
