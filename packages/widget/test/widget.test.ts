import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config';
import { installDiagnostics, resetDiagnostics, snapshotDiagnostics } from '../src/diagnostics';
import { loadSession, saveSession, takeActivationSlug } from '../src/session';
import { CroquisWidget } from '../src/widget';

const API = 'https://croquis.example';
const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Acme site' };

function script(attrs: Record<string, string>): HTMLScriptElement {
  const el = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function respond(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    for (const [pattern, body] of Object.entries(routes)) {
      const [m, path] = pattern.split(' ') as [string, string];
      if (m === method && url.includes(path)) {
        return typeof body === 'function'
          ? (body as (i?: RequestInit) => Response)(init)
          : Response.json(body);
      }
    }
    return new Response('not mocked', { status: 500 });
  });
}

const shadow = () =>
  (document.querySelector('[data-croquis-widget]') as HTMLElement | null)?.shadowRoot ?? null;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML =
    '<main><h1>Pricing</h1><p class="lead">Simple plans for everyone</p></main>';
  localStorage.clear();
  history.replaceState(null, '', '/pricing');
  document.elementFromPoint = () => document.querySelector('.lead');
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelector('[data-croquis-widget]')?.remove();
});

describe('config', () => {
  it('reads the key from the script tag and the instance from its src', () => {
    const config = resolveConfig(
      script({ src: `${API}/widget.js`, 'data-croquis-key': 'ing_abc', 'data-croquis-lang': 'ja' }),
    );
    expect(config).toEqual({ apiUrl: API, ingestKey: 'ing_abc', lang: 'ja', buildId: null });
  });

  it('accepts the v0 attribute names and needs a key', () => {
    expect(
      resolveConfig(script({ 'data-croquis-api': `${API}/`, 'data-croquis-ingest-key': 'ing_x' }))
        ?.apiUrl,
    ).toBe(API);
    expect(resolveConfig(script({ src: `${API}/widget.js` }))).toBeNull();
  });
});

describe('session', () => {
  it('takes ?croquis= from the URL and removes it', () => {
    history.replaceState(null, '', '/pricing?croquis=abc123def456&utm=x');
    expect(takeActivationSlug()).toBe('abc123def456');
    expect(location.search).toBe('?utm=x');
  });

  it('expires stored sessions', () => {
    saveSession('p', {
      slug: 's',
      token: 't',
      expiresAt: Date.now() - 1,
      reviewerToken: 'r',
      reviewerName: 'A',
    });
    expect(loadSession('p')).toBeNull();
  });
});

describe('diagnostics', () => {
  it('records console errors and failed requests without query strings', async () => {
    resetDiagnostics();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 500 })),
    );
    installDiagnostics((url) => url.startsWith(API));
    console.error('Boom', new Error('bad'));
    await fetch('https://shop.example/api/cart?token=secret');
    await fetch(`${API}/api/v1/public/pins`);
    const snapshot = snapshotDiagnostics();
    expect(snapshot.console.at(-1)?.message).toContain('Error: bad');
    expect(snapshot.network).toEqual([
      expect.objectContaining({ url: 'https://shop.example/api/cart', status: 500, method: 'GET' }),
    ]);
  });
});

describe('widget', () => {
  it('stays hidden in activated mode without a review link', async () => {
    vi.stubGlobal(
      'fetch',
      respond({
        'GET /widget/config': {
          project: PROJECT,
          widget_mode: 'activated',
          requires_reviewer: true,
          turnstile_site_key: null,
        },
      }),
    );
    await new CroquisWidget({ apiUrl: API, ingestKey: 'ing_x', lang: 'en', buildId: null }).start();
    expect(shadow()).toBeNull();
  });

  it('lets anyone comment in always mode and submits the anchor', async () => {
    let sent: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      respond({
        'GET /widget/config': {
          project: PROJECT,
          widget_mode: 'always',
          requires_reviewer: false,
          turnstile_site_key: null,
        },
        'POST /ingest/comments': (init?: RequestInit) => {
          sent = JSON.parse(String(init?.body));
          return Response.json(
            { id: 'c1', number: 1, page_id: null, screenshot_stored: false },
            { status: 201 },
          );
        },
      }),
    );
    await new CroquisWidget({
      apiUrl: API,
      ingestKey: 'ing_x',
      lang: 'en',
      buildId: 'build-42',
    }).start();
    const root = shadow() as ShadowRoot;
    (root.querySelector('.cq-pill__action--primary') as HTMLButtonElement).click();
    expect(root.querySelector('.cq-hint')).not.toBeNull();

    (document.querySelector('.lead') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }),
    );
    const form = root.querySelector('.cq-composer') as HTMLFormElement;
    expect(form).not.toBeNull();
    (root.querySelector('[role="radio"]:nth-child(2)') as HTMLButtonElement).click();
    (form.querySelector('textarea') as HTMLTextAreaElement).value = 'Make this bolder';
    (form.querySelector('.cq-checkbox') as HTMLInputElement).checked = false;
    form.requestSubmit();
    await flush();
    await flush();

    expect(sent).toMatchObject({
      page_url: 'http://localhost:3000/pricing',
      body: 'Make this bolder',
      kind: 'bug',
      anchor: {
        selector: 'p.lead',
        text_quote: 'Simple plans for everyone',
        context: 'h1: Pricing',
      },
      environment: { build_id: 'build-42' },
      screenshot: null,
    });
    expect(root.querySelector('.cq-toast')?.textContent).toContain('Thanks');
  });

  it('starts a review session from a share link and shows pins', async () => {
    history.replaceState(null, '', '/pricing?croquis=abc123def456');
    const pins = vi.fn(() =>
      Response.json({
        data: [
          {
            id: 'c1',
            number: 3,
            body: 'Too long',
            status: 'open',
            resolved_at: null,
            anchor: {
              status: 'anchored',
              selector: 'p.lead',
              xpath: null,
              text_quote: 'Simple plans',
              rel_x: 0.5,
              rel_y: 0.5,
              doc_x: 0,
              doc_y: 0,
            },
          },
        ],
      }),
    );
    vi.stubGlobal(
      'fetch',
      respond({
        'GET /widget/config': {
          project: PROJECT,
          widget_mode: 'activated',
          requires_reviewer: true,
          turnstile_site_key: null,
        },
        'GET /share/abc123def456': {
          project: PROJECT,
          label: '',
          password_required: true,
          allow_comments: true,
          allow_approvals: true,
        },
        'POST /share/abc123def456/session': (init?: RequestInit) => {
          const body = JSON.parse(String(init?.body));
          if (body.password !== 'secret-pass')
            return Response.json(
              { code: 'invalid_password', title: 'Unauthorized' },
              { status: 401 },
            );
          return Response.json(
            {
              token: 'tok.sig',
              expires_at: Date.now() + 60_000,
              reviewer_token: 'rvw_1',
              reviewer: { id: 'r1', name: body.name },
            },
            { status: 201 },
          );
        },
        'GET /pins': pins,
      }),
    );
    await new CroquisWidget({ apiUrl: API, ingestKey: 'ing_x', lang: 'ja', buildId: null }).start();
    const root = shadow() as ShadowRoot;
    const gate = root.querySelector('.cq-gate') as HTMLFormElement;
    expect(gate.textContent).toContain('Acme site');
    (gate.querySelector('input[name="name"]') as HTMLInputElement).value = 'Clara';
    (gate.querySelector('input[name="password"]') as HTMLInputElement).value = 'wrong';
    gate.requestSubmit();
    await flush();
    expect(gate.textContent).toContain('パスワードが違います');

    (gate.querySelector('input[name="password"]') as HTMLInputElement).value = 'secret-pass';
    gate.requestSubmit();
    await flush();
    await flush();
    expect(loadSession(PROJECT.id)).toMatchObject({
      token: 'tok.sig',
      reviewerName: 'Clara',
      slug: 'abc123def456',
    });
    expect(pins).toHaveBeenCalled();
    expect(root.querySelector('.cq-pin')?.textContent).toBe('3');
    expect(location.search).toBe('');
  });
});

describe('dom helper', () => {
  it('sets textarea values as properties', async () => {
    const { h } = await import('../src/ui/dom');
    const area = h('textarea', { value: 'Hello', rows: 2 });
    expect(area.value).toBe('Hello');
    const input = h('input', { value: 'Name', 'aria-label': 'x' });
    expect(input.value).toBe('Name');
    expect(input.getAttribute('aria-label')).toBe('x');
  });
});
