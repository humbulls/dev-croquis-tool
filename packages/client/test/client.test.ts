import { describe, expect, it, vi } from 'vitest';
import { CroquisApiError, CroquisClient } from '../src/index';

function mockFetch(...responses: Response[]) {
  const fn = vi.fn<typeof fetch>();
  for (const response of responses) fn.mockResolvedValueOnce(response);
  return fn;
}

describe('CroquisClient', () => {
  it('builds /api/v1 URLs with CSV filters and sends the API key and client id', async () => {
    const fetch = mockFetch(Response.json({ data: [], next_cursor: null }));
    const client = new CroquisClient({
      baseUrl: 'https://croquis.example/',
      apiKey: 'crq_test',
      client: 'mcp/1.0',
      fetch,
    });
    await client.comments.list('p1', {
      status: ['open', 'in_review'],
      q: 'hero',
      limit: 10,
      page: undefined,
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://croquis.example/api/v1/projects/p1/comments?status=open%2Cin_review&q=hero&limit=10',
    );
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer crq_test',
      'X-Croquis-Client': 'mcp/1.0',
    });
    expect(init).not.toHaveProperty('credentials');
  });

  it('uses the session cookie when no key is given', async () => {
    const fetch = mockFetch(Response.json({ user: {}, workspaces: [] }));
    await new CroquisClient({ baseUrl: '', fetch }).me();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/me');
    expect(init.credentials).toBe('include');
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('throws problem details as CroquisApiError', async () => {
    const problem = {
      type: 'urn:croquis:error:comment_not_found',
      title: 'Not found',
      status: 404,
      code: 'comment_not_found',
      detail: 'nope',
    };
    const client = new CroquisClient({
      baseUrl: 'https://x',
      apiKey: 'k',
      fetch: mockFetch(Response.json(problem, { status: 404 })),
    });
    const error = await client.comments.get('c1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CroquisApiError);
    expect(error).toMatchObject({
      status: 404,
      code: 'comment_not_found',
      message: 'Not found: nope',
    });
  });

  it('falls back to a generic error for non-JSON failures', async () => {
    const client = new CroquisClient({
      baseUrl: 'https://x',
      apiKey: 'k',
      fetch: mockFetch(new Response('boom', { status: 502 })),
    });
    await expect(client.projects.list()).rejects.toMatchObject({ status: 502, code: 'http_error' });
  });

  it('returns undefined for 204 and text for Markdown exports', async () => {
    const client = new CroquisClient({
      baseUrl: 'https://x',
      apiKey: 'k',
      fetch: mockFetch(
        new Response(null, { status: 204 }),
        new Response('# Project', { headers: { 'Content-Type': 'text/markdown' } }),
      ),
    });
    await expect(client.comments.delete('c1')).resolves.toBeUndefined();
    await expect(client.projects.exportMarkdown('p1')).resolves.toBe('# Project');
  });

  it('iterates every page with paginate()', async () => {
    const fetch = mockFetch(
      Response.json({ data: [{ id: 'a' }, { id: 'b' }], next_cursor: 'c2' }),
      Response.json({ data: [{ id: 'c' }], next_cursor: null }),
    );
    const client = new CroquisClient({ baseUrl: 'https://x', apiKey: 'k', fetch });
    const ids: string[] = [];
    for await (const item of client.paginate((cursor) => client.projects.list({ cursor })))
      ids.push(item.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect((fetch.mock.calls[1] as [string])[0]).toContain('cursor=c2');
  });
});
