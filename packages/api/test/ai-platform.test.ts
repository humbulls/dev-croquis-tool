import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import type { Env } from '../src/env';
import { api, createProject, json, type Session, setupOwner } from './helpers';

let owner: Session;

beforeAll(async () => {
  owner = await setupOwner();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Call the app with an Anthropic key configured and Anthropic's API mocked. */
function withAnthropic(answer: unknown) {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).startsWith('https://api.anthropic.com/')) {
      return Response.json({
        content: [{ type: 'tool_use', name: 'result', input: answer }],
        usage: { input_tokens: 120, output_tokens: 80 },
      });
    }
    return new Response('unexpected', { status: 599 });
  });
  const aiEnv: Env = { ...env, AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' };
  const request = (path: string, body: unknown) =>
    app.request(
      `/api/v1${path}`,
      {
        method: 'POST',
        headers: {
          Cookie: owner.cookie,
          Origin: 'http://localhost',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      aiEnv,
    );
  return { fetchSpy, request };
}

describe('AI', () => {
  it('reports 501 with a helpful code when no provider is configured', async () => {
    const project = await createProject(owner);
    const response = await api.post(
      `/projects/${project.id}/ai/sitemap`,
      { brief: 'A bakery' },
      owner,
    );
    expect(response.status).toBe(501);
    expect((await json(response)).code).toBe('ai_not_configured');
  });

  it('drafts a sitemap, keeps existing pages and logs the run', async () => {
    const project = await createProject(owner);
    await api.post(`/projects/${project.id}/pages`, { path: '/' }, owner);
    const { fetchSpy, request } = withAnthropic({
      pages: [
        { path: '/', title: 'Home', purpose: 'Landing', audience: 'Everyone', parent_path: null },
        {
          path: '/menu/cakes',
          title: 'Cakes',
          purpose: 'Cake list',
          audience: 'Customers',
          parent_path: '/menu',
        },
        {
          path: '/menu',
          title: 'Menu',
          purpose: 'What we bake',
          audience: 'Customers',
          parent_path: null,
        },
      ],
    });
    const response = await request(`/projects/${project.id}/ai/sitemap`, {
      brief: 'A neighbourhood bakery',
    });
    expect(response.status).toBe(201);
    const created = await json(response);
    expect(created.data.map((p: { path: string }) => p.path).sort()).toEqual([
      '/menu',
      '/menu/cakes',
    ]);
    const menu = created.data.find((p: { path: string }) => p.path === '/menu');
    expect(created.data.find((p: { path: string }) => p.path === '/menu/cakes').parent_id).toBe(
      menu.id,
    );

    const call = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(call[1].body as string);
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'sitemap' });
    expect(sent.tools[0].input_schema.type).toBe('object');

    const runs = await json(await api.get(`/projects/${project.id}/ai/runs`, owner));
    expect(runs.data[0]).toMatchObject({
      kind: 'sitemap',
      provider: 'anthropic',
      status: 'succeeded',
      input_tokens: 120,
    });
  });

  it('logs failed runs when the model answers in the wrong shape', async () => {
    const project = await createProject(owner);
    const { request } = withAnthropic({ nope: true });
    const response = await request(`/projects/${project.id}/ai/sitemap`, { brief: 'x' });
    expect(response.status).toBe(502);
    expect((await json(response)).code).toBe('ai_invalid_output');
    const runs = await json(await api.get(`/projects/${project.id}/ai/runs`, owner));
    expect(runs.data[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('schema'),
    });
  });

  it('turns copy-check findings into typo comments without duplicates', async () => {
    const project = await createProject(owner);
    const home = await json(await api.post(`/projects/${project.id}/pages`, { path: '/' }, owner));
    await api.post(
      `/pages/${home.id}/content-blocks`,
      { type: 'body', content: 'サーバーの設定とサーバの監視を行います。' },
      owner,
    );
    const answer = {
      findings: [
        {
          block: 0,
          original: 'サーバの',
          suggestion: 'サーバーの',
          reason: '表記ゆれ',
          category: 'inconsistency',
        },
        {
          block: 0,
          original: 'not in text',
          suggestion: 'x',
          reason: 'hallucinated',
          category: 'typo',
        },
      ],
    };
    const { request } = withAnthropic(answer);
    const first = await json(await request(`/projects/${project.id}/ai/copy-check`, {}));
    expect(first.findings).toHaveLength(1);
    expect(first.comments_created).toBe(1);
    const again = await json(
      await withAnthropic(answer).request(`/projects/${project.id}/ai/copy-check`, {}),
    );
    expect(again.comments_created).toBe(0);

    const inbox = await json(await api.get(`/projects/${project.id}/comments?kind=typo`, owner));
    expect(inbox.data).toEqual([
      expect.objectContaining({
        source: 'ai',
        author: expect.objectContaining({ type: 'agent', name: 'Croquis AI' }),
        suggestion: expect.objectContaining({ original: 'サーバの', text: 'サーバーの' }),
      }),
    ]);
  });

  it('titles and links duplicates during triage', async () => {
    const project = await createProject(owner);
    const a = await json(
      await api.post(
        `/projects/${project.id}/comments`,
        { body: 'Menu overlaps logo on mobile' },
        owner,
      ),
    );
    const b = await json(
      await api.post(
        `/projects/${project.id}/comments`,
        { body: 'Logo covered by the menu (phone)' },
        owner,
      ),
    );
    const { request } = withAnthropic({
      titles: [{ number: a.number, title: 'Fix menu overlapping logo' }],
      duplicates: [{ canonical: a.number, duplicates: [b.number], reason: 'Same overlap' }],
    });
    const result = await json(await request(`/projects/${project.id}/ai/triage`, {}));
    expect(result).toMatchObject({
      titled: 1,
      duplicates_marked: 1,
      groups: [{ canonical_id: a.id, duplicate_ids: [b.id] }],
    });
    const updated = await json(await api.get(`/comments/${b.id}`, owner));
    expect(updated).toMatchObject({ duplicate_of_id: a.id, status: 'open' });
  });

  it('caches translations', async () => {
    const project = await createProject(owner);
    const c = await json(
      await api.post(`/projects/${project.id}/comments`, { body: 'ボタンが小さすぎます' }, owner),
    );
    const { request, fetchSpy } = withAnthropic({ text: 'The button is too small' });
    const first = await json(await request(`/comments/${c.id}/ai/translate`, { lang: 'en' }));
    expect(first).toEqual({ lang: 'en', body: 'The button is too small', cached: false });
    const second = await json(await request(`/comments/${c.id}/ai/translate`, { lang: 'en' }));
    expect(second.cached).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('integrations', () => {
  it('stores secrets sealed and never returns them', async () => {
    const project = await createProject(owner);
    const saved = await json(
      await api.put(
        `/projects/${project.id}/integrations/github`,
        { provider: 'github', owner: 'acme', repo: 'site', token: 'ghp_secret' },
        owner,
      ),
    );
    expect(saved).toMatchObject({
      provider: 'github',
      config: { owner: 'acme', repo: 'site' },
      has_secret: true,
    });
    expect(JSON.stringify(saved)).not.toContain('ghp_secret');
    const row = await env.DB.prepare('SELECT secret_ciphertext FROM integrations WHERE id = ?')
      .bind(saved.id)
      .first<{ secret_ciphertext: string }>();
    expect(row?.secret_ciphertext).toMatch(/^v1\./);
    expect(row?.secret_ciphertext).not.toContain('ghp_secret');

    const keep = await json(
      await api.put(
        `/projects/${project.id}/integrations/github`,
        { provider: 'github', owner: 'acme', repo: 'web' },
        owner,
      ),
    );
    expect(keep).toMatchObject({ config: { repo: 'web' }, has_secret: true });
  });

  it('creates a GitHub issue from a comment and links it back', async () => {
    const project = await createProject(owner);
    await api.put(
      `/projects/${project.id}/integrations/github`,
      { provider: 'github', owner: 'acme', repo: 'site', token: 'ghp_secret' },
      owner,
    );
    const comment = await json(
      await api.post(
        `/projects/${project.id}/comments`,
        { body: 'Header is misaligned', page_url: 'https://acme.example/' },
        owner,
      ),
    );
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json(
          { number: 42, html_url: 'https://github.com/acme/site/issues/42' },
          { status: 201 },
        ),
      );
    const response = await api.post(
      `/comments/${comment.id}/external-issue`,
      { provider: 'github' },
      owner,
    );
    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({
      provider: 'github',
      external_id: '42',
      url: 'https://github.com/acme/site/issues/42',
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/site/issues');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghp_secret');
    expect(JSON.parse(init.body as string).title).toBe(
      `[Croquis #${comment.number}] Header is misaligned`,
    );

    const again = await api.post(
      `/comments/${comment.id}/external-issue`,
      { provider: 'github' },
      owner,
    );
    expect(again.status).toBe(409);
    const detail = await json(await api.get(`/comments/${comment.id}`, owner));
    expect(detail.external_links).toHaveLength(1);
  });

  it('notifies Slack when feedback arrives', async () => {
    const project = await createProject(owner, { widget_mode: 'always' });
    await api.put(
      `/projects/${project.id}/integrations/slack`,
      { provider: 'slack', webhook_url: 'https://hooks.slack.com/services/T/B/X' },
      owner,
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    await api.post(`/projects/${project.id}/comments`, { body: 'New hero looks great' }, owner);
    const slack = fetchSpy.mock.calls.find(([u]) =>
      String(u).startsWith('https://hooks.slack.com/'),
    );
    expect(slack).toBeDefined();
    expect(JSON.parse((slack?.[1] as RequestInit).body as string).text).toContain(
      'New hero looks great',
    );
  });
});

describe('webhook management', () => {
  it('creates endpoints with a one-time secret and lists deliveries', async () => {
    const project = await createProject(owner);
    const created = await json(
      await api.post(
        `/projects/${project.id}/webhooks`,
        { url: 'https://hooks.example/in', event_types: ['comment.created'] },
        owner,
      ),
    );
    expect(created.secret).toMatch(/^whsec_/);
    const listed = await json(await api.get(`/projects/${project.id}/webhooks`, owner));
    expect(JSON.stringify(listed)).not.toContain(created.secret);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    await api.post(`/projects/${project.id}/comments`, { body: 'hello' }, owner);
    const deliveries = await json(await api.get(`/webhooks/${created.id}/deliveries`, owner));
    expect(deliveries.data).toEqual([
      expect.objectContaining({ event_type: 'comment.created', status: 'succeeded' }),
    ]);

    const insecure = await api.post(
      `/projects/${project.id}/webhooks`,
      { url: 'http://hooks.example/in' },
      owner,
    );
    expect(insecure.status).toBe(422);

    const test = await json(await api.post(`/webhooks/${created.id}/test`, {}, owner));
    expect(test).toEqual({ ok: true, status: 200, error: null });
  });
});
