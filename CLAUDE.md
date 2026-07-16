# Croquis — AI-native web production platform

> Sitemap → Content → Review を「ページ」単位で統合する Web 制作プラットフォーム。
> MCP-first（Claude Code から全操作）、Cloudflare 完結（Workers + D1 + R2）、AGPL-3.0 OSS。

## Architecture

```
packages/
├── shared/     Zod スキーマ + 型 + 定数 + Markdown エクスポート（単一の真実源）
├── tokens/     DTCG デザイントークン(JSON) → tokens.css / tokens.js 生成（自作ジェネレータ）
├── api/        Cloudflare Workers (Hono) + D1 + R2。マルチテナント API
├── dashboard/  Vite + Preact 管理 UI（ITCSS + BEM、トークンのみ使用）
├── widget/     埋め込みフィードバックウィジェット（Vanilla TS + Shadow DOM、単一 IIFE）
└── mcp/        MCP サーバー（stdio）。Claude Code から projects/pages/content/comments を操作
```

- **Page が共通単位**: サイトマップのノード = コンテンツ行 = レビュー対象。
- **認証は4種**: `ADMIN_TOKEN`（運用者）/ project api_token（プロジェクト単位・一度だけ表示）/ ingest_key（Widget 書込専用・公開可）/ share_slug + password（クライアント公開 read）。
- **AI エクスポート**: `GET /projects/:id/export`（JSON）+ `formatExportMarkdown`（LLM に渡す Markdown）。schema_version 付き。

## Commands

```bash
pnpm install              # 依存インストール（Node >= 22, pnpm 10）
pnpm build                # tokens 生成 → 全パッケージビルド
pnpm test                 # 全パッケージのテスト（Vitest 4）
pnpm typecheck            # 全パッケージの tsc --noEmit
pnpm check:tokens         # CSS 生値ハードコード検出（違反で exit 1）
pnpm dev:api              # wrangler dev (localhost:8787)
pnpm dev:dashboard        # vite dev (localhost:5173)
```

API 個別: `packages/api/` で `pnpm migrate:local`（D1 マイグレーション）、`.dev.vars` に `ADMIN_TOKEN=...`。

## Coding rules

1. **デザイン値のハードコード禁止**。色・余白・フォント・角丸などは必ず `--cq-*` トークン（`packages/tokens/src/*.tokens.json` が単一の真実源）。`pnpm check:tokens` が CI ゲート。
2. CSS は **ITCSS レイヤ**（`@layer generic → elements → objects → components → utilities`）+ **BEM 命名**（`.c-block__elem--mod` / `.o-*` / `.u-*`）。
3. 型とバリデーションは `@croquis/shared` の Zod スキーマから導出。API 入出力の形を変えるときは必ず shared を先に変える。
4. D1 は FK カスケードに依存しない。**削除の連鎖はコードで明示**（`db.batch()`）。
5. テナント越境防止: SQL は常に `project_id` でスコープ。新ルートには必ず `requireProjectAccess` 系ミドルウェア。
6. secret はレスポンスに含めない（api_token は作成時のみ、share ビューは公開 projection）。
7. Conventional Commits（`feat:` `fix:` `docs:` `refactor:` `chore:` `test:`）。1コミット1テーマ。
8. `prototype/`（git 管理外のローカル参照スナップショット）は変更禁止・公開禁止。

## Workflow

- 変更前に該当パッケージの src と test を読む。
- 実装後は `pnpm typecheck && pnpm test && pnpm check:tokens` を回してから完了とする。
- API の挙動変更は `packages/api/test/` にテストを足す（vitest-pool-workers、実 D1/R2 相当で動く）。
- 重要な設計判断は ADR として docs に記録する。
