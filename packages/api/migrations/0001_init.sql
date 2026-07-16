-- Croquis initial schema.
-- Foreign keys are declared for documentation; cascading deletes are performed
-- explicitly in code so behaviour does not depend on D1 PRAGMA foreign_keys.

CREATE TABLE projects (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL,
  api_token_hash      TEXT NOT NULL,
  ingest_key          TEXT NOT NULL UNIQUE,
  share_slug          TEXT NOT NULL UNIQUE,
  share_password_hash TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_projects_ingest_key ON projects (ingest_key);
CREATE INDEX idx_projects_share_slug ON projects (share_slug);

CREATE TABLE pages (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id),
  parent_id   TEXT REFERENCES pages (id),
  path        TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  purpose     TEXT NOT NULL DEFAULT '',
  audience    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'todo',
  sort_index  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_pages_project ON pages (project_id);
CREATE INDEX idx_pages_parent ON pages (parent_id);

CREATE TABLE content_blocks (
  id           TEXT PRIMARY KEY,
  page_id      TEXT NOT NULL REFERENCES pages (id),
  type         TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  content      TEXT NOT NULL DEFAULT '',
  ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_content_blocks_page ON content_blocks (page_id);

CREATE TABLE comments (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects (id),
  page_id          TEXT REFERENCES pages (id),
  page_url         TEXT NOT NULL,
  viewport         TEXT NOT NULL DEFAULT 'desktop',
  viewport_w       INTEGER,
  viewport_h       INTEGER,
  body             TEXT NOT NULL,
  author_name      TEXT,
  status           TEXT NOT NULL DEFAULT 'open',
  screenshot_key   TEXT,
  element_selector TEXT,
  element_tag      TEXT,
  element_text     TEXT,
  element_html     TEXT,
  element_context  TEXT,
  element_attrs    TEXT,
  computed_style   TEXT,
  rel_x            REAL,
  rel_y            REAL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_comments_project ON comments (project_id);
CREATE INDEX idx_comments_page ON comments (page_id);
CREATE INDEX idx_comments_status ON comments (status);

CREATE TABLE comment_replies (
  id          TEXT PRIMARY KEY,
  comment_id  TEXT NOT NULL REFERENCES comments (id),
  author_name TEXT,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_replies_comment ON comment_replies (comment_id);

CREATE TABLE members (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  name       TEXT NOT NULL,
  email      TEXT,
  role       TEXT NOT NULL DEFAULT 'editor',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_members_project ON members (project_id);
