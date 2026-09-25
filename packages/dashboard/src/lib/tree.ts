import type { Page } from '@croquis/shared';

export interface PageNode {
  page: Page;
  depth: number;
  children: PageNode[];
}

/** Build a hierarchy of pages from a flat list (via parent_id). */
export function buildPageTree(pages: Page[]): PageNode[] {
  const byId = new Map<string, PageNode>();
  for (const page of pages) byId.set(page.id, { page, depth: 0, children: [] });

  const roots: PageNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.page.parent_id;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  // Cycle safety: nodes unreachable from any root (corrupt parent chains)
  // get their cycle edge broken and are promoted to roots instead of
  // silently disappearing from the tree.
  const reachable = new Set<string>();
  const mark = (nodes: PageNode[]): void => {
    for (const node of nodes) {
      if (reachable.has(node.page.id)) continue;
      reachable.add(node.page.id);
      mark(node.children);
    }
  };
  mark(roots);
  for (const node of byId.values()) {
    if (reachable.has(node.page.id)) continue;
    const parent = node.page.parent_id ? byId.get(node.page.parent_id) : undefined;
    if (parent) parent.children = parent.children.filter((child) => child !== node);
    roots.push(node);
    mark([node]);
  }

  const sortNodes = (nodes: PageNode[]): void => {
    nodes.sort(
      (a, b) => a.page.sort_index - b.page.sort_index || a.page.created_at - b.page.created_at,
    );
  };
  const assignDepth = (nodes: PageNode[], depth: number): void => {
    sortNodes(nodes);
    for (const node of nodes) {
      node.depth = depth;
      assignDepth(node.children, depth + 1);
    }
  };
  assignDepth(roots, 0);
  return roots;
}

/** Depth-first flatten to a render-ready list preserving order and depth. */
export function flattenTree(nodes: PageNode[]): PageNode[] {
  const out: PageNode[] = [];
  const walk = (list: PageNode[]): void => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
