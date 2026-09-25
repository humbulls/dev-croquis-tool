import type { CreatedApiKey, Member, WorkspaceRole } from '@croquis/client';
import { KeyRound, Mail, Plus, Trash2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Page, PageHeader, SettingsSection } from '../../layout/Page';
import { api, errorMessage } from '../../lib/api';
import { formatDate, t, timeAgo } from '../../lib/i18n';
import { hasRole } from '../../lib/permissions';
import { useMembers, useProjects } from '../../lib/queries';
import { invalidate, useQuery } from '../../lib/query';
import { loadMe, me, workspace } from '../../lib/session';
import { toast } from '../../lib/toast';
import { Button, IconButton } from '../../ui/Button';
import { Avatar, Badge, Callout, CodeBlock, EmptyState } from '../../ui/Display';
import { Field, Input, Select } from '../../ui/Form';
import { Modal } from '../../ui/Modal';

function Members({ workspaceId }: { workspaceId: string }) {
  const members = useMembers(workspaceId);
  const invitations = useQuery(
    hasRole('admin') ? ['invitations', workspaceId] : null,
    async () => (await api.workspaces.invitations(workspaceId)).data,
  );
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);
  const isOwner = hasRole('owner');
  const canManage = hasRole('admin');

  const setRole = async (member: Member, role: WorkspaceRole) => {
    try {
      await api.workspaces.setRole(workspaceId, member.id, role);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
    await invalidate(['members', workspaceId]);
  };
  const remove = async (member: Member) => {
    if (!confirm(`${member.user.name} — ${t('common.remove')}?`)) return;
    try {
      await api.workspaces.removeMember(workspaceId, member.id);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
    await invalidate(['members', workspaceId]);
    if (member.user.id === me.value?.user.id) await loadMe();
  };

  return (
    <SettingsSection title={t('workspace.members')} description={t('workspace.membersHint')}>
      {canManage ? (
        <form
          class="o-cluster o-cluster--nowrap"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget as HTMLFormElement;
            const data = new FormData(form);
            const email = String(data.get('email'));
            try {
              const invitation = await api.workspaces.invite(workspaceId, {
                email,
                role: data.get('role') as 'member' | 'admin',
              });
              if (invitation.email_sent) toast(t('workspace.inviteSent', { email }));
              else setInviteLink({ email, url: invitation.url });
              form.reset();
            } catch (error) {
              toast(errorMessage(error), { tone: 'error' });
            }
            await invalidate(['invitations', workspaceId]);
          }}
        >
          <Input
            name="email"
            type="email"
            required
            placeholder={t('workspace.inviteEmail')}
            class="u-grow"
            aria-label={t('workspace.inviteEmail')}
          />
          <Select
            name="role"
            aria-label={t('common.status')}
            options={[
              { value: 'member', label: t('workspace.role.member') },
              { value: 'admin', label: t('workspace.role.admin') },
            ]}
          />
          <Button type="submit" variant="primary" icon={<Mail class="c-icon c-icon--sm" />}>
            {t('workspace.invite')}
          </Button>
        </form>
      ) : null}
      <div class="c-card c-card--flush">
        {(members.data ?? []).map((member) => {
          const self = member.user.id === me.value?.user.id;
          const editable = canManage && (isOwner || member.role !== 'owner');
          return (
            <div key={member.id} class="c-list-row">
              <Avatar name={member.user.name} image={member.user.image} />
              <span class="u-grow o-stack o-stack--xs">
                <strong>
                  {member.user.name}
                  {self ? <span class="u-muted"> ({t('common.you')})</span> : null}
                </strong>
                <span class="u-muted u-text-xs">{member.user.email}</span>
              </span>
              {editable ? (
                <Select
                  small
                  value={member.role}
                  aria-label={t('common.status')}
                  onChange={(e) =>
                    setRole(member, (e.target as HTMLSelectElement).value as WorkspaceRole)
                  }
                  options={(isOwner
                    ? (['owner', 'admin', 'member'] as const)
                    : (['admin', 'member'] as const)
                  ).map((r) => ({ value: r, label: t(`workspace.role.${r}`) }))}
                />
              ) : (
                <Badge>{t(`workspace.role.${member.role}`)}</Badge>
              )}
              {editable || self ? (
                <IconButton
                  label={self ? t('workspace.leave') : t('common.remove')}
                  icon={<Trash2 class="c-icon c-icon--sm" />}
                  onClick={() => remove(member)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {(invitations.data ?? []).length ? (
        <div class="o-stack o-stack--sm">
          <h4>{t('workspace.pending')}</h4>
          <div class="c-card c-card--flush">
            {(invitations.data ?? []).map((invitation) => (
              <div key={invitation.id} class="c-list-row">
                <Mail class="c-icon u-muted" />
                <span class="u-grow">{invitation.email}</span>
                <Badge>{t(`workspace.role.${invitation.role}`)}</Badge>
                <span class="u-muted u-text-xs">{formatDate(invitation.expires_at)}</span>
                <IconButton
                  label={t('workspace.revoke')}
                  icon={<Trash2 class="c-icon c-icon--sm" />}
                  onClick={async () => {
                    await api.workspaces.revokeInvitation(workspaceId, invitation.id);
                    await invalidate(['invitations', workspaceId]);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <Modal
        open={inviteLink !== null}
        onClose={() => setInviteLink(null)}
        title={t('workspace.invite')}
      >
        <p class="u-text-sm">{t('workspace.inviteCopy', { email: inviteLink?.email ?? '' })}</p>
        <CodeBlock code={inviteLink?.url ?? ''} />
      </Modal>
    </SettingsSection>
  );
}

function ApiKeys({ workspaceId }: { workspaceId: string }) {
  const keys = useQuery(
    ['api-keys', workspaceId],
    async () => (await api.workspaces.apiKeys(workspaceId)).data,
  );
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  return (
    <SettingsSection title={t('workspace.apiKeys')} description={t('workspace.apiKeysHint')}>
      <div>
        <Button icon={<Plus class="c-icon c-icon--sm" />} onClick={() => setCreating(true)}>
          {t('workspace.newKey')}
        </Button>
      </div>
      {(keys.data ?? []).length === 0 ? (
        <EmptyState
          icon={<KeyRound class="c-icon c-icon--lg" />}
          title={t('workspace.apiKeys')}
          text={t('workspace.apiKeysHint')}
        />
      ) : (
        <div class="c-card c-card--flush">
          {(keys.data ?? []).map((key) => (
            <div key={key.id} class="c-list-row">
              <KeyRound class="c-icon u-muted" />
              <span class="u-grow o-stack o-stack--xs">
                <strong>{key.name}</strong>
                <span class="u-muted u-text-xs u-mono">
                  {key.prefix} · {key.scopes.join(', ')}
                  {key.project_id
                    ? ` · ${(projects.data ?? []).find((p) => p.id === key.project_id)?.name ?? key.project_id}`
                    : ''}
                </span>
              </span>
              <span class="u-muted u-text-xs">
                {key.last_used_at
                  ? t('workspace.lastUsed', { time: timeAgo(key.last_used_at) })
                  : t('common.never')}
              </span>
              {key.revoked_at ? (
                <Badge tone="danger">{t('share.revoked')}</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(t('common.confirmDelete'))) return;
                    await api.workspaces.revokeApiKey(workspaceId, key.id);
                    await invalidate(['api-keys', workspaceId]);
                  }}
                >
                  {t('workspace.revoke')}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t('workspace.newKey')}
        onSubmit={async (event) => {
          const data = new FormData(event.target as HTMLFormElement);
          const projectId = String(data.get('project_id') ?? '');
          try {
            const key = await api.workspaces.createApiKey(workspaceId, {
              name: String(data.get('name')),
              project_id: projectId || null,
              scopes:
                data.get('scopes') === 'read'
                  ? ['projects:read', 'pages:read', 'comments:read']
                  : ['*'],
            });
            setCreating(false);
            setCreated(key);
            await invalidate(['api-keys', workspaceId]);
          } catch (error) {
            toast(errorMessage(error), { tone: 'error' });
          }
        }}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary">
              {t('common.create')}
            </Button>
          </>
        }
      >
        <Field label={t('workspace.keyName')}>
          {(id) => (
            <Input
              id={id}
              name="name"
              required
              maxLength={80}
              placeholder="Claude Code"
              autoFocus
            />
          )}
        </Field>
        <Field label={t('workspace.keyProject')}>
          {(id) => (
            <Select
              id={id}
              name="project_id"
              options={[
                { value: '', label: t('workspace.keyAllProjects') },
                ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          )}
        </Field>
        <Field label={t('workspace.keyScopes')}>
          {(id) => (
            <Select
              id={id}
              name="scopes"
              options={[
                { value: 'full', label: t('workspace.keyFull') },
                { value: 'read', label: t('workspace.keyReadOnly') },
              ]}
            />
          )}
        </Field>
      </Modal>
      <Modal open={created !== null} onClose={() => setCreated(null)} title={created?.name ?? ''}>
        <Callout tone="warning">{t('workspace.keyCreated')}</Callout>
        <CodeBlock code={created?.key ?? ''} />
        <McpGuide apiKey={created?.key ?? 'crq_…'} />
      </Modal>
    </SettingsSection>
  );
}

function McpGuide({ apiKey }: { apiKey: string }) {
  const origin = location.origin;
  return (
    <div class="o-stack o-stack--sm">
      <h4>{t('workspace.mcp')}</h4>
      <p class="u-secondary u-text-sm">{t('workspace.mcpHint')}</p>
      <span class="u-muted u-text-xs">Claude Code (remote)</span>
      <CodeBlock
        code={`claude mcp add --transport http croquis ${origin}/mcp --header "Authorization: Bearer ${apiKey}"`}
      />
      <span class="u-muted u-text-xs">Cursor / other clients (stdio)</span>
      <CodeBlock
        code={JSON.stringify(
          {
            mcpServers: {
              croquis: {
                command: 'npx',
                args: ['-y', '@croquis/mcp'],
                env: { CROQUIS_URL: origin, CROQUIS_API_KEY: apiKey },
              },
            },
          },
          null,
          2,
        )}
      />
    </div>
  );
}

export function WorkspaceSettings() {
  const { route } = useLocation();
  const current = workspace.value;
  const [busy, setBusy] = useState(false);
  if (!current) return null;
  return (
    <Page>
      <PageHeader title={t('workspace.title')} subtitle={current.name} />
      {hasRole('owner') ? (
        <SettingsSection title={t('workspace.general')}>
          <form
            class="o-cluster o-cluster--nowrap"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await api.workspaces.rename(
                  current.id,
                  String(new FormData(event.currentTarget as HTMLFormElement).get('name')),
                );
                await loadMe();
                toast(t('common.saved'));
              } catch (error) {
                toast(errorMessage(error), { tone: 'error' });
              } finally {
                setBusy(false);
              }
            }}
          >
            <Input
              name="name"
              required
              maxLength={80}
              value={current.name}
              class="u-grow"
              aria-label={t('common.name')}
            />
            <Button type="submit" variant="primary" loading={busy}>
              {t('common.save')}
            </Button>
          </form>
        </SettingsSection>
      ) : null}
      <Members workspaceId={current.id} />
      {hasRole('admin') ? <ApiKeys workspaceId={current.id} /> : null}
      <SettingsSection title={t('workspace.mcp')} description={t('workspace.mcpHint')}>
        <McpGuide apiKey="crq_…" />
      </SettingsSection>
      {hasRole('owner') ? (
        <SettingsSection title={t('settings.danger')}>
          <div>
            <Button
              variant="danger"
              icon={<Trash2 class="c-icon c-icon--sm" />}
              onClick={async () => {
                const typed = prompt(t('settings.deleteConfirm'));
                if (typed !== current.name) return;
                await api.workspaces.delete(current.id);
                await loadMe();
                route('/projects', true);
              }}
            >
              {t('workspace.deleteWorkspace')}
            </Button>
          </div>
        </SettingsSection>
      ) : null}
    </Page>
  );
}
