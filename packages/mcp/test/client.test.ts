import { describe, it, expect, vi, afterEach } from 'vitest';
import { CroquisClient } from '../src/client';

afterEach(() => vi.restoreAllMocks());

describe('CroquisClient', () => {
  it('sends bearer auth and parses JSON, trimming a trailing slash in baseUrl', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ projects: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new CroquisClient({ baseUrl: 'https://api.test/', token: 'crq_x' });

    const res = await client.listProjects();
    expect(res.projects).toEqual([]);

    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe('https://api.test/projects');
    expect((call[1]?.headers as Record<string, string>).Authorization).toBe('Bearer crq_x');
  });

  it('throws on error responses with the API message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 401 })),
    );
    const client = new CroquisClient({ baseUrl: 'https://api.test', token: 't' });
    await expect(client.getProject('x')).rejects.toThrow(/401: nope/);
  });

  it('builds a query string for comment filters', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ comments: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new CroquisClient({ baseUrl: 'https://api.test', token: 't' });

    await client.listComments('p1', { status: 'open' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.test/projects/p1/comments?status=open');
  });
});
