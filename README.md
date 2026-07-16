# Croquis

**AI-native web production platform — sitemap, content drafts and visual review, unified around pages.**

Croquis (クロッキー, "quick sketch") takes a web project from structure to sign-off in one place:

- 🗺 **Sitemap** — plan the page tree (hierarchy, purpose, audience, status)
- ✍️ **Content** — draft each page as typed blocks (heading / body / image / CTA)
- 💬 **Review** — clients right-click any element on the live site to leave comments, captured with **rich element metadata** (CSS selector, computed styles, DOM context, heading trail, screenshot)
- 🤖 **AI-first** — generate sitemap drafts and page copy from a brief, digest open comments into a prioritized action plan, export everything as LLM-ready JSON/Markdown, and operate it all from Claude Code via the bundled **MCP server**

Self-hosted on Cloudflare (Workers + D1 + R2) — runs comfortably in the free tier.

## Why Croquis?

| | Typical feedback tools | Croquis |
|---|---|---|
| Captured context | element selector only | selector + computed style + outer HTML + heading context + viewport + screenshot |
| AI integration | none | MCP server + versioned JSON/Markdown export designed for LLM agents |
| Scope | review only | sitemap → content → review, one `Page` entity end-to-end |
| Hosting | vendor SaaS | your Cloudflare account (AGPL-3.0, self-hosted) |

The loop this enables: a client right-clicks "make this CTA bigger" → the comment lands with the exact selector and computed styles → you (or Claude Code, via MCP) read it, fix it, reply and resolve — without leaving the editor.

## Architecture

```
┌────────────────────────────────────────────┐
│ Any website                                │
│   <script src="croquis-widget.js"          │  @croquis/widget
│           data-croquis-ingest-key="ing_…"> │  Shadow DOM, right-click → comment
└──────────────┬─────────────────────────────┘
               │ POST /ingest/comments (write-only ingest key)
               ▼
┌────────────────────────────────────────────┐
│ Cloudflare Workers (Hono) + D1 + R2        │  @croquis/api
│  multi-tenant: admin / project token /     │
│  ingest key / share link (+password)       │
└──────┬─────────────────────┬───────────────┘
       │                     │
       ▼                     ▼
┌──────────────┐   ┌─────────────────────────┐
│ Dashboard    │   │ MCP server (stdio)      │  @croquis/mcp
│ Preact+Vite  │   │ 14 tools for Claude Code│
└──────────────┘   └─────────────────────────┘
```

**Monorepo** (pnpm workspaces):

| Package | What it is |
|---|---|
| `@croquis/shared` | Zod schemas, types, constants, Markdown export — single source of truth |
| `@croquis/tokens` | W3C-DTCG design tokens → generated `--cq-*` CSS custom properties + typed TS map |
| `@croquis/api` | Workers + Hono + D1 + R2 multi-tenant API |
| `@croquis/dashboard` | Admin UI (Preact + Vite, ITCSS + BEM, tokens only) |
| `@croquis/widget` | Embeddable feedback widget (vanilla TS, Shadow DOM, single IIFE) |
| `@croquis/mcp` | MCP server exposing the whole platform to AI agents |

## Quickstart (local)

Prerequisites: Node ≥ 22, pnpm ≥ 10.

```bash
git clone <this repo> croquis && cd croquis
pnpm install
pnpm build                       # generates tokens + builds everything

# 1. API (terminal A)
cd packages/api
cp .dev.vars.example .dev.vars   # set ADMIN_TOKEN
pnpm migrate:local               # apply D1 migrations locally
pnpm dev                         # http://localhost:8787

# 2. Dashboard (terminal B)
pnpm dev:dashboard               # http://localhost:5173
# connect with API URL + your ADMIN_TOKEN, create a project
```

Embed the widget on any page you want reviewed:

```html
<script
  src="/path/to/croquis-widget.js"
  data-croquis-api="http://localhost:8787"
  data-croquis-ingest-key="ing_…"   <!-- from project creation -->
></script>
```

Right-click any element → comment → it appears in the dashboard's Review tab.

## Deploy to Cloudflare

```bash
cd packages/api
wrangler d1 create croquis            # put database_id into wrangler.jsonc
wrangler r2 bucket create croquis-screenshots
wrangler d1 migrations apply croquis --remote
wrangler secret put ADMIN_TOKEN
wrangler deploy
```

Host the dashboard anywhere static (Cloudflare Pages works well: `pnpm --filter @croquis/dashboard build` → deploy `packages/dashboard/dist`). Serve `packages/widget/dist/croquis-widget.js` from any static host or R2.

## Claude Code / MCP

```jsonc
// .mcp.json
{
  "mcpServers": {
    "croquis": {
      "command": "node",
      "args": ["<repo>/packages/mcp/dist/index.js"],
      "env": {
        "CROQUIS_API_URL": "https://croquis-api.<you>.workers.dev",
        "CROQUIS_TOKEN": "<admin or project token>"
      }
    }
  }
}
```

17 tools: `croquis_list_projects`, `croquis_get_project`, `croquis_create_project`, `croquis_list_pages`, `croquis_create_page`, `croquis_update_page`, `croquis_list_content_blocks`, `croquis_create_content_block`, `croquis_list_comments`, `croquis_get_comment`, `croquis_resolve_comment`, `croquis_reply_comment`, `croquis_export_project`, `croquis_export_project_markdown`, `croquis_generate_sitemap`, `croquis_generate_content`, `croquis_digest_comments`.

Typical prompts: *"list the open review comments and fix each one in the code, then resolve them"* / *"generate the sitemap for a bakery brand site and draft the homepage copy"*.

## AI generation

Configure a provider on the API (Wrangler secret / `.dev.vars`):

| Env | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | enables AI endpoints (`501` otherwise) |
| `AI_PROVIDER` | force `anthropic` / `openai` (default: first key found) |
| `AI_MODEL` | override model (defaults: `claude-sonnet-5` / `gpt-5-mini`) |

| Endpoint | What it does |
|---|---|
| `POST /projects/:id/ai/sitemap` `{brief}` | drafts a page tree from a brief and inserts the pages |
| `POST /projects/:id/ai/content` `{page_id, brief?}` | drafts content blocks for a page (marked `ai_generated`) |
| `GET /projects/:id/ai/digest` | prioritized Markdown digest of open comments (selectors included) |

## Design system: no hardcoded values

Croquis enforces its own design discipline mechanically:

- All design values live in **DTCG token JSON** (`packages/tokens/src/*.tokens.json`) — a dependency-free generator emits `--cq-*` CSS custom properties (namespaced to survive injection into third-party pages) and a typed TS map.
- Component CSS follows **ITCSS layering** (via native `@layer`) with **BEM** naming.
- `pnpm check:tokens` fails CI on any raw color / absolute length in component CSS.
- Tokens attach to `:where(:root, :host)` so the same sheet works in the document *and* inside the widget's shadow root.

## API surface (summary)

| Route | Auth | Purpose |
|---|---|---|
| `POST /projects` · `GET /projects` | admin | create (returns token once) / list |
| `GET/PATCH/DELETE /projects/:id` | admin or project token | manage project |
| `GET /projects/:id/export` | admin or project token | versioned JSON export |
| `…/pages` + `…/pages/:id` | project scope | sitemap CRUD (hierarchy via `parent_id`) |
| `…/pages/:id/content-blocks` | project scope | draft content CRUD |
| `…/comments` (+replies, screenshot) | project scope | review comments, threads |
| `POST /ingest/comments` | `X-Croquis-Ingest-Key` | widget write-only ingest |
| `GET /share/:slug` | public (+password) | read-only client view, no keys exposed |

## Development

```bash
pnpm test          # Vitest 4 everywhere; API tests run in workerd via @cloudflare/vitest-pool-workers
pnpm typecheck     # strict TS across the monorepo
pnpm check:tokens  # design-token enforcement
```

## Roadmap

- Widget screenshot capture (html-to-image) — the API/storage path already supports it
- Slack / GitHub / Linear notifications
- Full user accounts & roles (schema already carries `members`)

## License

[AGPL-3.0](./LICENSE). You can self-host freely; if you run a modified version as a service, you must publish your changes. For a commercial license, open an issue.
