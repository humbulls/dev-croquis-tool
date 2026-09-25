import { z } from 'zod';
import {
  ACTOR_TYPES,
  AI_RUN_KINDS,
  EVENT_TYPES,
  FIELD_LIMITS,
  INTEGRATION_PROVIDERS,
} from '../constants';
import { epochMs, httpUrl, id } from './common';

export const eventTypeSchema = z.enum(EVENT_TYPES);
export const actorTypeSchema = z.enum(ACTOR_TYPES);
export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);

export const actorSchema = z.object({
  type: actorTypeSchema,
  id: z.string().nullable(),
  name: z.string().nullable(),
});
export type Actor = z.infer<typeof actorSchema>;

export const activityEventSchema = z.object({
  id,
  type: eventTypeSchema,
  project_id: id.nullable(),
  actor: actorSchema,
  subject_type: z.string(),
  subject_id: z.string(),
  data: z.record(z.string(), z.unknown()),
  created_at: epochMs,
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;

// --- Webhooks (https://www.standardwebhooks.com) ------------------------------

export const webhookEndpointSchema = z.object({
  id,
  project_id: id,
  url: z.string(),
  description: z.string(),
  event_types: z.array(z.union([eventTypeSchema, z.literal('*')])),
  enabled: z.boolean(),
  failure_count: z.number().int(),
  created_at: epochMs,
  updated_at: epochMs,
});
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

export const createWebhookInput = z.object({
  url: httpUrl.refine((u) => u.startsWith('https://'), 'webhooks must use https'),
  description: z.string().trim().max(FIELD_LIMITS.webhookDescription).default(''),
  event_types: z
    .array(z.union([eventTypeSchema, z.literal('*')]))
    .min(1)
    .default(['*']),
});
export type CreateWebhookInput = z.infer<typeof createWebhookInput>;

export const updateWebhookInput = z.object({
  url: httpUrl.refine((u) => u.startsWith('https://'), 'webhooks must use https').optional(),
  description: z.string().trim().max(FIELD_LIMITS.webhookDescription).optional(),
  event_types: z
    .array(z.union([eventTypeSchema, z.literal('*')]))
    .min(1)
    .optional(),
  enabled: z.boolean().optional(),
});
export type UpdateWebhookInput = z.infer<typeof updateWebhookInput>;

/** The signing secret is shown once, at creation. */
export const createdWebhookSchema = webhookEndpointSchema.extend({ secret: z.string() });
export type CreatedWebhook = z.infer<typeof createdWebhookSchema>;

export const webhookDeliverySchema = z.object({
  id,
  event_id: id,
  event_type: eventTypeSchema,
  status: z.enum(['pending', 'succeeded', 'failed', 'dead']),
  attempt_count: z.number().int(),
  next_attempt_at: epochMs.nullable(),
  last_status_code: z.number().int().nullable(),
  last_error: z.string().nullable(),
  created_at: epochMs,
  updated_at: epochMs,
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

/** Body POSTed to webhook endpoints. */
export const webhookPayloadSchema = z.object({
  id,
  type: eventTypeSchema,
  timestamp: z.string(),
  project_id: id.nullable(),
  actor: actorSchema,
  data: z.record(z.string(), z.unknown()),
});
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

// --- Integrations -------------------------------------------------------------

export const integrationSchema = z.object({
  id,
  project_id: id,
  provider: integrationProviderSchema,
  /** Non-secret settings: GitHub `{ owner, repo }`, Linear `{ team_id }`, Slack `{}`. */
  config: z.record(z.string(), z.string()),
  enabled: z.boolean(),
  has_secret: z.boolean(),
  created_at: epochMs,
  updated_at: epochMs,
});
export type Integration = z.infer<typeof integrationSchema>;

export const upsertIntegrationInput = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('github'),
    owner: z.string().trim().min(1).max(100),
    repo: z.string().trim().min(1).max(100),
    /** Fine-grained PAT with `issues:write` on the repository. */
    token: z.string().min(1).max(500).optional(),
    enabled: z.boolean().default(true),
  }),
  z.object({
    provider: z.literal('linear'),
    team_id: z.string().trim().min(1).max(100),
    /** Linear personal API key. */
    token: z.string().min(1).max(500).optional(),
    enabled: z.boolean().default(true),
  }),
  z.object({
    provider: z.literal('slack'),
    /** Incoming webhook URL (https://hooks.slack.com/…). */
    webhook_url: httpUrl.optional(),
    enabled: z.boolean().default(true),
  }),
]);
export type UpsertIntegrationInput = z.infer<typeof upsertIntegrationInput>;

// --- AI -------------------------------------------------------------------------

export const aiRunKindSchema = z.enum(AI_RUN_KINDS);

export const aiRunSchema = z.object({
  id,
  kind: aiRunKindSchema,
  provider: z.string(),
  model: z.string(),
  status: z.enum(['succeeded', 'failed']),
  input_tokens: z.number().int().nullable(),
  output_tokens: z.number().int().nullable(),
  duration_ms: z.number().int(),
  error: z.string().nullable(),
  created_at: epochMs,
});
export type AiRun = z.infer<typeof aiRunSchema>;

export const aiBriefInput = z.object({
  brief: z.string().trim().min(1).max(FIELD_LIMITS.aiBrief),
});
export const aiContentInput = z.object({
  brief: z.string().trim().max(FIELD_LIMITS.aiBrief).optional(),
});

export const aiTriageInput = z.object({
  /** Write suggested titles and duplicate links back to the comments (default), or only return them. */
  apply: z.boolean().default(true),
});

export const aiTypoCheckInput = z.object({
  /** Check one page (default: every page with content). */
  page_id: id.optional(),
  /** Create a `typo` comment per finding (default), or only return findings. */
  create_comments: z.boolean().default(true),
});

export const aiDigestSchema = z.object({
  markdown: z.string(),
  active_count: z.number().int(),
  run: aiRunSchema.nullable(),
});
export type AiDigest = z.infer<typeof aiDigestSchema>;

/** AI triage result: suggested titles and duplicate groups. */
export const aiTriageSchema = z.object({
  titled: z.number().int(),
  duplicates_marked: z.number().int(),
  groups: z.array(z.object({ canonical_id: id, duplicate_ids: z.array(id), reason: z.string() })),
  run: aiRunSchema.nullable(),
});
export type AiTriage = z.infer<typeof aiTriageSchema>;

/** Japanese/English copy check: each finding becomes a `typo` comment. */
export const aiTypoFindingSchema = z.object({
  content_block_id: id.nullable(),
  original: z.string(),
  suggestion: z.string(),
  reason: z.string(),
  category: z.enum(['typo', 'inconsistency', 'grammar', 'style']),
});
export const aiTypoCheckSchema = z.object({
  findings: z.array(aiTypoFindingSchema),
  comments_created: z.number().int(),
  run: aiRunSchema.nullable(),
});
export type AiTypoCheck = z.infer<typeof aiTypoCheckSchema>;

export const aiTranslateInput = z.object({ lang: z.enum(['en', 'ja']) });
export const aiTranslationSchema = z.object({
  lang: z.string(),
  body: z.string(),
  cached: z.boolean(),
});
export type AiTranslation = z.infer<typeof aiTranslationSchema>;

/** POST /comments/:id/external-issue — create a GitHub or Linear issue from a comment. */
export const createExternalIssueInput = z.object({ provider: z.enum(['github', 'linear']) });
export type CreateExternalIssueInput = z.infer<typeof createExternalIssueInput>;
