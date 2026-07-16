# Contributing to Croquis

Thanks for your interest! This document keeps contributions smooth.

## Setup

```bash
pnpm install
pnpm build
pnpm test && pnpm typecheck && pnpm check:tokens
```

Node ≥ 22, pnpm ≥ 10. The API tests run inside workerd via `@cloudflare/vitest-pool-workers` — no Cloudflare account needed.

## Ground rules

1. **No hardcoded design values.** Colors, spacing, typography, radii etc. must reference `--cq-*` tokens. Add tokens to `packages/tokens/src/*.tokens.json` if one is missing. `pnpm check:tokens` enforces this.
2. **Schemas first.** API shapes are defined in `@croquis/shared` (Zod). Change the schema, then the API, then consumers.
3. **Tenant isolation.** Every query is scoped by `project_id`; every new route goes through the auth middleware. Add a test proving isolation for new endpoints.
4. **Explicit cascades.** Don't rely on D1 foreign-key cascades — delete dependents in code with `db.batch()`.
5. **Tests accompany behavior.** New endpoint → new test in `packages/api/test/`. Bug fix → regression test.
6. **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`), one topic per commit.

## Pull requests

- Keep PRs focused; describe the *why*.
- CI must be green: build, typecheck, tests, token check.
- Breaking changes to the export format require a `schema_version` bump and a note in the PR.

## License

By contributing you agree that your contributions are licensed under AGPL-3.0.
