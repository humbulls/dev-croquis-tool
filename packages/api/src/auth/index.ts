import { APIError, betterAuth } from 'better-auth';
import { runtimeConfig } from '../config';
import type { Env } from '../env';
import { hashPassword, verifyPassword } from '../security/crypto';
import { coreSchemaOptions } from './schema-options';

export interface AuthOptions {
  /**
   * Allows creating an account without an invitation. Only /setup passes
   * this, after it has verified ADMIN_TOKEN and that no user exists yet.
   */
  bootstrap?: boolean;
}

/**
 * Better Auth handles identity only: email/password (and optional GitHub or
 * Google) sign-in, sessions and password changes. Tenancy — workspaces,
 * members, invitations, API keys — is Croquis code, so the whole API shares
 * one permission model and one OpenAPI contract.
 */
export function createAuth(env: Env, requestOrigin: string, options: AuthOptions = {}) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    throw new Error('AUTH_SECRET must be set to a random string of at least 32 characters');
  }
  const config = runtimeConfig(env);

  const socialProviders: Parameters<typeof betterAuth>[0]['socialProviders'] = {};
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    };
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }

  return betterAuth({
    appName: 'Croquis',
    baseURL: config.publicUrl ?? requestOrigin,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    database: env.DB,
    trustedOrigins: config.trustedOrigins,
    ...coreSchemaOptions,
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 200,
      // Workers bill CPU time; native PBKDF2 (Web Crypto) is far cheaper than
      // the default pure-JS scrypt while remaining a salted, slow hash.
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(password, hash),
      },
    },
    socialProviders,
    session: {
      ...coreSchemaOptions.session,
      // Saves a D1 read on most requests; revocation takes effect within 5 min.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (options.bootstrap || config.signupMode === 'open') return;
            const invitation = await env.DB.prepare(
              `SELECT 1 FROM workspace_invitations
                WHERE email = ? AND status = 'pending' AND expires_at > ?`,
            )
              .bind(user.email.toLowerCase(), Date.now())
              .first();
            if (!invitation) {
              throw new APIError('FORBIDDEN', {
                code: 'SIGNUP_REQUIRES_INVITATION',
                message: 'This instance only accepts sign-ups from invited email addresses.',
              });
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const cache = new WeakMap<Env, Map<string, Auth>>();

/**
 * The default auth instance, reused across requests in the same isolate
 * (building Better Auth is not free). Instances with options are never cached.
 */
export function getAuth(env: Env, requestOrigin: string): Auth {
  let byOrigin = cache.get(env);
  if (!byOrigin) {
    byOrigin = new Map();
    cache.set(env, byOrigin);
  }
  let auth = byOrigin.get(requestOrigin);
  if (!auth) {
    auth = createAuth(env, requestOrigin);
    byOrigin.set(requestOrigin, auth);
  }
  return auth;
}
