/**
 * Better Auth table/column mapping.
 *
 * Better Auth owns only users, sessions, accounts and verifications. They live
 * in the same D1 database as the domain tables, so they follow the same
 * conventions: plural snake_case table names, snake_case columns and UUID
 * primary keys (Better Auth itself stores dates as ISO-8601 text). Keep this
 * file in sync with the identity section of `migrations/0002_v1.sql`;
 * `pnpm --filter @croquis/api auth:schema` prints what Better Auth expects.
 * Workspaces, members and invitations are Croquis tables (src/db/workspaces.ts).
 */

const timestamps = { createdAt: 'created_at', updatedAt: 'updated_at' } as const;

export const coreSchemaOptions = {
  user: {
    modelName: 'users',
    fields: { emailVerified: 'email_verified', ...timestamps },
  },
  session: {
    modelName: 'sessions',
    fields: {
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      userId: 'user_id',
      ...timestamps,
    },
  },
  account: {
    modelName: 'accounts',
    fields: {
      accountId: 'account_id',
      providerId: 'provider_id',
      userId: 'user_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      ...timestamps,
    },
  },
  verification: {
    modelName: 'verifications',
    fields: { expiresAt: 'expires_at', ...timestamps },
  },
} as const;
