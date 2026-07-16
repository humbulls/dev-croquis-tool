import { describe, it, expect } from 'vitest';
import type { Page } from '@croquis/shared';
import { buildPageTree, flattenTree } from './tree';

function page(id: string, parentId: string | null, sortIndex: number, path: string): Page {
  return {
    id,
    project_id: 'p',
    parent_id: parentId,
    path,
    title: '',
    purpose: '',
    audience: '',
    status: 'todo',
    sort_index: sortIndex,
    created_at: 0,
    updated_at: 0,
  };
}

describe('buildPageTree / flattenTree', () => {
  it('nests children under parents with depth and sort order', () => {
    const pages = [
      page('a', null, 1, '/a'),
      page('root', null, 0, '/'),
      page('a1', 'a', 1, '/a/1'),
      page('a0', 'a', 0, '/a/0'),
    ];
    const flat = flattenTree(buildPageTree(pages));
    expect(flat.map((n) => n.page.id)).toEqual(['root', 'a', 'a0', 'a1']);
    expect(flat.map((n) => n.depth)).toEqual([0, 0, 1, 1]);
  });

  it('treats an unknown parent_id as a root', () => {
    const pages = [page('orphan', 'missing', 0, '/orphan')];
    const roots = buildPageTree(pages);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.page.id).toBe('orphan');
    expect(roots[0]!.depth).toBe(0);
  });

  it('recovers pages caught in a parent cycle instead of dropping them', () => {
    const pages = [
      page('root', null, 0, '/'),
      page('a', 'b', 0, '/a'),
      page('b', 'a', 1, '/b'),
      page('self', 'self', 2, '/self'),
    ];
    const flat = flattenTree(buildPageTree(pages));
    const ids = flat.map((n) => n.page.id).sort();
    expect(ids).toEqual(['a', 'b', 'root', 'self']); // nothing lost
    expect(flat).toHaveLength(4); // nothing duplicated
  });
});
