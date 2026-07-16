import { describe, it, expect } from 'vitest';
import {
  createProjectInput,
  createPageInput,
  createCommentInput,
  createCommentReplyInput,
  projectExportSchema,
  AI_EXPORT_SCHEMA_VERSION,
  PAGE_STATUSES,
  FIELD_LIMITS,
} from '../src';

describe('createProjectInput', () => {
  it('trims and accepts a valid name', () => {
    const parsed = createProjectInput.parse({ name: '  My Site  ' });
    expect(parsed.name).toBe('My Site');
  });

  it('rejects an empty name', () => {
    expect(createProjectInput.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('rejects a name over the limit', () => {
    const long = 'a'.repeat(FIELD_LIMITS.projectName + 1);
    expect(createProjectInput.safeParse({ name: long }).success).toBe(false);
  });
});

describe('createPageInput', () => {
  it('applies defaults', () => {
    const parsed = createPageInput.parse({ path: '/about' });
    expect(parsed.status).toBe('todo');
    expect(parsed.title).toBe('');
    expect(parsed.purpose).toBe('');
  });

  it('accepts every known status', () => {
    for (const status of PAGE_STATUSES) {
      expect(createPageInput.safeParse({ path: '/x', status }).success).toBe(true);
    }
  });

  it('rejects an unknown status', () => {
    expect(createPageInput.safeParse({ path: '/x', status: 'archived' }).success).toBe(false);
  });
});

describe('createCommentInput', () => {
  it('requires a non-empty body and page_url', () => {
    expect(createCommentInput.safeParse({ page_url: 'https://x.test', body: '' }).success).toBe(false);
    expect(createCommentInput.safeParse({ page_url: '', body: 'hi' }).success).toBe(false);
  });

  it('defaults nullable target fields to null and viewport to desktop', () => {
    const parsed = createCommentInput.parse({ page_url: 'https://x.test/', body: 'fix spacing' });
    expect(parsed.viewport).toBe('desktop');
    expect(parsed.element_selector).toBeNull();
    expect(parsed.computed_style).toBeNull();
    expect(parsed.screenshot).toBeNull();
  });
});

describe('createCommentReplyInput', () => {
  it('requires a body', () => {
    expect(createCommentReplyInput.safeParse({ body: '' }).success).toBe(false);
    expect(createCommentReplyInput.safeParse({ body: 'looks good' }).success).toBe(true);
  });
});

describe('projectExportSchema', () => {
  it('validates a minimal export envelope', () => {
    const now = Date.now();
    const result = projectExportSchema.safeParse({
      schema_version: AI_EXPORT_SCHEMA_VERSION,
      exported_at: now,
      project: {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Site',
        slug: 'site',
        created_at: now,
        updated_at: now,
      },
      pages: [],
      orphan_comments: [],
    });
    expect(result.success).toBe(true);
  });
});
