import { beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  api,
  createApiKey,
  createProject,
  json,
  type Session,
  setupOwner,
  uniqueEmail,
} from './helpers';

let owner: Session;

beforeAll(async () => {
  owner = await setupOwner();
});

async function page(projectId: string, body: Record<string, unknown>) {
  const response = await api.post(`/projects/${projectId}/pages`, body, owner);
  if (response.status !== 201)
    throw new Error(`page failed: ${response.status} ${await response.text()}`);
  return json(response);
}

describe('sitemap', () => {
  it('creates pages with normalized paths, appended sort order and stats', async () => {
    const project = await createProject(owner);
    const home = await page(project.id, { path: '/', title: 'Home' });
    const about = await page(project.id, { path: '/about.html', title: 'About' });
    expect(about).toMatchObject({
      path: '/about',
      sort_index: 1,
      status: 'todo',
      comments_active: 0,
      approval: null,
    });
    const child = await page(project.id, { path: '/about/team/', parent_id: about.id });
    expect(child).toMatchObject({ path: '/about/team', parent_id: about.id, sort_index: 0 });
    const list = await json(await api.get(`/projects/${project.id}/pages`, owner));
    expect(list.data.map((p: { path: string }) => p.path)).toEqual(['/', '/about/team', '/about']);
    expect(home.sort_index).toBe(0);
  });

  it('rejects duplicate paths and foreign parents', async () => {
    const project = await createProject(owner);
    const other = await createProject(owner);
    await page(project.id, { path: '/pricing' });
    const dup = await api.post(`/projects/${project.id}/pages`, { path: '/pricing/' }, owner);
    expect(dup.status).toBe(409);
    expect((await json(dup)).code).toBe('page_path_exists');
    const foreign = await page(other.id, { path: '/x' });
    const bad = await api.post(
      `/projects/${project.id}/pages`,
      { path: '/y', parent_id: foreign.id },
      owner,
    );
    expect(bad.status).toBe(422);
    expect((await json(bad)).code).toBe('invalid_parent');
  });

  it('prevents cycles when re-parenting and reordering', async () => {
    const project = await createProject(owner);
    const a = await page(project.id, { path: '/a' });
    const b = await page(project.id, { path: '/a/b', parent_id: a.id });
    const cycle = await api.patch(`/pages/${a.id}`, { parent_id: b.id }, owner);
    expect(cycle.status).toBe(422);
    expect((await json(cycle)).code).toBe('page_cycle');
    const reorder = await api.post(
      `/projects/${project.id}/pages/reorder`,
      { parent_id: b.id, page_ids: [a.id] },
      owner,
    );
    expect(reorder.status).toBe(422);
  });

  it('reorders siblings in one call', async () => {
    const project = await createProject(owner);
    const x = await page(project.id, { path: '/x' });
    const y = await page(project.id, { path: '/y' });
    const z = await page(project.id, { path: '/z' });
    const result = await json(
      await api.post(
        `/projects/${project.id}/pages/reorder`,
        { parent_id: null, page_ids: [z.id, x.id, y.id] },
        owner,
      ),
    );
    expect(result.data.map((p: { path: string }) => p.path)).toEqual(['/z', '/x', '/y']);
  });

  it('deleting a page promotes its children and returns its comments to the inbox', async () => {
    const project = await createProject(owner);
    const parent = await page(project.id, { path: '/docs' });
    const child = await page(project.id, { path: '/docs/intro', parent_id: parent.id });
    const comment = await json(
      await api.post(
        `/projects/${project.id}/comments`,
        { body: 'Typo here', page_id: parent.id },
        owner,
      ),
    );
    expect((await api.delete(`/pages/${parent.id}`, owner)).status).toBe(204);
    expect((await json(await api.get(`/pages/${child.id}`, owner))).parent_id).toBeNull();
    expect((await json(await api.get(`/comments/${comment.id}`, owner))).page_id).toBeNull();
  });

  it('a new page adopts matching unassigned comments, including pattern pages', async () => {
    const project = await createProject(owner);
    const orphan = await json(
      await api.post(
        `/projects/${project.id}/comments`,
        { body: 'Fix date', page_url: 'https://site.example/blog/hello' },
        owner,
      ),
    );
    expect(orphan.page_id).toBeNull();
    const blog = await page(project.id, { path: '/blog/:slug', title: 'Blog post' });
    expect(blog.comments_active).toBe(1);
    expect((await json(await api.get(`/comments/${orphan.id}`, owner))).page_id).toBe(blog.id);
  });

  it('PATCH only touches sent fields', async () => {
    const project = await createProject(owner);
    const p = await page(project.id, { path: '/keep', title: 'Keep', purpose: 'Explain things' });
    const updated = await json(await api.patch(`/pages/${p.id}`, { status: 'review' }, owner));
    expect(updated).toMatchObject({
      status: 'review',
      title: 'Keep',
      purpose: 'Explain things',
      path: '/keep',
    });
  });
});

describe('content blocks', () => {
  it('appends, edits and clears the AI flag on manual edits', async () => {
    const project = await createProject(owner);
    const p = await page(project.id, { path: '/' });
    const first = await json(
      await api.post(
        `/pages/${p.id}/content-blocks`,
        { type: 'heading', content: 'Welcome', ai_generated: true },
        owner,
      ),
    );
    const second = await json(
      await api.post(`/pages/${p.id}/content-blocks`, { type: 'body', content: 'Hello' }, owner),
    );
    expect([first.position, second.position]).toEqual([0, 1]);
    const edited = await json(
      await api.patch(`/content-blocks/${first.id}`, { content: 'Welcome!' }, owner),
    );
    expect(edited).toMatchObject({ content: 'Welcome!', ai_generated: false });
    expect((await api.delete(`/content-blocks/${second.id}`, owner)).status).toBe(204);
    const list = await json(await api.get(`/pages/${p.id}/content-blocks`, owner));
    expect(list.data).toHaveLength(1);
  });
});

describe('review rounds and approvals', () => {
  it('records decisions and reflects the latest one on the page', async () => {
    const project = await createProject(owner);
    const p = await page(project.id, { path: '/pricing' });
    const round = await json(
      await api.post(
        `/projects/${project.id}/review-rounds`,
        { name: 'Round 1', preview_url: 'https://preview.example' },
        owner,
      ),
    );
    expect(round).toMatchObject({ status: 'open', closed_at: null });
    await api.post(
      `/pages/${p.id}/approvals`,
      { decision: 'changes_requested', note: 'Fix CTA' },
      owner,
    );
    const approved = await json(
      await api.post(
        `/pages/${p.id}/approvals`,
        { decision: 'approved', review_round_id: round.id },
        owner,
      ),
    );
    expect(approved).toMatchObject({
      decision: 'approved',
      approver_type: 'user',
      approver_name: 'Olivia Owner',
    });
    expect((await json(await api.get(`/pages/${p.id}`, owner))).approval).toBe('approved');
    const history = await json(await api.get(`/pages/${p.id}/approvals`, owner));
    expect(history.data.map((a: { decision: string }) => a.decision)).toEqual([
      'approved',
      'changes_requested',
    ]);

    const closed = await json(
      await api.patch(`/review-rounds/${round.id}`, { status: 'closed' }, owner),
    );
    expect(closed.closed_at).toEqual(expect.any(Number));
    const activity = await json(await api.get(`/projects/${project.id}/activity`, owner));
    expect(activity.data.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining([
        'review_round.closed',
        'page.approved',
        'page.changes_requested',
        'review_round.opened',
      ]),
    );
  });

  it('API keys cannot approve on behalf of clients', async () => {
    const project = await createProject(owner);
    const p = await page(project.id, { path: '/' });
    const token = await createApiKey(owner);
    expect(
      (await api.post(`/pages/${p.id}/approvals`, { decision: 'approved' }, { token })).status,
    ).toBe(403);
  });

  it('members can edit the sitemap', async () => {
    const project = await createProject(owner);
    const member = await addMember(owner, uniqueEmail('writer'));
    expect(
      (await api.post(`/projects/${project.id}/pages`, { path: '/from-member' }, member)).status,
    ).toBe(201);
  });
});
