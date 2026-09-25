import { describe, expect, it } from 'vitest';
import {
  commentListQuery,
  createApiKeyInput,
  createPageInput,
  createProjectInput,
  createWebhookInput,
  FIELD_LIMITS,
  fixCommentInput,
  ingestCommentInput,
  PAGE_STATUSES,
  updateCommentInput,
  updatePageInput,
  upsertIntegrationInput,
} from '../src';

const UUID = '00000000-0000-4000-8000-000000000001';

describe('projects', () => {
  it('trims names and applies defaults', () => {
    const parsed = createProjectInput.parse({ name: '  My Site  ' });
    expect(parsed).toMatchObject({ name: 'My Site', description: '', widget_mode: 'activated' });
  });
  it('rejects empty and oversized names', () => {
    expect(createProjectInput.safeParse({ name: '   ' }).success).toBe(false);
    expect(
      createProjectInput.safeParse({ name: 'a'.repeat(FIELD_LIMITS.projectName + 1) }).success,
    ).toBe(false);
  });
});

describe('pages', () => {
  it('requires a leading slash and accepts every status', () => {
    expect(createPageInput.safeParse({ path: 'about' }).success).toBe(false);
    for (const status of PAGE_STATUSES) {
      expect(createPageInput.safeParse({ path: '/x', status }).success).toBe(true);
    }
  });
  it('PATCH schema never injects defaults', () => {
    expect(updatePageInput.parse({ status: 'done' })).toEqual({ status: 'done' });
    expect(updateCommentInput.parse({ priority: 'high' })).toEqual({ priority: 'high' });
  });
});

describe('ingestCommentInput (widget)', () => {
  it('accepts a minimal payload and defaults the kind', () => {
    const parsed = ingestCommentInput.parse({ page_url: 'https://x.test/', body: 'fix spacing' });
    expect(parsed.kind).toBe('feedback');
    expect(parsed.anchor).toBeUndefined();
  });
  it('rejects non-http URLs, empty bodies and out-of-range anchors', () => {
    expect(
      ingestCommentInput.safeParse({ page_url: 'javascript:alert(1)', body: 'x' }).success,
    ).toBe(false);
    expect(ingestCommentInput.safeParse({ page_url: 'https://x.test', body: '  ' }).success).toBe(
      false,
    );
    expect(
      ingestCommentInput.safeParse({ page_url: 'https://x.test', body: 'x', anchor: { rel_x: 2 } })
        .success,
    ).toBe(false);
  });
  it('caps diagnostics entries', () => {
    const entries = Array.from({ length: FIELD_LIMITS.diagnosticsEntries + 1 }, (_, i) => ({
      level: 'error' as const,
      message: `e${i}`,
      at: 1,
    }));
    expect(
      ingestCommentInput.safeParse({
        page_url: 'https://x.test',
        body: 'x',
        diagnostics: { console: entries },
      }).success,
    ).toBe(false);
  });
});

describe('fixCommentInput (agent loop)', () => {
  it('needs at least one piece of evidence', () => {
    expect(fixCommentInput.safeParse({}).success).toBe(false);
    expect(fixCommentInput.parse({ commit_sha: 'abc1234' }).status).toBe('in_review');
  });
  it('validates the SHA format', () => {
    expect(fixCommentInput.safeParse({ commit_sha: 'not-a-sha' }).success).toBe(false);
  });
});

describe('commentListQuery', () => {
  it('parses comma-separated filters and coerces limit', () => {
    const q = commentListQuery.parse({ status: 'open,in_review', limit: '20', page: 'unassigned' });
    expect(q.status).toEqual(['open', 'in_review']);
    expect(q.limit).toBe(20);
    expect(q.page).toBe('unassigned');
    expect(q.sort).toBe('newest');
  });
  it('rejects unknown statuses and oversized limits', () => {
    expect(commentListQuery.safeParse({ status: 'open,bogus' }).success).toBe(false);
    expect(commentListQuery.safeParse({ limit: '1000' }).success).toBe(false);
  });
});

describe('platform inputs', () => {
  it('webhooks must be https', () => {
    expect(createWebhookInput.safeParse({ url: 'http://example.com/hook' }).success).toBe(false);
    expect(createWebhookInput.parse({ url: 'https://example.com/hook' }).event_types).toEqual([
      '*',
    ]);
  });
  it('integration input is discriminated by provider', () => {
    expect(
      upsertIntegrationInput.safeParse({ provider: 'github', owner: 'a', repo: 'b' }).success,
    ).toBe(true);
    expect(upsertIntegrationInput.safeParse({ provider: 'github', owner: 'a' }).success).toBe(
      false,
    );
    expect(upsertIntegrationInput.safeParse({ provider: 'jira' }).success).toBe(false);
  });
  it('api keys default to full scope', () => {
    expect(createApiKeyInput.parse({ name: 'CI', project_id: UUID }).scopes).toEqual(['*']);
    expect(createApiKeyInput.safeParse({ name: 'x', scopes: ['admin:all'] }).success).toBe(false);
  });
});
