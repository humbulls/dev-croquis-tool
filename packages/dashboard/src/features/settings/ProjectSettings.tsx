import type { Integration, LabelColor, ProjectWithStats, WebhookEndpoint } from '@croquis/client';
import { LABEL_COLORS, ORIGIN_ENVIRONMENTS } from '@croquis/shared/constants';
import { Plus, RefreshCw, Send, Trash2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Page, PageHeader, SettingsSection } from '../../layout/Page';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime, t, timeAgo } from '../../lib/i18n';
import { invalidate, useQuery } from '../../lib/query';
import { instance } from '../../lib/session';
import { toast } from '../../lib/toast';
import { Button, IconButton } from '../../ui/Button';
import { Badge, Callout, CodeBlock, LabelChip } from '../../ui/Display';
import { Field, Input, Select, Switch, Textarea } from '../../ui/Form';
import { Modal } from '../../ui/Modal';

async function attempt(work: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await work();
    if (success) toast(success);
    return true;
  } catch (error) {
    toast(errorMessage(error), { tone: 'error' });
    return false;
  }
}

function General({ project }: { project: ProjectWithStats }) {
  const [busy, setBusy] = useState(false);
  return (
    <SettingsSection title={t('settings.general')} description={t('settings.generalHint')}>
      <form
        class="o-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget as HTMLFormElement);
          setBusy(true);
          await attempt(
            () =>
              api.projects.update(project.id, {
                name: String(data.get('name')),
                description: String(data.get('description')),
                widget_mode: data.get('widget_mode') as ProjectWithStats['widget_mode'],
              }),
            t('common.saved'),
          );
          await Promise.all([invalidate(['project', project.id]), invalidate(['projects'])]);
          setBusy(false);
        }}
      >
        <Field label={t('projects.name')}>
          {(id) => <Input id={id} name="name" required maxLength={120} value={project.name} />}
        </Field>
        <Field label={t('common.description')} optional>
          {(id) => (
            <Textarea
              id={id}
              name="description"
              rows={2}
              maxLength={1000}
              value={project.description}
            />
          )}
        </Field>
        <Field label={t('projects.widgetMode')}>
          {(id) => (
            <Select
              id={id}
              name="widget_mode"
              value={project.widget_mode}
              options={(['activated', 'always', 'off'] as const).map((mode) => ({
                value: mode,
                label: t(`projects.mode.${mode}`),
              }))}
            />
          )}
        </Field>
        <div>
          <Button type="submit" variant="primary" loading={busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function Widget({ project }: { project: ProjectWithStats }) {
  const snippet = `<script src="${location.origin}/widget.js" data-croquis-key="${project.ingest_key}" defer></script>`;
  return (
    <SettingsSection title={t('settings.widget')} description={t('settings.widgetHint')}>
      <CodeBlock code={snippet} />
      <Field label={t('settings.ingestKey')} hint={t('settings.ingestKeyHint')}>
        {(id) => (
          <div class="o-cluster o-cluster--nowrap">
            <Input id={id} readOnly value={project.ingest_key} class="u-mono" />
            <Button
              icon={<RefreshCw class="c-icon c-icon--sm" />}
              onClick={async () => {
                if (!confirm(t('settings.rotateConfirm'))) return;
                await attempt(() => api.projects.rotateIngestKey(project.id));
                await invalidate(['project', project.id]);
              }}
            >
              {t('settings.rotateKey')}
            </Button>
          </div>
        )}
      </Field>
    </SettingsSection>
  );
}

function Origins({ project }: { project: ProjectWithStats }) {
  const origins = useQuery(
    ['origins', project.id],
    async () => (await api.projects.origins(project.id)).data,
  );
  return (
    <SettingsSection title={t('settings.origins')} description={t('settings.originsHint')}>
      {(origins.data ?? []).length === 0 ? (
        <Callout tone="warning">{t('settings.originsEmpty')}</Callout>
      ) : null}
      {(origins.data ?? []).length ? (
        <div class="c-card c-card--flush">
          {(origins.data ?? []).map((o) => (
            <div key={o.id} class="c-list-row">
              <span class="u-grow u-mono u-text-sm">
                {o.origin}
                {o.base_path !== '/' ? <span class="u-muted">{o.base_path}</span> : null}
              </span>
              <Badge>{o.environment}</Badge>
              <IconButton
                label={t('common.remove')}
                icon={<Trash2 class="c-icon c-icon--sm" />}
                onClick={async () => {
                  await attempt(() => api.projects.removeOrigin(o.id));
                  await invalidate(['origins', project.id]);
                }}
              />
            </div>
          ))}
        </div>
      ) : null}
      <form
        class="o-cluster"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget as HTMLFormElement;
          const data = new FormData(form);
          const ok = await attempt(() =>
            api.projects.addOrigin(project.id, {
              url: String(data.get('url')),
              base_path: String(data.get('base_path') || '/'),
              environment: data.get('environment') as (typeof ORIGIN_ENVIRONMENTS)[number],
            }),
          );
          if (ok) form.reset();
          await invalidate(['origins', project.id]);
        }}
      >
        <Input
          name="url"
          type="url"
          required
          placeholder="https://www.example.com"
          class="u-grow"
          aria-label={t('projects.origin')}
        />
        <Input
          name="base_path"
          placeholder="/"
          aria-label={t('settings.basePath')}
          class="u-mono"
        />
        <Select
          name="environment"
          aria-label={t('settings.environment')}
          options={ORIGIN_ENVIRONMENTS.map((e) => ({ value: e, label: e }))}
        />
        <Button type="submit" icon={<Plus class="c-icon c-icon--sm" />}>
          {t('settings.addOrigin')}
        </Button>
      </form>
    </SettingsSection>
  );
}

function Labels({ project }: { project: ProjectWithStats }) {
  const labels = useQuery(
    ['labels', project.id],
    async () => (await api.labels.list(project.id)).data,
  );
  const [color, setColor] = useState<LabelColor>('blue');
  return (
    <SettingsSection title={t('settings.labels')} description={t('settings.labelsHint')}>
      <div class="o-cluster">
        {(labels.data ?? []).map((label) => (
          <span key={label.id} class="o-cluster o-cluster--nowrap">
            <LabelChip name={label.name} color={label.color} />
            <IconButton
              size="sm"
              label={`${t('common.delete')} ${label.name}`}
              icon={<Trash2 class="c-icon c-icon--sm" />}
              onClick={async () => {
                await attempt(() => api.labels.delete(label.id));
                await invalidate(['labels', project.id]);
              }}
            />
          </span>
        ))}
      </div>
      <form
        class="o-cluster"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget as HTMLFormElement;
          const name = String(new FormData(form).get('name')).trim();
          if (!name) return;
          if (await attempt(() => api.labels.create(project.id, { name, color }))) form.reset();
          await invalidate(['labels', project.id]);
        }}
      >
        <Input
          name="name"
          maxLength={40}
          required
          placeholder={t('settings.addLabel')}
          aria-label={t('settings.addLabel')}
        />
        <Select
          value={color}
          onChange={(e) => setColor((e.target as HTMLSelectElement).value as LabelColor)}
          aria-label="Color"
          options={LABEL_COLORS.map((c) => ({ value: c, label: c }))}
        />
        <LabelChip name={t('settings.addLabel')} color={color} />
        <Button type="submit" icon={<Plus class="c-icon c-icon--sm" />}>
          {t('common.create')}
        </Button>
      </form>
    </SettingsSection>
  );
}

function IntegrationCard({
  project,
  provider,
  current,
}: {
  project: ProjectWithStats;
  provider: Integration['provider'];
  current: Integration | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const title = t(`settings.${provider}`);
  const hint = t(`settings.${provider}Hint`);
  return (
    <div class="c-card">
      <div class="c-card__header">
        <div class="o-stack o-stack--xs">
          <span class="c-card__title">{title}</span>
          <span class="c-card__meta">{hint}</span>
        </div>
        {current ? <Badge tone="success">{t('settings.connected')}</Badge> : null}
      </div>
      {current && !editing ? (
        <div class="o-cluster o-cluster--between">
          <span class="u-mono u-text-sm u-secondary">
            {Object.values(current.config).join(' / ') || '••••'}
          </span>
          <span class="o-cluster">
            <Button size="sm" onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await attempt(() => api.integrations.remove(project.id, provider));
                await invalidate(['integrations', project.id]);
              }}
            >
              {t('settings.disconnect')}
            </Button>
          </span>
        </div>
      ) : editing || !current ? (
        <form
          class="o-stack o-stack--sm"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = Object.fromEntries(
              new FormData(event.currentTarget as HTMLFormElement),
            ) as Record<string, string>;
            const input =
              provider === 'github'
                ? {
                    provider,
                    owner: data.owner ?? '',
                    repo: data.repo ?? '',
                    token: data.token || undefined,
                    enabled: true,
                  }
                : provider === 'linear'
                  ? {
                      provider,
                      team_id: data.team_id ?? '',
                      token: data.token || undefined,
                      enabled: true,
                    }
                  : { provider, webhook_url: data.webhook_url || undefined, enabled: true };
            if (await attempt(() => api.integrations.upsert(project.id, input), t('common.saved')))
              setEditing(false);
            await invalidate(['integrations', project.id]);
          }}
        >
          {provider === 'github' ? (
            <div class="o-cluster o-cluster--nowrap">
              <Input
                name="owner"
                required
                placeholder="owner"
                value={current?.config.owner ?? ''}
                aria-label="Owner"
              />
              <Input
                name="repo"
                required
                placeholder="repo"
                value={current?.config.repo ?? ''}
                aria-label="Repository"
              />
            </div>
          ) : null}
          {provider === 'linear' ? (
            <Input
              name="team_id"
              required
              placeholder="Team ID"
              value={current?.config.team_id ?? ''}
              aria-label="Team ID"
            />
          ) : null}
          {provider === 'slack' ? (
            <Input
              name="webhook_url"
              type="url"
              required={!current}
              placeholder="https://hooks.slack.com/services/…"
              aria-label="Webhook URL"
            />
          ) : (
            <Input
              name="token"
              type="password"
              required={!current}
              placeholder={
                current ? '••••••••' : provider === 'github' ? 'github_pat_…' : 'lin_api_…'
              }
              aria-label="Token"
              autoComplete="off"
            />
          )}
          <div class="o-cluster">
            <Button type="submit" size="sm" variant="primary">
              {current ? t('common.save') : t('settings.connect')}
            </Button>
            {editing ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Integrations({ project }: { project: ProjectWithStats }) {
  const integrations = useQuery(
    ['integrations', project.id],
    async () => (await api.integrations.list(project.id)).data,
  );
  const find = (p: Integration['provider']) =>
    (integrations.data ?? []).find((i) => i.provider === p);
  return (
    <SettingsSection
      title={t('settings.integrations')}
      description={t('settings.integrationsHint')}
    >
      {(['github', 'linear', 'slack'] as const).map((provider) => (
        <IntegrationCard
          key={provider}
          project={project}
          provider={provider}
          current={find(provider)}
        />
      ))}
    </SettingsSection>
  );
}

function Deliveries({ webhook }: { webhook: WebhookEndpoint }) {
  const deliveries = useQuery(
    ['deliveries', webhook.id],
    async () => (await api.webhooks.deliveries(webhook.id, { limit: 10 })).data,
  );
  if (!deliveries.data?.length) return null;
  return (
    <table class="c-table">
      <thead>
        <tr>
          <th>{t('common.kind')}</th>
          <th>{t('common.status')}</th>
          <th>HTTP</th>
          <th>{t('common.updated')}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {deliveries.data.map((d) => (
          <tr key={d.id}>
            <td class="u-mono u-text-xs">{d.event_type}</td>
            <td>
              <Badge
                tone={
                  d.status === 'succeeded'
                    ? 'success'
                    : d.status === 'pending'
                      ? 'neutral'
                      : 'danger'
                }
              >
                {d.status}
              </Badge>
            </td>
            <td class="u-nums">{d.last_status_code ?? '—'}</td>
            <td class="u-muted" title={formatDateTime(d.updated_at)}>
              {timeAgo(d.updated_at)}
            </td>
            <td>
              {d.status !== 'succeeded' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await attempt(() => api.webhooks.retry(d.id));
                    await invalidate(['deliveries', webhook.id]);
                  }}
                >
                  {t('common.retry')}
                </Button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Webhooks({ project }: { project: ProjectWithStats }) {
  const webhooks = useQuery(
    ['webhooks', project.id],
    async () => (await api.webhooks.list(project.id)).data,
  );
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <SettingsSection title={t('settings.webhooks')} description={t('settings.webhooksHint')}>
      {(webhooks.data ?? []).map((webhook) => (
        <div key={webhook.id} class="c-card">
          <div class="c-card__header">
            <span class="u-mono u-text-sm u-truncate">{webhook.url}</span>
            <span class="o-cluster o-cluster--nowrap">
              <Switch
                label={t('common.enabled')}
                checked={webhook.enabled}
                onChange={async (e) => {
                  await attempt(() =>
                    api.webhooks.update(webhook.id, {
                      enabled: (e.target as HTMLInputElement).checked,
                    }),
                  );
                  await invalidate(['webhooks', project.id]);
                }}
              />
              <Button
                size="sm"
                icon={<Send class="c-icon c-icon--sm" />}
                onClick={async () => {
                  const result = await api.webhooks.test(webhook.id);
                  toast(result.ok ? `✓ HTTP ${result.status}` : (result.error ?? 'Failed'), {
                    tone: result.ok ? 'default' : 'error',
                  });
                }}
              >
                {t('settings.testWebhook')}
              </Button>
              <IconButton
                label={t('common.delete')}
                icon={<Trash2 class="c-icon c-icon--sm" />}
                onClick={async () => {
                  if (!confirm(t('common.confirmDelete'))) return;
                  await attempt(() => api.webhooks.delete(webhook.id));
                  await invalidate(['webhooks', project.id]);
                }}
              />
            </span>
          </div>
          <span class="u-muted u-text-xs">{webhook.event_types.join(', ')}</span>
          <Deliveries webhook={webhook} />
        </div>
      ))}
      <form
        class="o-cluster o-cluster--nowrap"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget as HTMLFormElement;
          const url = String(new FormData(form).get('url'));
          try {
            const created = await api.webhooks.create(project.id, { url });
            setSecret(created.secret);
            form.reset();
          } catch (error) {
            toast(errorMessage(error), { tone: 'error' });
          }
          await invalidate(['webhooks', project.id]);
        }}
      >
        <Input
          name="url"
          type="url"
          required
          pattern="https://.*"
          placeholder="https://example.com/hooks/croquis"
          class="u-grow"
          aria-label="URL"
        />
        <Button type="submit" icon={<Plus class="c-icon c-icon--sm" />}>
          {t('settings.addWebhook')}
        </Button>
      </form>
      <Modal
        open={secret !== null}
        onClose={() => setSecret(null)}
        title={t('settings.webhookSecret')}
      >
        <CodeBlock code={secret ?? ''} />
      </Modal>
    </SettingsSection>
  );
}

function AiSection({ project }: { project: ProjectWithStats }) {
  const runs = useQuery(
    instance.value?.ai_enabled ? ['ai-runs', project.id] : null,
    async () => (await api.ai.runs(project.id, { limit: 10 })).data,
  );
  return (
    <SettingsSection title={t('settings.ai')} description={t('settings.aiHint')}>
      {!instance.value?.ai_enabled ? <Callout>{t('settings.aiOff')}</Callout> : null}
      {(runs.data ?? []).length ? (
        <table class="c-table">
          <thead>
            <tr>
              <th>{t('common.kind')}</th>
              <th>Model</th>
              <th>Tokens</th>
              <th>{t('common.status')}</th>
              <th>{t('common.created')}</th>
            </tr>
          </thead>
          <tbody>
            {(runs.data ?? []).map((run) => (
              <tr key={run.id}>
                <td>{run.kind}</td>
                <td class="u-mono u-text-xs">{run.model}</td>
                <td class="u-nums">
                  {run.input_tokens !== null ? `${run.input_tokens} / ${run.output_tokens}` : '—'}
                </td>
                <td>
                  <Badge
                    tone={run.status === 'succeeded' ? 'success' : 'danger'}
                    title={run.error ?? undefined}
                  >
                    {run.status}
                  </Badge>
                </td>
                <td class="u-muted">{timeAgo(run.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </SettingsSection>
  );
}

function Danger({ project }: { project: ProjectWithStats }) {
  const { route } = useLocation();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  return (
    <SettingsSection title={t('settings.danger')} description={t('settings.dangerHint')}>
      <div>
        <Button
          variant="danger"
          icon={<Trash2 class="c-icon c-icon--sm" />}
          onClick={() => setConfirming(true)}
        >
          {t('settings.deleteProject')}
        </Button>
      </div>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('settings.deleteProject')}
        onSubmit={async () => {
          if (typed !== project.name) return;
          if (await attempt(() => api.projects.delete(project.id))) {
            await invalidate(['projects']);
            route('/projects', true);
          }
        }}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="danger" disabled={typed !== project.name}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <Callout tone="danger">{t('settings.dangerHint')}</Callout>
        <Field label={t('settings.deleteConfirm')}>
          {(id) => (
            <Input
              id={id}
              value={typed}
              onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
              placeholder={project.name}
            />
          )}
        </Field>
      </Modal>
    </SettingsSection>
  );
}

export function ProjectSettings({ project }: { project: ProjectWithStats }) {
  return (
    <Page>
      <PageHeader title={t('settings.title')} subtitle={project.name} />
      <General project={project} />
      <Widget project={project} />
      <Origins project={project} />
      <Labels project={project} />
      <Integrations project={project} />
      <Webhooks project={project} />
      <AiSection project={project} />
      <Danger project={project} />
    </Page>
  );
}
