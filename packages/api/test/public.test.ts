import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, call, createProject, json, type Session, setupOwner } from './helpers';

let owner: Session;

beforeAll(async () => {
  owner = await setupOwner();
});

// 1×1 transparent PNG
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function ingest(key: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return call('/api/v1/public/ingest/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Croquis-Ingest-Key': key, ...headers },
    body: JSON.stringify(body),
  });
}

async function startSession(slug: string, body: Record<string, unknown> = {}) {
  const response = await api.post(`/public/share/${slug}/session`, {
    name: 'Clara Client',
    ...body,
  });
  return { response, session: response.status === 201 ? await json(response) : null };
}

describe('widget bootstrap', () => {
  it('returns the widget config for a valid key and origin', async () => {
    const project = await createProject(owner, {
      name: 'Widget site',
      origin: 'https://client.example',
    });
    const ok = await call(`/api/v1/public/widget/config?key=${project.ingest_key}`, {
      headers: { Origin: 'https://client.example' },
    });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({
      project: { id: project.id, name: 'Widget site' },
      widget_mode: 'activated',
      requires_reviewer: true,
      turnstile_site_key: null,
    });
    const foreign = await call(`/api/v1/public/widget/config?key=${project.ingest_key}`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    expect((await json(foreign)).code).toBe('origin_not_allowed');
    const unknown = await call('/api/v1/public/widget/config?key=ing_nope');
    expect(unknown.status).toBe(401);
  });
});

describe('ingest', () => {
  it('accepts anonymous feedback in always mode with screenshot, diagnostics and environment', async () => {
    const project = await createProject(owner, {
      widget_mode: 'always',
      origin: 'https://shop.example',
    });
    const home = await json(await api.post(`/projects/${project.id}/pages`, { path: '/' }, owner));
    const response = await ingest(
      project.ingest_key,
      {
        page_url: 'https://shop.example/',
        body: 'The price looks wrong',
        author_name: 'Visitor',
        anchor: {
          selector: 'main > .price',
          text_quote: '¥1,000',
          rel_x: 0.5,
          rel_y: 0.2,
          doc_x: 100,
          doc_y: 400,
        },
        environment: {
          viewport_w: 390,
          viewport_h: 844,
          device_pixel_ratio: 3,
          user_agent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
        },
        screenshot: PNG,
        diagnostics: {
          console: [{ level: 'error', message: 'TypeError: x is undefined', at: Date.now() }],
          network: [],
        },
      },
      { Origin: 'https://shop.example' },
    );
    expect(response.status).toBe(201);
    const result = await json(response);
    expect(result).toMatchObject({ number: 1, page_id: home.id, screenshot_stored: true });

    const detail = await json(await api.get(`/comments/${result.id}`, owner));
    expect(detail).toMatchObject({
      source: 'widget',
      author: { type: 'anonymous', name: 'Visitor', verified: false },
      anchor: { status: 'anchored', selector: 'main > .price' },
      environment: { viewport: 'mobile', browser: 'Safari 18', os: 'iOS 18' },
    });
    expect(detail.screenshot).toMatchObject({
      kind: 'screenshot',
      width: 1,
      height: 1,
      content_type: 'image/png',
    });
    expect(detail.attachments.map((a: { kind: string }) => a.kind).sort()).toEqual([
      'console_log',
      'screenshot',
    ]);

    const image = await call(detail.screenshot.url, { headers: { Cookie: owner.cookie } });
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
  });

  it('requires a reviewer session in activated mode and rejects foreign origins', async () => {
    const project = await createProject(owner, { origin: 'https://staging.example' });
    const anonymous = await ingest(project.ingest_key, {
      page_url: 'https://staging.example/',
      body: 'hi',
    });
    expect(anonymous.status).toBe(403);
    expect((await json(anonymous)).code).toBe('reviewer_required');

    const foreignPage = await ingest(project.ingest_key, {
      page_url: 'https://evil.example/',
      body: 'hi',
    });
    expect(foreignPage.status).toBe(403);
    expect((await json(foreignPage)).code).toBe('origin_not_allowed');
  });

  it('turns suggestions into text-edit comments linked to the content block', async () => {
    const project = await createProject(owner, { widget_mode: 'always' });
    const home = await json(await api.post(`/projects/${project.id}/pages`, { path: '/' }, owner));
    const block = await json(
      await api.post(
        `/pages/${home.id}/content-blocks`,
        { type: 'heading', content: 'Welcome to Acme Cloud' },
        owner,
      ),
    );
    const result = await json(
      await ingest(project.ingest_key, {
        page_url: 'https://anywhere.example/',
        body: 'Use our real product name',
        suggestion: { original: 'Acme Cloud', text: 'Acme Platform' },
      }),
    );
    const detail = await json(await api.get(`/comments/${result.id}`, owner));
    expect(detail).toMatchObject({
      kind: 'text_edit',
      suggestion: { original: 'Acme Cloud', text: 'Acme Platform', content_block_id: block.id },
    });
  });

  it('refuses when the widget is off', async () => {
    const project = await createProject(owner, { widget_mode: 'off' });
    const response = await ingest(project.ingest_key, {
      page_url: 'https://x.example/',
      body: 'hi',
    });
    expect(response.status).toBe(403);
    expect((await json(response)).code).toBe('widget_disabled');
  });
});

describe('share viewer', () => {
  async function sharedProject(linkBody: Record<string, unknown> = {}) {
    const project = await createProject(owner, { origin: 'https://review.example' });
    const home = await json(
      await api.post(`/projects/${project.id}/pages`, { path: '/', title: 'Home' }, owner),
    );
    const link = await json(await api.post(`/projects/${project.id}/share-links`, linkBody, owner));
    return { project, home, link };
  }

  it('gates on the password and issues a session', async () => {
    const { link, project } = await sharedProject({ password: 'letmein-please' });
    const meta = await json(await api.get(`/public/share/${link.slug}`));
    expect(meta).toMatchObject({
      project: { name: project.name },
      password_required: true,
      allow_comments: true,
    });
    expect(JSON.stringify(meta)).not.toContain('ing_');

    expect((await startSession(link.slug)).response.status).toBe(401);
    expect((await startSession(link.slug, { password: 'wrong-password' })).response.status).toBe(
      401,
    );
    const { session } = await startSession(link.slug, { password: 'letmein-please' });
    expect(session.reviewer_token).toMatch(/^rvw_/);
    expect(session.token.split('.')).toHaveLength(2);

    const again = await startSession(link.slug, {
      password: 'letmein-please',
      reviewer_token: session.reviewer_token,
      name: 'Clara C.',
    });
    expect(again.session.reviewer.id).toBe(session.reviewer.id);
    expect(again.session.reviewer.name).toBe('Clara C.');
  });

  it('lets reviewers browse, comment, reply and approve — and never shows internal notes', async () => {
    const { link, home, project } = await sharedProject();
    const { session } = await startSession(link.slug);
    const headers = { 'X-Croquis-Share-Token': session.token };

    const pages = await json(await call(`/api/v1/public/share/${link.slug}/pages`, { headers }));
    expect(pages.data).toEqual([
      expect.objectContaining({ id: home.id, title: 'Home', approval: null }),
    ]);

    const created = await json(
      await api.post(
        `/public/share/${link.slug}/comments`,
        { page_id: home.id, body: 'Can we make the logo bigger?' },
        undefined,
        headers,
      ),
    );
    expect(created).toMatchObject({ number: 1, author_name: 'Clara Client', status: 'open' });
    expect(created).not.toHaveProperty('environment');

    await api.post(
      `/comments/${created.id}/replies`,
      { body: 'internal only', internal: true },
      owner,
    );
    await api.post(`/comments/${created.id}/replies`, { body: 'Sure, updating now' }, owner);
    await api.post(
      `/public/share/${link.slug}/comments/${created.id}/replies`,
      { body: 'Thanks!' },
      undefined,
      headers,
    );

    const thread = await json(
      await call(`/api/v1/public/share/${link.slug}/comments/${created.id}`, { headers }),
    );
    expect(thread.replies.map((r: { body: string }) => r.body)).toEqual([
      'Sure, updating now',
      'Thanks!',
    ]);

    const decision = await api.post(
      `/public/share/${link.slug}/pages/${home.id}/approvals`,
      { decision: 'approved' },
      undefined,
      headers,
    );
    expect(decision.status).toBe(201);
    expect(await json(decision)).toMatchObject({
      approver_type: 'guest',
      approver_name: 'Clara Client',
    });

    const member = await json(await api.get(`/comments/${created.id}`, owner));
    expect(member.author).toMatchObject({ type: 'guest', verified: true, name: 'Clara Client' });
    const activity = await json(await api.get(`/projects/${project.id}/activity`, owner));
    expect(activity.data[0]).toMatchObject({
      type: 'page.approved',
      actor: { type: 'guest', name: 'Clara Client' },
    });
  });

  it('lets a reviewer leave pinned feedback through the widget and see pins', async () => {
    const { link, project } = await sharedProject();
    const { session } = await startSession(link.slug);
    const headers = { 'X-Croquis-Share-Token': session.token, Origin: 'https://review.example' };
    const result = await ingest(
      project.ingest_key,
      { page_url: 'https://review.example/', body: 'Pinned note', anchor: { selector: 'h1' } },
      headers,
    );
    expect(result.status).toBe(201);
    const pins = await json(
      await call(`/api/v1/public/pins?page_url=${encodeURIComponent('https://review.example/')}`, {
        headers,
      }),
    );
    expect(pins.data).toEqual([
      expect.objectContaining({ body: 'Pinned note', author_name: 'Clara Client' }),
    ]);
    expect(
      (await call(`/api/v1/public/pins?page_url=${encodeURIComponent('https://review.example/')}`))
        .status,
    ).toBe(401);
  });

  it('respects link settings, revocation and expiry immediately', async () => {
    const { link, home } = await sharedProject({ allow_approvals: false });
    const { session } = await startSession(link.slug);
    const headers = { 'X-Croquis-Share-Token': session.token };
    const approval = await api.post(
      `/public/share/${link.slug}/pages/${home.id}/approvals`,
      { decision: 'approved' },
      undefined,
      headers,
    );
    expect(approval.status).toBe(403);

    await api.patch(`/share-links/${link.id}`, { revoked: true }, owner);
    expect((await call(`/api/v1/public/share/${link.slug}/pages`, { headers })).status).toBe(404);

    const expired = await sharedProject({ expires_at: Date.now() + 60_000 });
    await env.DB.prepare('UPDATE share_links SET expires_at = ? WHERE id = ?')
      .bind(Date.now() - 1, expired.link.id)
      .run();
    const gone = await api.get(`/public/share/${expired.link.slug}`);
    expect(gone.status).toBe(410);
    expect((await json(gone)).code).toBe('share_link_expired');
  });

  it('rejects forged or cross-link tokens', async () => {
    const a = await sharedProject();
    const b = await sharedProject();
    const { session } = await startSession(a.link.slug);
    const cross = await call(`/api/v1/public/share/${b.link.slug}/pages`, {
      headers: { 'X-Croquis-Share-Token': session.token },
    });
    expect(cross.status).toBe(401);
    const [payload] = session.token.split('.');
    const forged = await call(`/api/v1/public/share/${a.link.slug}/pages`, {
      headers: { 'X-Croquis-Share-Token': `${payload}.AAAA` },
    });
    expect(forged.status).toBe(401);
  });
});
