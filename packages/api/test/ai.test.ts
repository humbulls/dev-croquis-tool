import { describe, it, expect } from 'vitest';
import { extractJson } from '../src/lib/ai';
import { aiSitemapPlanSchema, orderSitemapPlan } from '../src/lib/ai-plans';
import { createProject, json, jsonHeaders, request } from './helpers';

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('parses fenced JSON', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('parses JSON surrounded by prose', () => {
    expect(extractJson('Sure! [1,2,3] hope that helps')).toEqual([1, 2, 3]);
  });

  it('throws when no JSON exists', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('orderSitemapPlan', () => {
  it('orders parents before children and dedupes paths', () => {
    const plan = aiSitemapPlanSchema.parse([
      { path: '/a/b', parent_path: '/a' },
      { path: '/', parent_path: null },
      { path: '/a', parent_path: '/' },
      { path: '/a', parent_path: '/' }, // duplicate
    ]);
    const ordered = orderSitemapPlan(plan);
    const paths = ordered.map((p) => p.path);
    expect(paths).toEqual(['/', '/a', '/a/b']);
  });

  it('degrades cycles to roots without crashing', () => {
    const plan = aiSitemapPlanSchema.parse([
      { path: '/x', parent_path: '/y' },
      { path: '/y', parent_path: '/x' },
    ]);
    expect(orderSitemapPlan(plan)).toHaveLength(2);
  });
});

describe('AI routes (no provider configured in tests)', () => {
  it('returns 501 for sitemap generation without a provider', async () => {
    const project = await createProject('AI Test');
    const res = await request(`/projects/${project.id}/ai/sitemap`, {
      method: 'POST',
      headers: jsonHeaders(project.api_token),
      body: JSON.stringify({ brief: 'A bakery site' }),
    });
    expect(res.status).toBe(501);
  });

  it('validates page_id before calling the provider', async () => {
    const project = await createProject('AI Test 2');
    const res = await request(`/projects/${project.id}/ai/content`, {
      method: 'POST',
      headers: jsonHeaders(project.api_token),
      body: JSON.stringify({ page_id: crypto.randomUUID() }),
    });
    expect(res.status).toBe(400);
  });

  it('digest short-circuits without AI when there are no open comments', async () => {
    const project = await createProject('AI Test 3');
    const res = await request(`/projects/${project.id}/ai/digest`, {
      headers: jsonHeaders(project.api_token),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.open_count).toBe(0);
  });
});
