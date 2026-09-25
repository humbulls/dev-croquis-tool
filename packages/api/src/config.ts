import { SIGNUP_MODES, type SignupMode } from '@croquis/shared';
import type { Env } from './env';

export const VERSION = '1.0.0-rc.0';

export interface RuntimeConfig {
  signupMode: SignupMode;
  edition: 'self-hosted' | 'cloud';
  /** Origins allowed to call the cookie-authenticated API cross-origin. */
  trustedOrigins: string[];
  publicUrl: string | null;
}

/** Normalize env strings once so the rest of the code works with typed values. */
export function runtimeConfig(env: Env): RuntimeConfig {
  const signupMode = (SIGNUP_MODES as readonly string[]).includes(env.SIGNUP_MODE ?? '')
    ? (env.SIGNUP_MODE as SignupMode)
    : 'invite';
  const edition = env.EDITION === 'cloud' ? 'cloud' : 'self-hosted';
  const publicUrl = env.PUBLIC_URL?.replace(/\/$/, '') || null;
  const trustedOrigins = [
    publicUrl,
    ...(env.DASHBOARD_ORIGIN ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter((o) => o && o !== '*'),
  ].filter((o): o is string => Boolean(o));
  return { signupMode, edition, trustedOrigins, publicUrl };
}

/** Croquis Cloud quotas per workspace plan. Self-hosted instances are unlimited. */
export const PLAN_QUOTAS = {
  free: { projects: 3, commentsPerDay: 200, storageBytes: 500 * 1024 * 1024 },
  beta: { projects: 20, commentsPerDay: 2000, storageBytes: 5 * 1024 * 1024 * 1024 },
  pro: { projects: 200, commentsPerDay: 20_000, storageBytes: 50 * 1024 * 1024 * 1024 },
} as const;
