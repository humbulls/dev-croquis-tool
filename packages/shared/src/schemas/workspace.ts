import { z } from 'zod';
import { API_KEY_SCOPES, FIELD_LIMITS, SIGNUP_MODES, WORKSPACE_ROLES } from '../constants';
import { epochMs, id } from './common';

export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);

/** A user as other members see them. */
export const userSummarySchema = z.object({
  id,
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const workspaceSchema = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  plan: z.enum(['free', 'beta', 'pro']),
  /** The caller's role in this workspace. */
  role: workspaceRoleSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const createWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.workspaceName),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;

export const updateWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.workspaceName).optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInput>;

export const memberSchema = z.object({
  id,
  user: userSummarySchema,
  role: workspaceRoleSchema,
  created_at: epochMs,
});
export type Member = z.infer<typeof memberSchema>;

export const updateMemberInput = z.object({ role: workspaceRoleSchema });
export type UpdateMemberInput = z.infer<typeof updateMemberInput>;

// --- Invitations --------------------------------------------------------------

export const invitationRoleSchema = z.enum(['admin', 'member']);

export const invitationSchema = z.object({
  id,
  workspace_id: id,
  email: z.string(),
  role: invitationRoleSchema,
  status: z.enum(['pending', 'accepted', 'revoked']),
  inviter: userSummarySchema.nullable(),
  expires_at: epochMs,
  created_at: epochMs,
});
export type Invitation = z.infer<typeof invitationSchema>;

export const createInvitationInput = z.object({
  email: z.email().max(FIELD_LIMITS.email),
  role: invitationRoleSchema.default('member'),
});
export type CreateInvitationInput = z.infer<typeof createInvitationInput>;

/**
 * Returned once at creation. `url` is the link to send; `email_sent` tells the
 * dashboard whether the instance mailed it or the inviter should copy it.
 */
export const createdInvitationSchema = invitationSchema.extend({
  url: z.string(),
  email_sent: z.boolean(),
});
export type CreatedInvitation = z.infer<typeof createdInvitationSchema>;

/** What the invite landing page shows before the invitee signs in. */
export const invitationPreviewSchema = z.object({
  workspace: z.object({ name: z.string() }),
  email: z.string(),
  role: invitationRoleSchema,
  inviter_name: z.string().nullable(),
  expires_at: epochMs,
  /** True when an account with this email already exists (show sign-in, not sign-up). */
  account_exists: z.boolean(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export const meSchema = z.object({
  user: userSummarySchema,
  workspaces: z.array(workspaceSchema),
});
export type Me = z.infer<typeof meSchema>;

// --- API keys ---------------------------------------------------------------

export const apiKeySchema = z.object({
  id,
  name: z.string(),
  /** First characters of the key, safe to display. */
  prefix: z.string(),
  project_id: id.nullable(),
  scopes: z.array(apiKeyScopeSchema),
  last_used_at: epochMs.nullable(),
  expires_at: epochMs.nullable(),
  revoked_at: epochMs.nullable(),
  created_at: epochMs,
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const createApiKeyInput = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.apiKeyName),
  project_id: id.nullable().optional(),
  scopes: z.array(apiKeyScopeSchema).min(1).default(['*']),
  expires_at: epochMs.nullable().optional(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeyInput>;

/** Returned once at creation — the only time the full key is visible. */
export const createdApiKeySchema = apiKeySchema.extend({ key: z.string() });
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

// --- Instance setup ---------------------------------------------------------

export const setupStatusSchema = z.object({
  /** True until the first account exists. */
  needs_setup: z.boolean(),
  signup_mode: z.enum(SIGNUP_MODES),
  ai_enabled: z.boolean(),
  /** "self-hosted" or "cloud" (Croquis Cloud). */
  edition: z.enum(['self-hosted', 'cloud']),
  version: z.string(),
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;

export const setupInput = z.object({
  /** Proves the caller operates this instance (the ADMIN_TOKEN secret). */
  admin_token: z.string().min(1),
  name: z.string().trim().min(1).max(FIELD_LIMITS.authorName),
  email: z.email().max(FIELD_LIMITS.email),
  password: z.string().min(FIELD_LIMITS.passwordMin).max(FIELD_LIMITS.passwordMax),
  workspace_name: z.string().trim().min(1).max(FIELD_LIMITS.workspaceName),
});
export type SetupInput = z.infer<typeof setupInput>;
