import { PAGE_STATUS_LABELS } from './constants';
import type { CommentWithReplies, ProjectExport } from './schemas';

/**
 * Render a project export as Markdown — the "hand this to Claude/GPT" format.
 * Human-readable and LLM-friendly: page hierarchy, draft content and every
 * open/resolved review comment with its element context and replies.
 */
export function formatExportMarkdown(data: ProjectExport): string {
  const lines: string[] = [];
  const date = new Date(data.exported_at).toISOString();

  lines.push(`# Feedback export — ${data.project.name}`);
  lines.push('');
  lines.push(`- Schema: \`${data.schema_version}\``);
  lines.push(`- Exported: ${date}`);
  lines.push(`- Pages: ${data.pages.length}`);
  const openCount = countOpen(data);
  lines.push(`- Open comments: ${openCount}`);
  lines.push('');

  if (data.pages.length > 0) {
    lines.push('## Pages');
    lines.push('');
    for (const page of data.pages) {
      const status = PAGE_STATUS_LABELS[page.status];
      const title = page.title ? ` — ${page.title}` : '';
      lines.push(`### \`${page.path}\`${title}  _(${status})_`);
      if (page.purpose) lines.push(`- Purpose: ${page.purpose}`);
      if (page.audience) lines.push(`- Audience: ${page.audience}`);
      lines.push('');

      if (page.content_blocks.length > 0) {
        lines.push('**Content**');
        for (const block of page.content_blocks) {
          const flag = block.ai_generated ? ' _(AI draft)_' : '';
          lines.push(`- \`${block.type}\`${flag}: ${oneLine(block.content)}`);
        }
        lines.push('');
      }

      if (page.comments.length > 0) {
        lines.push(`**Review comments (${page.comments.length})**`);
        for (const comment of page.comments) lines.push(...renderComment(comment));
        lines.push('');
      }
    }
  }

  if (data.orphan_comments.length > 0) {
    lines.push('## Unlinked comments');
    lines.push('');
    for (const comment of data.orphan_comments) lines.push(...renderComment(comment));
    lines.push('');
  }

  return lines.join('\n');
}

function countOpen(data: ProjectExport): number {
  let n = 0;
  for (const page of data.pages) n += page.comments.filter((c) => c.status === 'open').length;
  n += data.orphan_comments.filter((c) => c.status === 'open').length;
  return n;
}

function renderComment(comment: CommentWithReplies): string[] {
  const box = comment.status === 'resolved' ? '[x]' : '[ ]';
  const target = comment.element_selector ? ` \`${comment.element_selector}\`` : '';
  const out: string[] = [`- ${box} (${comment.status})${target} — ${oneLine(comment.body)}`];
  const meta: string[] = [];
  if (comment.element_context) meta.push(`context: ${oneLine(comment.element_context)}`);
  if (comment.page_url) meta.push(`url: ${comment.page_url}`);
  if (comment.viewport) meta.push(`viewport: ${comment.viewport}`);
  if (meta.length > 0) out.push(`  - ${meta.join(' · ')}`);
  for (const reply of comment.replies) {
    const who = reply.author_name ? `${reply.author_name}: ` : '';
    out.push(`  - ↳ ${who}${oneLine(reply.body)}`);
  }
  return out;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
