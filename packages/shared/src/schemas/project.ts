import { z } from 'zod';
import { FIELD_LIMITS, LABEL_COLORS, ORIGIN_ENVIRONMENTS, WIDGET_MODES } from '../constants';
import { epochMs, httpUrl, id, listQuery } from './common';

export const widgetModeSchema = z.enum(WIDGET_MODES);
export const originEnvironmentSchema = z.enum(ORIGIN_ENVIRONMENTS);
export const labelColorSchema = z.enum(LABEL_COLORS);

export const projectSchema = z.object({
  id,
  workspace_id: id,
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  /** Public, write-only key embedded in the widget snippet. */
  ingest_key: z.string(),
  widget_mode: widgetModeSchema,
  created_at: epochMs,
  updated_at: epochMs,
});
export type Project = z.infer<typeof projectSchema>;

/** Project as a client sees it through a share link (no keys). */
export const publicProjectSchema = projectSchema.pick({ id: true, name: true, slug: true });
export type PublicProject = z.infer<typeof publicProjectSchema>;

/** Counters shown on project cards. */
export const projectStatsSchema = z.object({
  pages: z.number().int(),
  comments_active: z.number().int(),
  comments_unassigned: z.number().int(),
  comments_total: z.number().int(),
});
export const projectWithStatsSchema = projectSchema.extend({ stats: projectStatsSchema });
export type ProjectWithStats = z.infer<typeof projectWithStatsSchema>;

export const createProjectInput = z.object({
  /** Required when the caller can create projects in more than one workspace. */
  workspace_id: id.optional(),
  name: z.string().trim().min(1).max(FIELD_LIMITS.projectName),
  description: z.string().max(FIELD_LIMITS.projectDescription).default(''),
  widget_mode: widgetModeSchema.default('activated'),
  /** Optional first site origin (e.g. https://staging.acme.com). */
  origin: httpUrl.optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInput>;

export const projectListQuery = listQuery.extend({ workspace_id: id.optional() });
export type ProjectListQuery = z.infer<typeof projectListQuery>;

export const updateProjectInput = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.projectName).optional(),
  description: z.string().max(FIELD_LIMITS.projectDescription).optional(),
  widget_mode: widgetModeSchema.optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectInput>;

// --- Origins ---------------------------------------------------------------

export const projectOriginSchema = z.object({
  id,
  project_id: id,
  origin: z.string(),
  base_path: z.string(),
  environment: originEnvironmentSchema,
  created_at: epochMs,
});
export type ProjectOrigin = z.infer<typeof projectOriginSchema>;

export const createOriginInput = z.object({
  /** Any URL on the site; it is reduced to scheme://host[:port]. */
  url: httpUrl,
  base_path: z.string().max(FIELD_LIMITS.pagePath).default('/'),
  environment: originEnvironmentSchema.default('production'),
});
export type CreateOriginInput = z.infer<typeof createOriginInput>;

// --- Share links ------------------------------------------------------------

export const shareLinkSchema = z.object({
  id,
  project_id: id,
  slug: z.string(),
  label: z.string(),
  password_protected: z.boolean(),
  allow_comments: z.boolean(),
  allow_approvals: z.boolean(),
  expires_at: epochMs.nullable(),
  revoked_at: epochMs.nullable(),
  last_viewed_at: epochMs.nullable(),
  created_at: epochMs,
});
export type ShareLink = z.infer<typeof shareLinkSchema>;

export const createShareLinkInput = z.object({
  label: z.string().trim().max(FIELD_LIMITS.shareLinkLabel).default(''),
  password: z.string().min(FIELD_LIMITS.passwordMin).max(FIELD_LIMITS.passwordMax).optional(),
  allow_comments: z.boolean().default(true),
  allow_approvals: z.boolean().default(true),
  expires_at: epochMs.nullable().optional(),
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkInput>;

export const updateShareLinkInput = z.object({
  label: z.string().trim().max(FIELD_LIMITS.shareLinkLabel).optional(),
  /** String sets/rotates the password, null removes it. */
  password: z
    .string()
    .min(FIELD_LIMITS.passwordMin)
    .max(FIELD_LIMITS.passwordMax)
    .nullable()
    .optional(),
  allow_comments: z.boolean().optional(),
  allow_approvals: z.boolean().optional(),
  expires_at: epochMs.nullable().optional(),
  revoked: z.boolean().optional(),
});
export type UpdateShareLinkInput = z.infer<typeof updateShareLinkInput>;

// --- Labels -----------------------------------------------------------------

export const labelSchema = z.object({
  id,
  project_id: id,
  name: z.string(),
  color: labelColorSchema,
  created_at: epochMs,
});
export type Label = z.infer<typeof labelSchema>;

export const createLabelInput = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.labelName),
  color: labelColorSchema.default('gray'),
});
export type CreateLabelInput = z.infer<typeof createLabelInput>;

export const updateLabelInput = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.labelName).optional(),
  color: labelColorSchema.optional(),
});
export type UpdateLabelInput = z.infer<typeof updateLabelInput>;
