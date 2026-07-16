import { describe, it, expect } from 'vitest';
import { formatExportMarkdown, AI_EXPORT_SCHEMA_VERSION, type ProjectExport } from '../src';

let seq = 0;
const nextId = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function sample(): ProjectExport {
  const now = 1_700_000_000_000;
  const projectId = nextId();
  const pageId = nextId();
  return {
    schema_version: AI_EXPORT_SCHEMA_VERSION,
    exported_at: now,
    project: { id: projectId, name: 'Acme', slug: 'acme', created_at: now, updated_at: now },
    pages: [
      {
        id: pageId,
        project_id: projectId,
        parent_id: null,
        path: '/',
        title: 'Home',
        purpose: 'Convert visitors',
        audience: 'SMB owners',
        status: 'in_progress',
        sort_index: 0,
        created_at: now,
        updated_at: now,
        content_blocks: [
          {
            id: nextId(),
            page_id: pageId,
            type: 'heading',
            position: 0,
            content: 'Welcome',
            ai_generated: true,
            created_at: now,
            updated_at: now,
          },
        ],
        comments: [
          {
            id: nextId(),
            project_id: projectId,
            page_id: pageId,
            page_url: 'https://acme.test/',
            viewport: 'desktop',
            viewport_w: 1280,
            viewport_h: 800,
            body: 'Make the CTA bigger',
            author_name: 'Client',
            status: 'open',
            screenshot_key: null,
            element_selector: '.cta',
            element_tag: 'button',
            element_text: 'Buy',
            element_html: null,
            element_context: 'Hero section',
            element_attrs: null,
            computed_style: null,
            rel_x: 0.5,
            rel_y: 0.3,
            created_at: now,
            replies: [
              {
                id: nextId(),
                comment_id: pageId,
                author_name: 'Dev',
                body: 'Done',
                created_at: now,
              },
            ],
          },
        ],
      },
    ],
    orphan_comments: [],
  };
}

describe('formatExportMarkdown', () => {
  it('renders pages, content and comments', () => {
    const md = formatExportMarkdown(sample());
    expect(md).toContain('# Feedback export — Acme');
    expect(md).toContain('### `/` — Home  _(In progress)_');
    expect(md).toContain('`heading` _(AI draft)_: Welcome');
    expect(md).toContain('[ ] (open) `.cta` — Make the CTA bigger');
    expect(md).toContain('↳ Dev: Done');
    expect(md).toContain('- Open comments: 1');
  });
});
