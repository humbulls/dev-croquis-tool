-- Croquis v1 schema.
--
--   Identity & access   users, sessions, accounts, verifications (Better Auth),
--                       workspaces, workspace_members, workspace_invitations,
--                       api_keys
--   Production & review projects, project_origins, pages, page_path_aliases,
--                       content_blocks, comments, comment_replies, attachments,
--                       labels, comment_labels, comment_translations,
--                       guest_reviewers, share_links, review_rounds,
--                       page_approvals
--   Platform            activity_events, webhook_endpoints, webhook_deliveries,
--                       integrations, external_links, ai_runs
--
-- Conventions: UUID text primary keys; domain timestamps are epoch
-- milliseconds (INTEGER); Better Auth tables store ISO-8601 text dates.
-- D1 enforces foreign keys, so integrity lives in the schema (ON DELETE
-- CASCADE / SET NULL). Objects outside the database (R2) are removed in code.
--
-- Existing tables are rebuilt (https://sqlite.org/lang_altertable.html#otheralter)
-- in three passes, because D1 cannot turn foreign keys off inside a migration:
--   1. create every *_v1 table, referencing the other *_v1 tables, and copy data;
--   2. drop the old tables children-first, so no drop leaves a dangling child
--      row behind (SQLite's deferred-FK counter is never decremented by a
--      later RENAME, so parent-first drops fail at COMMIT);
--   3. rename *_v1 parent-first; RENAME rewrites every reference to the new name.
-- New tables that point at rebuilt ones are created after pass 3.

PRAGMA defer_foreign_keys = on;

-- ===========================================================================
-- Identity (Better Auth-owned; mapping in src/auth/schema-options.ts)
-- ===========================================================================

CREATE TABLE users (
  id             TEXT NOT NULL PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL,
  image          TEXT,
  created_at     DATE NOT NULL,
  updated_at     DATE NOT NULL
);

CREATE TABLE sessions (
  id                  TEXT NOT NULL PRIMARY KEY,
  expires_at          DATE NOT NULL,
  token               TEXT NOT NULL UNIQUE,
  created_at          DATE NOT NULL,
  updated_at          DATE NOT NULL,
  ip_address          TEXT,
  user_agent          TEXT,
  user_id             TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE accounts (
  id                       TEXT NOT NULL PRIMARY KEY,
  account_id               TEXT NOT NULL,
  provider_id              TEXT NOT NULL,
  user_id                  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  access_token             TEXT,
  refresh_token            TEXT,
  id_token                 TEXT,
  access_token_expires_at  DATE,
  refresh_token_expires_at DATE,
  scope                    TEXT,
  password                 TEXT,
  created_at               DATE NOT NULL,
  updated_at               DATE NOT NULL
);
CREATE INDEX accounts_user_id_idx ON accounts (user_id);

CREATE TABLE verifications (
  id         TEXT NOT NULL PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expires_at DATE NOT NULL,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL
);
CREATE INDEX verifications_identifier_idx ON verifications (identifier);

-- ===========================================================================
-- Workspaces (Croquis-owned tenancy; epoch-ms timestamps like the domain)
-- ===========================================================================

CREATE TABLE workspaces (
  id         TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  -- Croquis Cloud plan; self-hosted instances ignore quotas.
  plan       TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'beta', 'pro')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE workspace_members (
  id           TEXT NOT NULL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at   INTEGER NOT NULL,
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_id_idx ON workspace_members (user_id);

CREATE TABLE workspace_invitations (
  id           TEXT NOT NULL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'revoked')),
  -- SHA-256 of the token in the invitation link.
  token_hash   TEXT NOT NULL UNIQUE,
  inviter_id   TEXT REFERENCES users (id) ON DELETE SET NULL,
  expires_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX workspace_invitations_workspace_id_idx ON workspace_invitations (workspace_id, status);
CREATE INDEX workspace_invitations_email_idx ON workspace_invitations (email);

-- v0 installs had no workspaces: park their projects in one that the first
-- user claims through /setup.
INSERT INTO workspaces (id, name, slug, created_at, updated_at)
SELECT '00000000-0000-4000-8000-000000000001', 'Default workspace', 'default',
       CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE EXISTS (SELECT 1 FROM projects);

-- ===========================================================================
-- Pass 1a: rebuilt tables (*_v1) and new tables that depend on them
-- ===========================================================================

CREATE TABLE projects_v1 (
  id           TEXT NOT NULL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  -- Public, write-only key embedded in the widget.
  ingest_key   TEXT NOT NULL UNIQUE,
  -- When the widget shows up on the host page.
  widget_mode  TEXT NOT NULL DEFAULT 'activated'
               CHECK (widget_mode IN ('activated', 'always', 'off')),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (workspace_id, slug)
);

-- API keys replace the per-project tokens. project_id NULL = every project in
-- the workspace. Only a SHA-256 hash of the key is stored.
CREATE TABLE api_keys (
  id           TEXT NOT NULL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects_v1 (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  scopes       TEXT NOT NULL DEFAULT '["*"]',
  created_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  last_used_at INTEGER,
  expires_at   INTEGER,
  revoked_at   INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE share_links (
  id              TEXT NOT NULL PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects_v1 (id) ON DELETE CASCADE,
  slug            TEXT NOT NULL UNIQUE,
  label           TEXT NOT NULL DEFAULT '',
  -- pbkdf2$<iterations>$<salt>$<hash>; NULL = no password.
  password_hash   TEXT,
  allow_comments  INTEGER NOT NULL DEFAULT 1 CHECK (allow_comments IN (0, 1)),
  allow_approvals INTEGER NOT NULL DEFAULT 1 CHECK (allow_approvals IN (0, 1)),
  expires_at      INTEGER,
  revoked_at      INTEGER,
  created_by      TEXT REFERENCES users (id) ON DELETE SET NULL,
  last_viewed_at  INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE guest_reviewers (
  id           TEXT NOT NULL PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects_v1 (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  email        TEXT,
  -- SHA-256 of the reviewer token kept in the reviewer's browser.
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE pages_v1 (
  id         TEXT NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects_v1 (id) ON DELETE CASCADE,
  -- Code promotes children before deleting a parent; SET NULL is the backstop.
  parent_id  TEXT REFERENCES pages_v1 (id) ON DELETE SET NULL,
  path       TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  purpose    TEXT NOT NULL DEFAULT '',
  audience   TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (project_id, path)
);

CREATE TABLE content_blocks_v1 (
  id           TEXT NOT NULL PRIMARY KEY,
  page_id      TEXT NOT NULL REFERENCES pages_v1 (id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('heading', 'body', 'image', 'cta')),
  position     INTEGER NOT NULL DEFAULT 0,
  content      TEXT NOT NULL DEFAULT '',
  ai_generated INTEGER NOT NULL DEFAULT 0 CHECK (ai_generated IN (0, 1)),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE comments_v1 (
  id                  TEXT NOT NULL PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects_v1 (id) ON DELETE CASCADE,
  page_id             TEXT REFERENCES pages_v1 (id) ON DELETE SET NULL,
  -- Human-friendly per-project sequence ("#42").
  number              INTEGER NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'feedback'
                      CHECK (kind IN ('feedback', 'bug', 'text_edit', 'typo', 'question')),
  source              TEXT NOT NULL DEFAULT 'widget'
                      CHECK (source IN ('widget', 'share', 'dashboard', 'api', 'mcp', 'ai')),
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'in_progress', 'in_review', 'resolved', 'wont_fix')),
  priority            TEXT NOT NULL DEFAULT 'none'
                      CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')),
  title               TEXT,
  body                TEXT NOT NULL,
  body_lang           TEXT,
  -- Who wrote it: a member, a guest reviewer, or a name typed into the widget.
  author_user_id      TEXT REFERENCES users (id) ON DELETE SET NULL,
  author_guest_id     TEXT REFERENCES guest_reviewers (id) ON DELETE SET NULL,
  author_name         TEXT,
  -- 1 when the author is a member or an identified reviewer (prompt-injection guard).
  author_verified     INTEGER NOT NULL DEFAULT 0 CHECK (author_verified IN (0, 1)),
  assignee_user_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  due_at              INTEGER,
  -- Location
  page_url            TEXT NOT NULL,
  page_path           TEXT NOT NULL DEFAULT '/',
  -- Multi-anchor: any one of these can re-find the element.
  element_selector    TEXT,
  element_xpath       TEXT,
  element_text_quote  TEXT,
  element_tag         TEXT,
  element_text        TEXT,
  element_html        TEXT,
  element_context     TEXT,
  element_attrs       TEXT,
  computed_style      TEXT,
  rel_x               REAL,
  rel_y               REAL,
  doc_x               REAL,
  doc_y               REAL,
  anchor_status       TEXT NOT NULL DEFAULT 'anchored'
                      CHECK (anchor_status IN ('anchored', 'orphaned', 'page')),
  -- Environment
  viewport            TEXT NOT NULL DEFAULT 'desktop' CHECK (viewport IN ('desktop', 'tablet', 'mobile')),
  viewport_w          INTEGER,
  viewport_h          INTEGER,
  device_pixel_ratio  REAL,
  user_agent          TEXT,
  browser             TEXT,
  os                  TEXT,
  language            TEXT,
  build_id            TEXT,
  -- Text-edit suggestion
  suggestion_original TEXT,
  suggestion_text     TEXT,
  content_block_id    TEXT REFERENCES content_blocks_v1 (id) ON DELETE SET NULL,
  -- Triage and the agent loop
  duplicate_of_id     TEXT REFERENCES comments_v1 (id) ON DELETE SET NULL,
  fixed_commit_sha    TEXT,
  fixed_pr_url        TEXT,
  fixed_deploy_url    TEXT,
  fixed_at            INTEGER,
  resolved_at         INTEGER,
  resolved_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (project_id, number)
);

CREATE TABLE comment_replies_v1 (
  id              TEXT NOT NULL PRIMARY KEY,
  comment_id      TEXT NOT NULL REFERENCES comments_v1 (id) ON DELETE CASCADE,
  author_user_id  TEXT REFERENCES users (id) ON DELETE SET NULL,
  author_guest_id TEXT REFERENCES guest_reviewers (id) ON DELETE SET NULL,
  author_name     TEXT,
  body            TEXT NOT NULL,
  -- Internal notes are hidden from guests and the share viewer.
  internal        INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0, 1)),
  created_at      INTEGER NOT NULL
);

CREATE TABLE attachments (
  id           TEXT NOT NULL PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects_v1 (id) ON DELETE CASCADE,
  comment_id   TEXT REFERENCES comments_v1 (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('screenshot', 'console_log', 'network_log', 'file')),
  r2_key       TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size    INTEGER NOT NULL DEFAULT 0,
  width        INTEGER,
  height       INTEGER,
  created_at   INTEGER NOT NULL
);

-- ===========================================================================
-- Pass 1b: copy v0 data
-- ===========================================================================

INSERT INTO projects_v1 (id, workspace_id, name, slug, ingest_key, widget_mode, created_at, updated_at)
SELECT id,
       '00000000-0000-4000-8000-000000000001',
       name,
       CASE WHEN ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at) = 1
            THEN slug ELSE slug || '-' || substr(id, 1, 8) END,
       ingest_key,
       'always', -- v0 widgets were always on; keep existing embeds working
       created_at,
       updated_at
FROM projects;

-- v0 project tokens become project-scoped API keys (hash unchanged, so
-- existing MCP configurations keep working).
INSERT INTO api_keys (id, workspace_id, project_id, name, prefix, key_hash, scopes, created_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
         substr(lower(hex(randomblob(2))), 2) || '-' ||
         substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
         lower(hex(randomblob(6))),
       '00000000-0000-4000-8000-000000000001',
       id, 'Legacy project token', 'crq_', api_token_hash, '["*"]', created_at
FROM projects;

INSERT INTO share_links (id, project_id, slug, label, password_hash, allow_comments, allow_approvals, created_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
         substr(lower(hex(randomblob(2))), 2) || '-' ||
         substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
         lower(hex(randomblob(6))),
       id, share_slug, 'Legacy share link', share_password_hash, 0, 0, created_at
FROM projects;

INSERT INTO pages_v1 (id, project_id, parent_id, path, title, purpose, audience, status, sort_index, created_at, updated_at)
SELECT id, project_id, parent_id,
       CASE WHEN ROW_NUMBER() OVER (PARTITION BY project_id, path ORDER BY created_at) = 1
            THEN path ELSE path || '-' || id END,
       title, purpose, audience,
       CASE WHEN status IN ('todo', 'in_progress', 'review', 'done') THEN status ELSE 'todo' END,
       sort_index, created_at, updated_at
FROM pages;

INSERT INTO content_blocks_v1 (id, page_id, type, position, content, ai_generated, created_at, updated_at)
SELECT id, page_id,
       CASE WHEN type IN ('heading', 'body', 'image', 'cta') THEN type ELSE 'body' END,
       position, content, CASE WHEN ai_generated = 1 THEN 1 ELSE 0 END, created_at, updated_at
FROM content_blocks;

INSERT INTO comments_v1 (
  id, project_id, page_id, number, kind, source, status, priority, body, author_name,
  page_url, page_path, element_selector, element_tag, element_text, element_html,
  element_context, element_attrs, computed_style, rel_x, rel_y, anchor_status,
  viewport, viewport_w, viewport_h, resolved_at, created_at, updated_at
)
SELECT id, project_id, page_id,
       ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id),
       'feedback', 'widget',
       CASE WHEN status = 'resolved' THEN 'resolved' ELSE 'open' END,
       'none', body, author_name,
       page_url, '/', element_selector, element_tag, element_text, element_html,
       element_context, element_attrs, computed_style, rel_x, rel_y,
       CASE WHEN element_selector IS NULL THEN 'page' ELSE 'anchored' END,
       CASE WHEN viewport = 'mobile' THEN 'mobile' ELSE 'desktop' END,
       viewport_w, viewport_h,
       CASE WHEN status = 'resolved' THEN created_at END,
       created_at, created_at
FROM comments;

INSERT INTO comment_replies_v1 (id, comment_id, author_name, body, created_at)
SELECT id, comment_id, author_name, body, created_at FROM comment_replies;

INSERT INTO attachments (id, project_id, comment_id, kind, r2_key, content_type, created_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
         substr(lower(hex(randomblob(2))), 2) || '-' ||
         substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
         lower(hex(randomblob(6))),
       project_id, id, 'screenshot', screenshot_key,
       CASE WHEN screenshot_key LIKE '%.webp' THEN 'image/webp'
            WHEN screenshot_key LIKE '%.jpg' THEN 'image/jpeg'
            ELSE 'image/png' END,
       created_at
FROM comments
WHERE screenshot_key IS NOT NULL;

-- ===========================================================================
-- Pass 2: drop v0 tables, children first (members was never used)
-- ===========================================================================

DROP TABLE comment_replies;
DROP TABLE comments;
DROP TABLE content_blocks;
DROP TABLE members;
DROP TABLE pages;
DROP TABLE projects;

-- ===========================================================================
-- Pass 3: rename, parents first
-- ===========================================================================

ALTER TABLE projects_v1 RENAME TO projects;
ALTER TABLE pages_v1 RENAME TO pages;
ALTER TABLE content_blocks_v1 RENAME TO content_blocks;
ALTER TABLE comments_v1 RENAME TO comments;
ALTER TABLE comment_replies_v1 RENAME TO comment_replies;

-- ===========================================================================
-- New tables that reference the final names
-- ===========================================================================

-- Sites the widget may run on. Also used to turn a page URL into a Page path.
CREATE TABLE project_origins (
  id          TEXT NOT NULL PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- Normalized scheme://host[:port], lowercase, no trailing slash.
  origin      TEXT NOT NULL,
  -- Path the site is mounted under ('/' for most sites).
  base_path   TEXT NOT NULL DEFAULT '/',
  environment TEXT NOT NULL DEFAULT 'production'
              CHECK (environment IN ('production', 'staging', 'preview', 'local')),
  created_at  INTEGER NOT NULL,
  UNIQUE (project_id, origin)
);

CREATE TABLE labels (
  id         TEXT NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  -- Design-token color name, never a raw value.
  color      TEXT NOT NULL DEFAULT 'gray'
             CHECK (color IN ('gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink')),
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE comment_labels (
  comment_id TEXT NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  label_id   TEXT NOT NULL REFERENCES labels (id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, label_id)
);

CREATE TABLE comment_translations (
  comment_id TEXT NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  lang       TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, lang)
);

-- Extra paths that resolve to a page (learned when a comment is re-assigned).
CREATE TABLE page_path_aliases (
  id         TEXT NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  page_id    TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, path)
);

CREATE TABLE review_rounds (
  id          TEXT NOT NULL PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  preview_url TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER
);

CREATE TABLE page_approvals (
  id                TEXT NOT NULL PRIMARY KEY,
  page_id           TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  review_round_id   TEXT REFERENCES review_rounds (id) ON DELETE SET NULL,
  decision          TEXT NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  approver_user_id  TEXT REFERENCES users (id) ON DELETE SET NULL,
  approver_guest_id TEXT REFERENCES guest_reviewers (id) ON DELETE SET NULL,
  approver_name     TEXT NOT NULL,
  note              TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL
);

-- Every state change is recorded here in the same batch as the change itself,
-- then fanned out to webhooks and integrations (transactional outbox).
CREATE TABLE activity_events (
  id           TEXT NOT NULL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects (id) ON DELETE CASCADE,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('user', 'guest', 'api_key', 'agent', 'system')),
  actor_id     TEXT,
  actor_name   TEXT,
  type         TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  data         TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL
);

CREATE TABLE webhook_endpoints (
  id            TEXT NOT NULL PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  -- whsec_… signing secret (Standard Webhooks).
  secret        TEXT NOT NULL,
  -- JSON array of event types; ["*"] = all.
  event_types   TEXT NOT NULL DEFAULT '["*"]',
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE webhook_deliveries (
  id               TEXT NOT NULL PRIMARY KEY,
  endpoint_id      TEXT NOT NULL REFERENCES webhook_endpoints (id) ON DELETE CASCADE,
  event_id         TEXT NOT NULL REFERENCES activity_events (id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'succeeded', 'failed', 'dead')),
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  INTEGER,
  last_status_code INTEGER,
  last_error       TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (endpoint_id, event_id)
);

CREATE TABLE integrations (
  id                TEXT NOT NULL PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  provider          TEXT NOT NULL CHECK (provider IN ('github', 'linear', 'slack')),
  -- Non-secret settings (repo, team id, …) as JSON.
  config            TEXT NOT NULL DEFAULT '{}',
  -- Token / webhook URL encrypted with AES-GCM (ENCRYPTION_KEY secret).
  secret_ciphertext TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_by        TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (project_id, provider)
);

CREATE TABLE external_links (
  id             TEXT NOT NULL PRIMARY KEY,
  comment_id     TEXT NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  integration_id TEXT REFERENCES integrations (id) ON DELETE SET NULL,
  provider       TEXT NOT NULL,
  external_id    TEXT NOT NULL,
  url            TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  UNIQUE (comment_id, provider)
);

CREATE TABLE ai_runs (
  id            TEXT NOT NULL PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id    TEXT REFERENCES projects (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                CHECK (kind IN ('sitemap', 'content', 'digest', 'triage', 'typo_check', 'translate', 'title')),
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  input_tokens  INTEGER,
  output_tokens INTEGER,
  duration_ms   INTEGER NOT NULL,
  error         TEXT,
  actor_id      TEXT,
  created_at    INTEGER NOT NULL
);

-- ===========================================================================
-- Indexes (UNIQUE constraints above already cover their leading columns)
-- ===========================================================================

CREATE INDEX api_keys_workspace_id_idx ON api_keys (workspace_id);
CREATE INDEX share_links_project_id_idx ON share_links (project_id);
CREATE INDEX guest_reviewers_project_id_idx ON guest_reviewers (project_id);
CREATE INDEX pages_tree_idx ON pages (project_id, parent_id, sort_index);
CREATE INDEX page_path_aliases_page_id_idx ON page_path_aliases (page_id);
CREATE INDEX page_approvals_page_id_idx ON page_approvals (page_id, created_at);
CREATE INDEX review_rounds_project_id_idx ON review_rounds (project_id, created_at);
CREATE INDEX content_blocks_page_idx ON content_blocks (page_id, position);
CREATE INDEX comments_inbox_idx ON comments (project_id, status, created_at);
CREATE INDEX comments_page_id_idx ON comments (page_id);
CREATE INDEX comments_assignee_idx ON comments (assignee_user_id, status);
CREATE INDEX comments_duplicate_of_idx ON comments (duplicate_of_id);
CREATE INDEX comment_replies_comment_idx ON comment_replies (comment_id, created_at);
CREATE INDEX comment_labels_label_id_idx ON comment_labels (label_id);
CREATE INDEX attachments_comment_id_idx ON attachments (comment_id);
CREATE INDEX activity_events_project_idx ON activity_events (project_id, created_at);
CREATE INDEX activity_events_subject_idx ON activity_events (subject_type, subject_id);
CREATE INDEX webhook_endpoints_project_id_idx ON webhook_endpoints (project_id);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (status, next_attempt_at);
CREATE INDEX ai_runs_workspace_idx ON ai_runs (workspace_id, created_at);
