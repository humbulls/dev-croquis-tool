import type { ProjectWithStats, ReviewRound, ShareLink } from '@croquis/client';
import { Copy, ExternalLink, Globe, Lock, Plus } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { Page, PageHeader } from '../../layout/Page';
import { api, errorMessage } from '../../lib/api';
import { copyText } from '../../lib/copy';
import { formatDate, t, timeAgo } from '../../lib/i18n';
import { invalidate, useQuery } from '../../lib/query';
import { toast } from '../../lib/toast';
import { Button } from '../../ui/Button';
import { Badge, EmptyState, Skeleton } from '../../ui/Display';
import { Checkbox, Field, Input } from '../../ui/Form';
import { Menu, MenuItem } from '../../ui/Menu';
import { Modal } from '../../ui/Modal';

function linkState(link: ShareLink): 'active' | 'revoked' | 'expired' {
  if (link.revoked_at) return 'revoked';
  if (link.expires_at && link.expires_at <= Date.now()) return 'expired';
  return 'active';
}

function NewLinkDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('share.new')}
      onSubmit={async (event) => {
        const data = new FormData(event.target as HTMLFormElement);
        const password = String(data.get('password') ?? '');
        const expires = String(data.get('expires') ?? '');
        setBusy(true);
        setError(null);
        try {
          const link = await api.shareLinks.create(projectId, {
            label: String(data.get('label') ?? ''),
            password: password || undefined,
            allow_comments: data.get('allow_comments') === 'on',
            allow_approvals: data.get('allow_approvals') === 'on',
            expires_at: expires ? new Date(`${expires}T23:59:59`).getTime() : null,
          });
          await invalidate(['share-links', projectId]);
          await copyText(`${location.origin}/s/${link.slug}`);
          onClose();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <Field label={t('share.label')} error={error} optional>
        {(id) => (
          <Input
            id={id}
            name="label"
            maxLength={80}
            placeholder={t('share.labelPlaceholder')}
            autoFocus
          />
        )}
      </Field>
      <Field label={t('share.password')} hint={t('share.passwordHint')} optional>
        {(id) => <Input id={id} name="password" type="text" minLength={8} autoComplete="off" />}
      </Field>
      <Field label={t('share.expires')} optional>
        {(id) => (
          <Input id={id} name="expires" type="date" min={new Date().toISOString().slice(0, 10)} />
        )}
      </Field>
      <Checkbox name="allow_comments" defaultChecked label={t('share.allowComments')} />
      <Checkbox name="allow_approvals" defaultChecked label={t('share.allowApprovals')} />
    </Modal>
  );
}

function RoundsSection({ projectId }: { projectId: string }) {
  const rounds = useQuery(
    ['rounds', projectId],
    async () => (await api.reviewRounds.list(projectId)).data,
  );
  const [creating, setCreating] = useState(false);
  const update = async (round: ReviewRound, status: ReviewRound['status']) => {
    try {
      await api.reviewRounds.update(round.id, { status });
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
    await invalidate(['rounds', projectId]);
  };
  return (
    <section class="o-stack">
      <div class="o-cluster o-cluster--between">
        <div class="o-stack o-stack--xs">
          <h2>{t('share.rounds')}</h2>
          <p class="u-secondary u-text-sm">{t('share.roundsHint')}</p>
        </div>
        <Button icon={<Plus class="c-icon" />} onClick={() => setCreating(true)}>
          {t('share.newRound')}
        </Button>
      </div>
      <div class="c-card c-card--flush">
        {(rounds.data ?? []).length === 0 ? <p class="c-list-row u-muted u-text-sm">—</p> : null}
        {(rounds.data ?? []).map((round) => (
          <div key={round.id} class="c-list-row">
            <Badge tone={round.status === 'open' ? 'accent' : 'neutral'}>
              {round.status === 'open' ? t('share.roundOpen') : t('share.roundClosed')}
            </Badge>
            <span class="u-grow o-stack o-stack--xs">
              <strong>{round.name}</strong>
              <span class="u-muted u-text-xs">
                {formatDate(round.created_at)}
                {round.closed_at ? ` – ${formatDate(round.closed_at)}` : ''}
              </span>
            </span>
            {round.preview_url ? (
              <a
                class="c-btn c-btn--ghost c-btn--sm"
                href={round.preview_url}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink class="c-icon c-icon--sm" />
                {t('share.previewUrl')}
              </a>
            ) : null}
            <Button
              size="sm"
              onClick={() => update(round, round.status === 'open' ? 'closed' : 'open')}
            >
              {round.status === 'open' ? t('share.closeRound') : t('share.reopenRound')}
            </Button>
          </div>
        ))}
      </div>
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t('share.newRound')}
        onSubmit={async (event) => {
          const data = new FormData(event.target as HTMLFormElement);
          const preview = String(data.get('preview_url') ?? '').trim();
          try {
            await api.reviewRounds.open(projectId, {
              name: String(data.get('name')),
              preview_url: preview || null,
            });
            await invalidate(['rounds', projectId]);
            setCreating(false);
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
        <Field label={t('share.roundName')}>
          {(id) => <Input id={id} name="name" required maxLength={200} autoFocus />}
        </Field>
        <Field label={t('share.previewUrl')} optional>
          {(id) => (
            <Input
              id={id}
              name="preview_url"
              type="url"
              placeholder="https://preview-42.example.pages.dev"
            />
          )}
        </Field>
      </Modal>
    </section>
  );
}

export function SharePage({ project }: { project: ProjectWithStats }) {
  const links = useQuery(
    ['share-links', project.id],
    async () => (await api.shareLinks.list(project.id)).data,
  );
  const origins = useQuery(
    ['origins', project.id],
    async () => (await api.projects.origins(project.id)).data,
  );
  const [creating, setCreating] = useState(false);
  const site = origins.data?.[0];

  const revoke = async (link: ShareLink) => {
    await api.shareLinks.update(link.id, { revoked: true });
    await invalidate(['share-links', project.id]);
  };

  return (
    <Page>
      <PageHeader
        title={t('share.title')}
        subtitle={t('share.subtitle')}
        actions={
          <Button
            variant="primary"
            icon={<Plus class="c-icon" />}
            onClick={() => setCreating(true)}
          >
            {t('share.new')}
          </Button>
        }
      />
      <div class="o-stack o-stack--xl">
        <section class="o-stack">
          <h2>{t('share.links')}</h2>
          {links.loading ? (
            <Skeleton />
          ) : (links.data ?? []).length === 0 ? (
            <EmptyState
              title={t('share.empty')}
              text={t('share.subtitle')}
              action={
                <Button
                  variant="primary"
                  icon={<Plus class="c-icon" />}
                  onClick={() => setCreating(true)}
                >
                  {t('share.new')}
                </Button>
              }
            />
          ) : (
            <div class="c-card c-card--flush">
              {(links.data ?? []).map((link) => {
                const state = linkState(link);
                const reviewUrl = `${location.origin}/s/${link.slug}`;
                const siteUrl = site
                  ? `${site.origin}${site.base_path === '/' ? '/' : `${site.base_path}/`}?croquis=${link.slug}`
                  : null;
                return (
                  <div key={link.id} class="c-list-row">
                    <span class="u-grow o-stack o-stack--xs">
                      <span class="o-cluster">
                        <strong>{link.label || link.slug}</strong>
                        {link.password_protected ? (
                          <Lock
                            class="c-icon c-icon--sm u-muted"
                            aria-label={t('share.password')}
                          />
                        ) : null}
                        {state !== 'active' ? (
                          <Badge tone="danger">
                            {t(state === 'revoked' ? 'share.revoked' : 'share.expired')}
                          </Badge>
                        ) : null}
                      </span>
                      <span class="u-muted u-text-xs">
                        {[
                          link.allow_comments ? t('share.allowComments') : null,
                          link.allow_approvals ? t('share.allowApprovals') : null,
                          link.expires_at
                            ? `${t('share.expires')} ${formatDate(link.expires_at)}`
                            : null,
                          link.last_viewed_at
                            ? t('share.lastViewed', { time: timeAgo(link.last_viewed_at) })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {state === 'active' ? (
                      <>
                        <Button
                          size="sm"
                          icon={<Copy class="c-icon c-icon--sm" />}
                          onClick={() => copyText(reviewUrl)}
                        >
                          {t('share.copyLink')}
                        </Button>
                        <Menu
                          align="right"
                          trigger={(props) => (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={props.toggle}
                              aria-expanded={props['aria-expanded']}
                            >
                              {t('common.more')}
                            </Button>
                          )}
                        >
                          {(close) => (
                            <>
                              <MenuItem href={reviewUrl} onSelect={close}>
                                <ExternalLink class="c-icon c-icon--sm" />
                                {t('common.open')}
                              </MenuItem>
                              {siteUrl ? (
                                <MenuItem
                                  onSelect={() => {
                                    void copyText(siteUrl);
                                    close();
                                  }}
                                >
                                  <Globe class="c-icon c-icon--sm" />
                                  {t('share.copySiteLink')}
                                </MenuItem>
                              ) : null}
                              <MenuItem
                                danger
                                onSelect={() => {
                                  void revoke(link);
                                  close();
                                }}
                              >
                                {t('share.revoke')}
                              </MenuItem>
                            </>
                          )}
                        </Menu>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          {site ? <p class="u-muted u-text-xs">{t('share.siteLinkHint')}</p> : null}
        </section>
        <RoundsSection projectId={project.id} />
      </div>
      <NewLinkDialog projectId={project.id} open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
