import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a real local Worker (wrangler dev, fresh D1/R2
 * state per run) and a pretend client site that embeds the widget.
 *   pnpm build && pnpm e2e
 */

const devVars = resolve('packages/api/.dev.vars');
const fromDevVars = (name: string) =>
  existsSync(devVars)
    ? new RegExp(`^${name}=(.+)$`, 'm').exec(readFileSync(devVars, 'utf8'))?.[1]?.trim()
    : undefined;

process.env.E2E_ADMIN_TOKEN ??= fromDevVars('ADMIN_TOKEN') ?? 'e2e-admin-token';
const authSecret = fromDevVars('AUTH_SECRET') ?? randomBytes(32).toString('hex');
const API_PORT = 8788;
const SITE_PORT = 4321;
const state = resolve('e2e/.state');

export const API = `http://localhost:${API_PORT}`;
export const SITE = `http://localhost:${SITE_PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: API,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: [
        `rm -rf ${state}`,
        `cd packages/api`,
        `npx wrangler d1 migrations apply croquis --local --env local --persist-to ${state}`,
        `npx wrangler dev --env local --port ${API_PORT} --persist-to ${state} --var ADMIN_TOKEN:${process.env.E2E_ADMIN_TOKEN} --var AUTH_SECRET:${authSecret} --var AI_PROVIDER:none --var SIGNUP_MODE:invite`,
      ].join(' && '),
      url: `${API}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
    },
    {
      command: `python3 -m http.server ${SITE_PORT} --directory examples/demo-site`,
      url: SITE,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
    },
  ],
});
