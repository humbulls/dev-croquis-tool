/**
 * Migration tests (Node + better-sqlite3, which is the same SQLite engine D1
 * runs). They prove that 0002 upgrades a populated v0 database without losing
 * data, leaves no foreign-key violations, and also applies to a fresh install.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

function apply(db: Database.Database, file: string): void {
  // D1 runs each migration file in a transaction with foreign keys enforced.
  db.exec('BEGIN');
  db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  db.exec('COMMIT');
}

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

function seedV0(db: Database.Database): void {
  const t = 1_700_000_000_000;
  const insertProject = db.prepare(
    `INSERT INTO projects (id, name, slug, api_token_hash, ingest_key, share_slug, share_password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertProject.run('p1', 'Acme', 'acme', 'hash-1', 'ing_1', 'share1', null, t, t);
  // Same slug as p1: the v1 UNIQUE (workspace_id, slug) must not reject it.
  insertProject.run(
    'p2',
    'Acme',
    'acme',
    'hash-2',
    'ing_2',
    'share2',
    'pbkdf2$1$aa$bb',
    t + 1,
    t + 1,
  );

  const insertPage = db.prepare(
    `INSERT INTO pages (id, project_id, parent_id, path, title, purpose, audience, status, sort_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?, ?)`,
  );
  insertPage.run('pg-root', 'p1', null, '/', 'Home', 'done', 0, t, t);
  insertPage.run('pg-child', 'p1', 'pg-root', '/about', 'About', 'todo', 0, t, t);
  // Duplicate path in one project (v0 allowed it).
  insertPage.run('pg-dup', 'p1', null, '/about', 'About again', 'weird', 1, t + 5, t + 5);

  db.prepare(
    `INSERT INTO content_blocks (id, page_id, type, position, content, ai_generated, created_at, updated_at)
     VALUES ('cb1', 'pg-root', 'heading', 0, 'Welcome', 1, ?, ?)`,
  ).run(t, t);

  const insertComment = db.prepare(
    `INSERT INTO comments (id, project_id, page_id, page_url, viewport, body, status, screenshot_key, element_selector, created_at)
     VALUES (?, 'p1', ?, 'https://acme.test/', 'desktop', ?, ?, ?, ?, ?)`,
  );
  insertComment.run('c1', 'pg-root', 'First', 'open', 'screenshots/p1/a.png', '.hero', t);
  insertComment.run('c2', null, 'Second', 'resolved', null, null, t + 10);

  db.prepare(
    `INSERT INTO comment_replies (id, comment_id, author_name, body, created_at) VALUES ('r1', 'c1', 'Dev', 'Done', ?)`,
  ).run(t + 20);
  db.prepare(
    `INSERT INTO members (id, project_id, name, email, role, created_at) VALUES ('m1', 'p1', 'X', NULL, 'editor', ?)`,
  ).run(t);
}

describe('migrations', () => {
  it('there is at least the v0 and v1 migration, applied in lexical order', () => {
    expect(files[0]).toBe('0001_init.sql');
    expect(files).toContain('0002_v1.sql');
  });

  it('apply cleanly to an empty database (fresh install)', () => {
    const db = freshDb();
    for (const f of files) apply(db, f);
    expect(db.prepare('SELECT COUNT(*) AS n FROM workspaces').get()).toEqual({ n: 0 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('upgrade a populated v0 database without losing data', () => {
    const db = freshDb();
    apply(db, '0001_init.sql');
    seedV0(db);
    for (const f of files.slice(1)) apply(db, f);

    expect(db.pragma('foreign_key_check')).toEqual([]);

    // One default workspace owns every v0 project.
    const ws = db.prepare('SELECT id, slug FROM workspaces').all();
    expect(ws).toEqual([{ id: '00000000-0000-4000-8000-000000000001', slug: 'default' }]);
    const projects = db
      .prepare('SELECT id, slug, widget_mode FROM projects ORDER BY created_at')
      .all() as { id: string; slug: string; widget_mode: string }[];
    expect(projects.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(projects[0]!.slug).toBe('acme');
    expect(projects[1]!.slug).toBe('acme-p2'); // de-duplicated
    expect(projects.every((p) => p.widget_mode === 'always')).toBe(true);

    // Project tokens became project-scoped API keys (same hash).
    const keys = db
      .prepare('SELECT project_id, key_hash, id FROM api_keys ORDER BY project_id')
      .all() as { project_id: string; key_hash: string; id: string }[];
    expect(keys.map((k) => [k.project_id, k.key_hash])).toEqual([
      ['p1', 'hash-1'],
      ['p2', 'hash-2'],
    ]);
    expect(keys[0]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // Share slugs and password hashes became share links.
    const links = db
      .prepare('SELECT project_id, slug, password_hash FROM share_links ORDER BY project_id')
      .all();
    expect(links).toEqual([
      { project_id: 'p1', slug: 'share1', password_hash: null },
      { project_id: 'p2', slug: 'share2', password_hash: 'pbkdf2$1$aa$bb' },
    ]);

    // Pages keep their tree; the duplicate path is renamed; bad status normalized.
    const pages = db
      .prepare('SELECT id, parent_id, path, status FROM pages ORDER BY created_at, id')
      .all() as { id: string; parent_id: string | null; path: string; status: string }[];
    expect(pages.find((p) => p.id === 'pg-child')?.parent_id).toBe('pg-root');
    expect(pages.find((p) => p.id === 'pg-dup')?.path).toBe('/about-pg-dup');
    expect(pages.find((p) => p.id === 'pg-dup')?.status).toBe('todo');

    expect(db.prepare('SELECT ai_generated FROM content_blocks WHERE id = ?').get('cb1')).toEqual({
      ai_generated: 1,
    });

    // Comments get per-project numbers, statuses map, screenshots become attachments.
    const comments = db
      .prepare(
        'SELECT id, number, status, anchor_status, resolved_at FROM comments ORDER BY number',
      )
      .all() as {
      id: string;
      number: number;
      status: string;
      anchor_status: string;
      resolved_at: number | null;
    }[];
    expect(comments.map((c) => [c.id, c.number, c.status, c.anchor_status])).toEqual([
      ['c1', 1, 'open', 'anchored'],
      ['c2', 2, 'resolved', 'page'],
    ]);
    expect(comments[1]!.resolved_at).not.toBeNull();
    expect(db.prepare('SELECT comment_id, kind, r2_key FROM attachments').all()).toEqual([
      { comment_id: 'c1', kind: 'screenshot', r2_key: 'screenshots/p1/a.png' },
    ]);
    expect(db.prepare('SELECT id, comment_id, internal FROM comment_replies').all()).toEqual([
      { id: 'r1', comment_id: 'c1', internal: 0 },
    ]);

    // The unused v0 members table is gone.
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'members'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it('rebuilt tables reference their final names (RENAME rewrote self-references)', () => {
    const db = freshDb();
    for (const f of files) apply(db, f);
    const sql = (name: string) =>
      (db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name) as { sql: string }).sql;
    expect(sql('pages')).toMatch(/REFERENCES "?pages"?\s*\(id\)/);
    expect(sql('comments')).toMatch(/REFERENCES "?comments"?\s*\(id\)/);
    expect(sql('attachments')).toMatch(/REFERENCES "?comments"?\s*\(id\)/);
    expect(sql('api_keys')).toMatch(/REFERENCES "?projects"?\s*\(id\)/);
    for (const name of ['pages', 'comments', 'attachments', 'api_keys', 'share_links']) {
      expect(sql(name)).not.toMatch(/_v1/);
    }
  });

  it('cascades: deleting a project removes its dependent rows', () => {
    const db = freshDb();
    apply(db, '0001_init.sql');
    seedV0(db);
    for (const f of files.slice(1)) apply(db, f);
    db.prepare('DELETE FROM projects WHERE id = ?').run('p1');
    for (const table of [
      'pages',
      'content_blocks',
      'comments',
      'comment_replies',
      'attachments',
      'api_keys',
      'share_links',
    ]) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} t`).get() as { n: number };
      if (table === 'api_keys' || table === 'share_links')
        expect(row.n).toBe(1); // p2's
      else expect(row.n).toBe(0);
    }
  });
});
