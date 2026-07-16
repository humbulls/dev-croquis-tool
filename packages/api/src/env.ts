/**
 * Cloudflare bindings and secrets available to the Worker.
 * Configured in wrangler.jsonc (bindings) and via secrets / .dev.vars.
 */
export interface Env {
  /** D1 database. */
  DB: D1Database;
  /** R2 bucket for screenshots. */
  BUCKET: R2Bucket;
  /** Operator/admin bearer token (self-host owner; used by the dashboard). */
  ADMIN_TOKEN: string;
  /** Allowed CORS origin for admin/project routes. Defaults to "*". */
  DASHBOARD_ORIGIN?: string;
  /** Optional AI provider config (P1). */
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  AI_MODEL?: string;
}

/** Hono variable map (values set by middleware). */
export interface Variables {
  /** The project resolved by project-scoped auth. */
  project: import('./db/projects').ProjectRow;
  /** Auth scope for the current request. */
  scope: 'admin' | 'project';
  /** The page resolved by page-scoped middleware (content-block routes). */
  page: import('./db/pages').PageRow;
}
