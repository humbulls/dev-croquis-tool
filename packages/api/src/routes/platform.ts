import { listQuery, type WebhookEndpoint, type WebhookPayload } from '@croquis/shared';
import { z } from '@hono/zod-openapi';
import { getComment } from '../db/comments';
import { body, createRouter, idParam, json, noContent, problem, route } from '../http/openapi';
import { decodeCursor, paginate } from '../http/pagination';
import { conflict, notFound, orThrow } from '../http/problem';
import * as S from '../http/schemas';
import { loadScoped, requireProject } from '../security/access';
import { actorOf } from '../security/principal';
import { seal } from '../security/secret-box';
import { newId, newWebhookSecret } from '../security/tokens';
import {
  createExternalIssue,
  getIntegration,
  type IntegrationRow,
  toIntegration,
} from '../services/integrations';
import { UnitOfWork } from '../services/unit-of-work';
import { redeliver, signWebhook } from '../services/webhooks';

const app = createRouter();
const ProjectParams = idParam('projectId', 'Project id');
const WebhookParams = idParam('webhookId', 'Webhook endpoint id');

interface WebhookRow {
  id: string;
  project_id: string;
  url: string;
  description: string;
  secret: string;
  event_types: string;
  enabled: number;
  failure_count: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

function toWebhook(row: WebhookRow): WebhookEndpoint {
  return {
    id: row.id,
    project_id: row.project_id,
    url: row.url,
    description: row.description,
    event_types: JSON.parse(row.event_types) as WebhookEndpoint['event_types'],
    enabled: row.enabled === 1,
    failure_count: row.failure_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const WEBHOOK_FROM = 'webhook_endpoints x JOIN projects p ON p.id = x.project_id';

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}/webhooks',
    tags: ['Webhooks'],
    summary: 'List webhook endpoints',
    request: { params: ProjectParams },
    responses: { 200: json(S.data(S.WebhookEndpoint), 'Endpoints') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    await requireProject(c, projectId, 'webhook.manage');
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM webhook_endpoints WHERE project_id = ? ORDER BY created_at',
    )
      .bind(projectId)
      .all<WebhookRow>();
    return c.json({ data: results.map(toWebhook) }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/projects/{projectId}/webhooks',
    tags: ['Webhooks'],
    summary: 'Add a webhook endpoint',
    description:
      'Deliveries follow Standard Webhooks (webhook-id / webhook-timestamp / webhook-signature headers). Verify them with the returned `secret`, shown only once. Failed deliveries are retried for about a day.',
    request: { params: ProjectParams, ...body(S.CreateWebhookInput) },
    responses: { 201: json(S.CreatedWebhook, 'Created (the only time `secret` is shown)') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    const input = c.req.valid('json');
    await requireProject(c, projectId, 'webhook.manage');
    const principal = c.get('principal');
    const now = Date.now();
    const row: WebhookRow = {
      id: newId(),
      project_id: projectId,
      url: input.url,
      description: input.description,
      secret: newWebhookSecret(),
      event_types: JSON.stringify([...new Set(input.event_types)]),
      enabled: 1,
      failure_count: 0,
      created_by: principal.type === 'user' ? principal.user.id : null,
      created_at: now,
      updated_at: now,
    };
    await c.env.DB.prepare(
      `INSERT INTO webhook_endpoints (id, project_id, url, description, secret, event_types, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
      .bind(
        row.id,
        projectId,
        row.url,
        row.description,
        row.secret,
        row.event_types,
        row.created_by,
        now,
        now,
      )
      .run();
    return c.json({ ...toWebhook(row), secret: row.secret }, 201);
  },
);

app.openapi(
  route({
    method: 'patch',
    path: '/webhooks/{webhookId}',
    tags: ['Webhooks'],
    summary: 'Update a webhook endpoint',
    description: 'Re-enabling an endpoint resets its failure counter.',
    request: { params: WebhookParams, ...body(S.UpdateWebhookInput) },
    responses: { 200: json(S.WebhookEndpoint, 'Updated') },
  }),
  async (c) => {
    const { webhookId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { row } = await loadScoped<WebhookRow>(c, {
      from: WEBHOOK_FROM,
      id: webhookId,
      permission: 'webhook.manage',
      resource: 'webhook',
    });
    const enabled = input.enabled === undefined ? row.enabled : input.enabled ? 1 : 0;
    const next: WebhookRow = {
      ...row,
      url: input.url ?? row.url,
      description: input.description ?? row.description,
      event_types: input.event_types
        ? JSON.stringify([...new Set(input.event_types)])
        : row.event_types,
      enabled,
      failure_count: enabled === 1 && row.enabled === 0 ? 0 : row.failure_count,
      updated_at: Date.now(),
    };
    await c.env.DB.prepare(
      `UPDATE webhook_endpoints SET url = ?, description = ?, event_types = ?, enabled = ?, failure_count = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(
        next.url,
        next.description,
        next.event_types,
        next.enabled,
        next.failure_count,
        next.updated_at,
        webhookId,
      )
      .run();
    return c.json(toWebhook(next), 200);
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/webhooks/{webhookId}',
    tags: ['Webhooks'],
    summary: 'Delete a webhook endpoint',
    request: { params: WebhookParams },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { webhookId } = c.req.valid('param');
    await loadScoped<WebhookRow>(c, {
      from: WEBHOOK_FROM,
      id: webhookId,
      permission: 'webhook.manage',
      resource: 'webhook',
    });
    await c.env.DB.prepare('DELETE FROM webhook_endpoints WHERE id = ?').bind(webhookId).run();
    return c.body(null, 204);
  },
);

app.openapi(
  route({
    method: 'get',
    path: '/webhooks/{webhookId}/deliveries',
    tags: ['Webhooks'],
    summary: 'Recent deliveries',
    description: 'Delivery attempts with status codes and errors, newest first (kept for 30 days).',
    request: { params: WebhookParams, query: listQuery },
    responses: { 200: json(S.paginated(S.WebhookDelivery), 'Deliveries') },
  }),
  async (c) => {
    const { webhookId } = c.req.valid('param');
    const { cursor, limit } = c.req.valid('query');
    await loadScoped<WebhookRow>(c, {
      from: WEBHOOK_FROM,
      id: webhookId,
      permission: 'webhook.manage',
      resource: 'webhook',
    });
    const after = decodeCursor(cursor);
    const { results } = await c.env.DB.prepare(
      `SELECT d.id, d.event_id, e.type AS event_type, d.status, d.attempt_count, d.next_attempt_at, d.last_status_code,
              d.last_error, d.created_at, d.updated_at
         FROM webhook_deliveries d JOIN activity_events e ON e.id = d.event_id
        WHERE d.endpoint_id = ? ${after ? 'AND (d.created_at < ? OR (d.created_at = ? AND d.id < ?))' : ''}
        ORDER BY d.created_at DESC, d.id DESC LIMIT ?`,
    )
      .bind(webhookId, ...(after ? [after[0], after[0], after[1]] : []), limit + 1)
      .all<z.infer<typeof S.WebhookDelivery>>();
    return c.json(
      paginate(results, limit, (d) => d.created_at),
      200,
    );
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/webhook-deliveries/{deliveryId}/retry',
    tags: ['Webhooks'],
    summary: 'Retry a delivery now',
    request: { params: idParam('deliveryId', 'Delivery id') },
    responses: { 200: json(S.OkRef, 'Attempted (see the delivery for the result)') },
  }),
  async (c) => {
    const { deliveryId } = c.req.valid('param');
    await loadScoped(c, {
      from: 'webhook_deliveries x JOIN webhook_endpoints we ON we.id = x.endpoint_id JOIN projects p ON p.id = we.project_id',
      id: deliveryId,
      permission: 'webhook.manage',
      resource: 'webhook_delivery',
    });
    await redeliver(c.env, deliveryId);
    return c.json({ ok: true as const }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/webhooks/{webhookId}/test',
    tags: ['Webhooks'],
    summary: 'Send a test event',
    description:
      'Posts a signed `ping` payload and reports the receiver’s response. Nothing is stored.',
    request: { params: WebhookParams },
    responses: {
      200: json(
        z
          .object({
            ok: z.boolean(),
            status: z.number().int().nullable(),
            error: z.string().nullable(),
          })
          .openapi('WebhookTestResult'),
        'Result of the test delivery',
      ),
    },
  }),
  async (c) => {
    const { webhookId } = c.req.valid('param');
    const { row } = await loadScoped<WebhookRow>(c, {
      from: WEBHOOK_FROM,
      id: webhookId,
      permission: 'webhook.manage',
      resource: 'webhook',
    });
    const id = newId();
    const payload = {
      id,
      type: 'ping',
      timestamp: new Date().toISOString(),
      project_id: row.project_id,
      actor: actorOf(c.get('principal')),
      data: { message: 'Croquis webhook test' },
    } satisfies Omit<WebhookPayload, 'type'> & { type: string };
    const bodyText = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const response = await fetch(row.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Croquis-Webhooks/1.0',
          'webhook-id': id,
          'webhook-timestamp': String(timestamp),
          'webhook-signature': await signWebhook(row.secret, id, timestamp, bodyText),
        },
        body: bodyText,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      return c.json(
        {
          ok: response.ok,
          status: response.status,
          error: response.ok ? null : `HTTP ${response.status}`,
        },
        200,
      );
    } catch (err) {
      return c.json(
        { ok: false, status: null, error: err instanceof Error ? err.message : 'request failed' },
        200,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/projects/{projectId}/integrations',
    tags: ['Integrations'],
    summary: 'List integrations',
    description: 'Secrets are never returned; `has_secret` tells whether one is stored.',
    request: { params: ProjectParams },
    responses: { 200: json(S.data(S.Integration), 'Integrations') },
  }),
  async (c) => {
    const { projectId } = c.req.valid('param');
    await requireProject(c, projectId, 'project.read');
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM integrations WHERE project_id = ? ORDER BY provider',
    )
      .bind(projectId)
      .all<IntegrationRow>();
    return c.json({ data: results.map(toIntegration) }, 200);
  },
);

const ProviderParams = ProjectParams.extend({
  provider: z
    .enum(['github', 'linear', 'slack'])
    .openapi({ param: { name: 'provider', in: 'path' } }),
});

app.openapi(
  route({
    method: 'put',
    path: '/projects/{projectId}/integrations/{provider}',
    tags: ['Integrations'],
    summary: 'Connect or update an integration',
    description:
      'GitHub: repository + fine-grained token with Issues write. Linear: team id + personal API key. Slack: an incoming webhook URL. Omitting the token keeps the stored one.',
    request: { params: ProviderParams, ...body(S.UpsertIntegrationInput) },
    responses: {
      200: json(S.Integration, 'Saved'),
      409: problem('Body provider does not match the path'),
    },
  }),
  async (c) => {
    const { projectId, provider } = c.req.valid('param');
    const input = c.req.valid('json');
    if (input.provider !== provider)
      throw conflict('provider_mismatch', 'The body provider must match the URL');
    await requireProject(c, projectId, 'webhook.manage');
    const principal = c.get('principal');
    const config =
      input.provider === 'github'
        ? { owner: input.owner, repo: input.repo }
        : input.provider === 'linear'
          ? { team_id: input.team_id }
          : {};
    const secret = input.provider === 'slack' ? input.webhook_url : input.token;
    const existing = await getIntegration(c.env.DB, projectId, provider);
    const now = Date.now();
    const sealed = secret ? await seal(c.env, secret) : (existing?.secret_ciphertext ?? null);
    await c.env.DB.prepare(
      `INSERT INTO integrations (id, project_id, provider, config, secret_ciphertext, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, provider) DO UPDATE SET config = excluded.config,
         secret_ciphertext = excluded.secret_ciphertext, enabled = excluded.enabled, updated_at = excluded.updated_at`,
    )
      .bind(
        existing?.id ?? newId(),
        projectId,
        provider,
        JSON.stringify(config),
        sealed,
        input.enabled ? 1 : 0,
        principal.type === 'user' ? principal.user.id : null,
        existing?.created_at ?? now,
        now,
      )
      .run();
    return c.json(
      toIntegration(
        orThrow(await getIntegration(c.env.DB, projectId, provider), notFound('integration')),
      ),
      200,
    );
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/projects/{projectId}/integrations/{provider}',
    tags: ['Integrations'],
    summary: 'Disconnect an integration',
    description: 'Deletes the stored credentials. Links to issues already created are kept.',
    request: { params: ProviderParams },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { projectId, provider } = c.req.valid('param');
    await requireProject(c, projectId, 'webhook.manage');
    const result = await c.env.DB.prepare(
      'DELETE FROM integrations WHERE project_id = ? AND provider = ?',
    )
      .bind(projectId, provider)
      .run();
    if (result.meta.changes === 0) throw notFound('integration');
    return c.body(null, 204);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/comments/{commentId}/external-issue',
    tags: ['Integrations'],
    summary: 'Create a GitHub or Linear issue',
    description:
      'Creates an issue from the comment (with page, element and environment details) and links it back.',
    request: { params: idParam('commentId', 'Comment id'), ...body(S.CreateExternalIssueInput) },
    responses: {
      201: json(S.ExternalLink, 'Issue created'),
      409: problem('Already linked to this provider'),
    },
  }),
  async (c) => {
    const { commentId } = c.req.valid('param');
    const { provider } = c.req.valid('json');
    const { scope } = await loadScoped(c, {
      from: 'comments x JOIN projects p ON p.id = x.project_id',
      id: commentId,
      permission: 'comment.write',
      resource: 'comment',
    });
    const linked = await c.env.DB.prepare(
      'SELECT url FROM external_links WHERE comment_id = ? AND provider = ?',
    )
      .bind(commentId, provider)
      .first<{ url: string }>();
    if (linked) throw conflict('already_linked', `Already linked: ${linked.url}`);
    const integration = orThrow(
      await getIntegration(c.env.DB, scope.projectId, provider),
      notFound('integration'),
    );
    const comment = orThrow(await getComment(c.env.DB, commentId), notFound('comment'));
    const issue = await createExternalIssue(c.env, integration, comment);
    const link = {
      id: newId(),
      provider,
      external_id: issue.externalId,
      url: issue.url,
      created_at: Date.now(),
    };
    const uow = new UnitOfWork(c.env).add(
      c.env.DB.prepare(
        `INSERT INTO external_links (id, comment_id, integration_id, provider, external_id, url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        link.id,
        commentId,
        integration.id,
        provider,
        link.external_id,
        link.url,
        link.created_at,
      ),
    );
    uow.event({
      type: 'comment.updated',
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actor: actorOf(c.get('principal')),
      subjectType: 'comment',
      subjectId: commentId,
      data: { number: comment.number, external_issue: { provider, url: link.url } },
    });
    await uow.commit(c);
    return c.json(link, 201);
  },
);

export default app;
