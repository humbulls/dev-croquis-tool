import type { Comment, ProjectWithStats } from '@croquis/client';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../lib/i18n';
import { clearQueries } from '../../lib/query';
import { me } from '../../lib/session';
import { InboxPage } from './InboxPage';

const project: ProjectWithStats = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: 'w1',
  name: 'Acme',
  slug: 'acme',
  description: '',
  ingest_key: 'ing_x',
  widget_mode: 'activated',
  created_at: 0,
  updated_at: 0,
  stats: { pages: 1, comments_active: 1, comments_unassigned: 0, comments_total: 1 },
};

const comment = {
  id: '22222222-2222-4222-8222-222222222222',
  project_id: project.id,
  page_id: null,
  number: 7,
  kind: 'bug',
  source: 'widget',
  status: 'open',
  priority: 'high',
  title: null,
  body: 'The pricing table overflows on mobile',
  body_lang: 'en',
  author: { type: 'guest', id: 'g1', name: 'Clara', verified: true },
  assignee: null,
  due_at: null,
  labels: [],
  page_url: 'https://acme.example/pricing',
  page_path: '/pricing',
  anchor: {
    status: 'anchored',
    selector: 'table.pricing',
    xpath: null,
    text_quote: null,
    tag: 'table',
    text: null,
    html: null,
    context: null,
    attrs: null,
    computed_style: null,
    rel_x: 0.5,
    rel_y: 0.5,
    doc_x: 1,
    doc_y: 2,
  },
  environment: {
    viewport: 'mobile',
    viewport_w: 390,
    viewport_h: 844,
    device_pixel_ratio: 3,
    user_agent: null,
    browser: 'Safari 18',
    os: 'iOS 18',
    language: 'en',
    build_id: null,
  },
  suggestion: null,
  duplicate_of_id: null,
  fix: null,
  resolved_at: null,
  reply_count: 0,
  screenshot: null,
  created_at: Date.now() - 60_000,
  updated_at: Date.now() - 60_000,
} as Comment;

function mockApi() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/comments?') || url.endsWith('/comments'))
      return Response.json({ data: [comment], next_cursor: null });
    if (url.includes(`/comments/${comment.id}`) && (init?.method ?? 'GET') === 'PATCH') {
      return Response.json({ ...comment, status: 'resolved' });
    }
    if (url.includes(`/comments/${comment.id}`))
      return Response.json({ ...comment, replies: [], attachments: [], external_links: [] });
    if (url.includes('/pages')) return Response.json({ data: [] });
    if (url.includes('/labels')) return Response.json({ data: [] });
    if (url.includes('/members')) return Response.json({ data: [] });
    if (url.includes('/integrations')) return Response.json({ data: [] });
    return Response.json({});
  });
}

beforeEach(() => {
  clearQueries();
  setLocale('en');
  me.value = {
    user: { id: 'u1', name: 'Olivia', email: 'o@example.com', image: null },
    workspaces: [{ id: 'w1', name: 'Acme', slug: 'acme', plan: 'free', role: 'owner' }],
  };
  history.replaceState(null, '', `/projects/${project.id}/inbox`);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InboxPage', () => {
  it('lists comments and opens the inspector, then changes the status', async () => {
    const fetchMock = mockApi();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LocationProvider>
        <InboxPage project={project} />
      </LocationProvider>,
    );
    const row = await screen.findByText('The pricing table overflows on mobile');
    expect(screen.getByText('#7')).toBeTruthy();
    fireEvent.click(row);
    await waitFor(() => expect(location.search).toContain(`comment=${comment.id}`));
    const inspector = await screen.findByRole('complementary', { name: '#7' });
    fireEvent.click(await within(inspector).findByRole('button', { name: /Status: Open/ }));
    fireEvent.click(await within(inspector).findByRole('menuitemradio', { name: 'Resolved' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) =>
            String(u).includes(`/comments/${comment.id}`) &&
            (i as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(
      ([, i]) => (i as RequestInit | undefined)?.method === 'PATCH',
    );
    const init = (patch as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({ status: 'resolved' });
  });
});
