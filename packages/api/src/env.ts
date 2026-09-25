import type { Principal } from './security/principal';

/**
 * Bindings and secrets available to the Worker (wrangler.jsonc + secrets).
 * Everything except DB, BUCKET and AUTH_SECRET is optional so a fresh
 * "Deploy to Cloudflare" install works with the defaults.
 */
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  /** Workers Static Assets: dashboard SPA, share viewer and widget.js. */
  ASSETS?: Fetcher;
  /** Workers AI — the zero-configuration AI provider. */
  AI?: Ai;
  /** Workers Rate Limiting binding for the public endpoints. */
  PUBLIC_RATE_LIMITER?: RateLimit;

  /** Signs Better Auth sessions and share-viewer tokens (32+ random chars). */
  AUTH_SECRET: string;
  /** Instance operator secret: required by /setup and accepted as a superuser bearer token. */
  ADMIN_TOKEN?: string;
  /** AES-GCM key (base64, 32 bytes) for integration secrets. Derived from AUTH_SECRET if unset. */
  ENCRYPTION_KEY?: string;

  /** Canonical origin of this deployment, e.g. https://croquis.example.com. */
  PUBLIC_URL?: string;
  /** Extra origins allowed to call the authenticated API (comma-separated). */
  DASHBOARD_ORIGIN?: string;
  /** invite (default) | open */
  SIGNUP_MODE?: string;
  /** self-hosted (default) | cloud */
  EDITION?: string;

  /** workers-ai (default when the AI binding exists) | anthropic | openai */
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;

  /** Optional Cloudflare Turnstile: anonymous widget comments must then carry a token. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;

  /** Optional social sign-in. */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  /** Optional transactional email (invitations). Without it, invite links are copied by hand. */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

export interface Variables {
  requestId: string;
  principal: Principal;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
