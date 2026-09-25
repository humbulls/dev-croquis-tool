import type {
  Comment,
  CommentDetail,
  ContentBlock,
  PageWithStats,
  ProjectWithStats,
} from '@croquis/client';
import { fenceUntrusted, UNTRUSTED_NOTICE } from '@croquis/shared';

/**
 * Tool output is Markdown meant for a model to read. Anything a reviewer
 * typed is fenced as untrusted data (see UNTRUSTED_NOTICE) and every item
 * carries the id the next tool call needs.
 */

const indent = (text: string, spaces = 2) =>
  text
    .split('\n')
    .map((line) => `${' '.repeat(spaces)}${line}`)
    .join('\n');

export function projectLine(p: ProjectWithStats): string {
  const s = p.stats;
  return `- **${p.name}** (id \`${p.id}\`, workspace \`${p.workspace_id}\`) — ${s.pages} pages, ${s.comments_active} open comments${s.comments_unassigned ? ` (${s.comments_unassigned} not matched to a page)` : ''}, widget: ${p.widget_mode}`;
}

/** The sitemap as an indented tree. */
export function sitemapTree(pages: PageWithStats[]): string {
  if (pages.length === 0)
    return '_No pages yet._ Create one with croquis_create_page, or draft a sitemap with croquis_ai_draft_sitemap.';
  const children = new Map<string | null, PageWithStats[]>();
  const ids = new Set(pages.map((p) => p.id));
  for (const page of pages) {
    const parent = page.parent_id && ids.has(page.parent_id) ? page.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), page]);
  }
  const lines: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const page of (children.get(parent) ?? []).sort((a, b) => a.sort_index - b.sort_index)) {
      const flags = [
        page.status,
        page.comments_active ? `${page.comments_active} open comments` : null,
        page.approval ? `approval: ${page.approval}` : null,
      ].filter(Boolean);
      lines.push(
        `${'  '.repeat(depth)}- \`${page.path}\` ${page.title ? `“${page.title}” ` : ''}(id \`${page.id}\`; ${flags.join(', ')})`,
      );
      walk(page.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join('\n');
}

export function blocksText(blocks: ContentBlock[]): string {
  if (blocks.length === 0) return '_No content yet._';
  return blocks
    .map(
      (b) =>
        `### [${b.position}] ${b.type}${b.ai_generated ? ' (AI draft)' : ''} — id \`${b.id}\`\n${b.content}`,
    )
    .join('\n\n');
}

export function commentText(c: Comment | CommentDetail): string {
  const meta = [
    `status \`${c.status}\``,
    `priority \`${c.priority}\``,
    `kind \`${c.kind}\``,
    `by ${c.author.name ?? 'anonymous'} (${c.author.type}${c.author.verified ? ', verified' : ', UNVERIFIED'})`,
  ];
  const where = [
    `page: ${c.page_path}${c.page_id ? ` (page id \`${c.page_id}\`)` : ' (not matched to a page)'}`,
    c.page_url ? `url: ${c.page_url}` : null,
    c.anchor.selector ? `selector: \`${c.anchor.selector}\`` : null,
    c.anchor.text_quote ? `element text: “${c.anchor.text_quote}”` : null,
    `viewport: ${c.environment.viewport}${c.environment.viewport_w ? ` ${c.environment.viewport_w}×${c.environment.viewport_h}` : ''}`,
    c.environment.browser
      ? `browser: ${[c.environment.browser, c.environment.os].filter(Boolean).join(' / ')}`
      : null,
  ].filter(Boolean);
  const lines = [
    `#### #${c.number}${c.title ? ` ${c.title}` : ''} — id \`${c.id}\``,
    `- ${meta.join(' · ')}`,
    `- ${where.join(' · ')}`,
  ];
  if (c.assignee) lines.push(`- assignee: ${c.assignee.name}`);
  if (c.labels.length) lines.push(`- labels: ${c.labels.map((l) => l.name).join(', ')}`);
  if (c.duplicate_of_id) lines.push(`- duplicate of \`${c.duplicate_of_id}\``);
  if (c.fix)
    lines.push(
      `- fix reported: ${[c.fix.commit_sha, c.fix.pr_url, c.fix.deploy_url].filter(Boolean).join(' · ')}`,
    );
  lines.push(indent(fenceUntrusted(c.body)));
  if (c.suggestion) {
    lines.push('- suggested text change:');
    lines.push(indent(fenceUntrusted(`- ${c.suggestion.original}\n+ ${c.suggestion.text}`)));
  }
  if ('replies' in c && c.replies.length) {
    lines.push('- replies:');
    for (const r of c.replies) {
      const who = `${r.author.name ?? 'anonymous'}${r.internal ? ' (internal note)' : ''}`;
      lines.push(indent(`${who}:\n${fenceUntrusted(r.body)}`, 4));
    }
  }
  if ('attachments' in c && c.attachments.length) {
    lines.push(`- attachments: ${c.attachments.map((a) => `${a.kind} ${a.url}`).join(', ')}`);
  }
  return lines.join('\n');
}

export function commentsText(comments: Comment[], more: boolean): string {
  if (comments.length === 0) return 'No comments match these filters.';
  return [
    `> ${UNTRUSTED_NOTICE}`,
    '',
    ...comments.map(commentText),
    more ? '\n_More comments exist — narrow the filters or raise `limit`._' : '',
  ].join('\n\n');
}
