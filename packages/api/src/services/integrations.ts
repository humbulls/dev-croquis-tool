import type { Comment, Integration, IntegrationProvider } from '@croquis/shared';
import { runtimeConfig } from '../config';
import type { Env } from '../env';
import { badGateway, unprocessable } from '../http/problem';
import { open } from '../security/secret-box';
import type { EventInput } from './unit-of-work';

/**
 * Outbound integrations: Slack notifications (best effort, after commit) and
 * one-click issue creation in GitHub or Linear. Credentials are stored sealed
 * (security/secret-box.ts) and only opened in memory for the outgoing call.
 */

export interface IntegrationRow {
  id: string;
  project_id: string;
  provider: IntegrationProvider;
  config: string;
  secret_ciphertext: string | null;
  enabled: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export function toIntegration(row: IntegrationRow): Integration {
  return {
    id: row.id,
    project_id: row.project_id,
    provider: row.provider,
    config: JSON.parse(row.config) as Record<string, string>,
    enabled: row.enabled === 1,
    has_secret: row.secret_ciphertext !== null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getIntegration(
  db: D1Database,
  projectId: string,
  provider: IntegrationProvider,
): Promise<IntegrationRow | null> {
  return db
    .prepare('SELECT * FROM integrations WHERE project_id = ? AND provider = ?')
    .bind(projectId, provider)
    .first<IntegrationRow>();
}

/** Link to a comment in the dashboard, when the instance knows its public URL. */
export function dashboardLink(env: Env, projectId: string, commentId?: string): string | null {
  const base = runtimeConfig(env).publicUrl;
  if (!base) return null;
  return commentId
    ? `${base}/projects/${projectId}/inbox?comment=${commentId}`
    : `${base}/projects/${projectId}`;
}

// --- Slack ------------------------------------------------------------------------

const SLACK_EVENTS = new Set([
  'comment.created',
  'comment.fixed',
  'page.approved',
  'page.changes_requested',
]);

function slackEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function slackMessage(env: Env, event: EventInput): { text: string } | null {
  const data = event.data as Record<string, string | number | null | undefined>;
  const who = event.actor.name ?? 'Someone';
  const link = event.projectId
    ? dashboardLink(
        env,
        event.projectId,
        event.subjectType === 'comment' ? event.subjectId : undefined,
      )
    : null;
  const suffix = link ? ` <${link}|Open in Croquis>` : '';
  switch (event.type) {
    case 'comment.created':
      return {
        text: `💬 *#${data.number ?? ''}* new ${data.kind ?? 'feedback'} on \`${data.page_path ?? '/'}\` from ${slackEscape(who)}\n>${slackEscape(String(data.body ?? '')).slice(0, 300)}${suffix}`,
      };
    case 'comment.fixed':
      return {
        text: `✅ *#${data.number ?? ''}* fixed by ${slackEscape(who)} — ready for review${suffix}`,
      };
    case 'page.approved':
      return { text: `🟢 ${slackEscape(who)} approved \`${data.path ?? ''}\`${suffix}` };
    case 'page.changes_requested':
      return {
        text: `🟠 ${slackEscape(who)} requested changes on \`${data.path ?? ''}\`${suffix}`,
      };
    default:
      return null;
  }
}

/** Post a Slack message for events Slack users care about. Never throws. */
export async function notifyIntegrations(env: Env, event: EventInput): Promise<void> {
  if (!event.projectId || !SLACK_EVENTS.has(event.type)) return;
  try {
    const slack = await getIntegration(env.DB, event.projectId, 'slack');
    if (slack?.enabled !== 1 || !slack.secret_ciphertext) return;
    const message = slackMessage(env, event);
    if (!message) return;
    await fetch(await open(env, slack.secret_ciphertext), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error('slack notification failed', err instanceof Error ? err.message : err);
  }
}

// --- Issue trackers ------------------------------------------------------------------

export interface ExternalIssue {
  externalId: string;
  url: string;
}

export function issueTitle(comment: Comment): string {
  const text = (comment.title ?? comment.body).replace(/\s+/g, ' ').trim();
  return `[Croquis #${comment.number}] ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`;
}

export function issueBody(env: Env, comment: Comment): string {
  const lines = [
    comment.body,
    '',
    '---',
    `- **Page:** ${comment.page_url || comment.page_path}`,
    comment.anchor.selector ? `- **Element:** \`${comment.anchor.selector}\`` : null,
    comment.anchor.text ? `- **Element text:** ${comment.anchor.text.slice(0, 200)}` : null,
    comment.suggestion
      ? `- **Suggested text:** “${comment.suggestion.original}” → “${comment.suggestion.text}”`
      : null,
    `- **Environment:** ${[comment.environment.browser, comment.environment.os, comment.environment.viewport_w ? `${comment.environment.viewport_w}×${comment.environment.viewport_h}` : null].filter(Boolean).join(' · ') || 'unknown'}`,
    `- **Reported by:** ${comment.author.name ?? 'anonymous'}${comment.author.verified ? '' : ' (unverified)'}`,
  ];
  const link = dashboardLink(env, comment.project_id, comment.id);
  if (link) lines.push(`- **Croquis:** ${link}`);
  return lines.filter((line): line is string => line !== null).join('\n');
}

async function readFailure(response: Response): Promise<string> {
  return `${response.status} ${(await response.text()).slice(0, 200)}`;
}

export async function createExternalIssue(
  env: Env,
  integration: IntegrationRow,
  comment: Comment,
): Promise<ExternalIssue> {
  if (integration.enabled !== 1)
    throw unprocessable(
      'integration_disabled',
      `The ${integration.provider} integration is disabled`,
    );
  if (!integration.secret_ciphertext) {
    throw unprocessable(
      'integration_incomplete',
      `Add a ${integration.provider} token in the project integrations first`,
    );
  }
  const token = await open(env, integration.secret_ciphertext);
  const config = JSON.parse(integration.config) as Record<string, string>;

  if (integration.provider === 'github') {
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Croquis',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: issueTitle(comment), body: issueBody(env, comment) }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw badGateway('github_error', `GitHub refused the issue: ${await readFailure(response)}`);
    const issue = (await response.json()) as { number: number; html_url: string };
    return { externalId: String(issue.number), url: issue.html_url };
  }

  if (integration.provider === 'linear') {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query:
          'mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }',
        variables: {
          input: {
            teamId: config.team_id,
            title: issueTitle(comment),
            description: issueBody(env, comment),
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = (await response.json().catch(() => null)) as {
      data?: { issueCreate?: { success: boolean; issue?: { identifier: string; url: string } } };
      errors?: { message: string }[];
    } | null;
    const issue = result?.data?.issueCreate?.issue;
    if (!response.ok || !issue) {
      throw badGateway(
        'linear_error',
        `Linear refused the issue: ${result?.errors?.[0]?.message ?? response.status}`,
      );
    }
    return { externalId: issue.identifier, url: issue.url };
  }

  throw unprocessable('unsupported_provider', `${integration.provider} cannot create issues`);
}
