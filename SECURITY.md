# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.
Report privately via GitHub Security Advisories ("Report a vulnerability" on the repo), including reproduction steps and impact.

You can expect an acknowledgement within a few days. Fixes are released as soon as practical; credit is given unless you prefer otherwise.

## Model

- **Admin token** (`ADMIN_TOKEN` secret): full control. Keep it in Wrangler secrets / `.dev.vars` (git-ignored). Comparisons are length-safe (digest-then-compare).
- **Project API token**: shown once at creation, stored only as a SHA-256 hash, scoped to one project.
- **Share password**: human-chosen, so it is stored as salted **PBKDF2-SHA256 (100k iterations)** with a minimum length of 8.
- **Ingest key**: public by design, write-only (`POST /ingest/comments`, 8 MB body cap, screenshot size checked before decode) and scoped to one project.
- **Share link**: read-only projection that never includes keys or hashes.
- **CORS** is split per surface: `/ingest` and `/share` are `*` (auth is key/password-header based, no cookies); `/projects` can be pinned to `DASHBOARD_ORIGIN`.
- **Screenshots** are served through the authenticated Worker route, never from a public bucket, and are deleted together with their comment/project.

## Known limitations (self-hosters should be aware)

- **No rate limiting yet** on the public ingest/share endpoints — for exposed deployments, add a Cloudflare WAF rate rule or the Workers rate-limit binding in front. (Roadmap.)
- **Dashboard stores the admin token in `localStorage`** — a single-operator convenience. Treat the dashboard origin as sensitive; a rotation endpoint is on the roadmap.
- **Widget captures element `outerHTML`/attributes** for context. Don't embed it on pages that render secrets into the DOM, or strip those fields in a fork if needed.
- **List endpoints are not paginated yet** — practical for review-sized projects; pagination is on the roadmap.

## Hardening notes for self-hosters

- Set `DASHBOARD_ORIGIN` to your dashboard origin in production (this no longer affects the widget/share surfaces).
- Rotate the ingest key by recreating the project if it leaks into unwanted hands (rotation endpoint on the roadmap).
