import type { ActivityEvent, ProjectWithStats } from '@croquis/client';
import { useState } from 'preact/hooks';
import { Page, PageHeader } from '../../layout/Page';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime, type MessageKey, t, timeAgo } from '../../lib/i18n';
import { useQuery } from '../../lib/query';
import { toast } from '../../lib/toast';
import { Button } from '../../ui/Button';
import { Avatar, EmptyState, Skeleton } from '../../ui/Display';

export function describeEvent(event: ActivityEvent): string {
  const data = event.data as Record<string, unknown>;
  const to = typeof data.to === 'string' ? t(`status.${data.to}` as MessageKey) : '';
  return t(`event.${event.type}` as MessageKey, {
    path: String(data.path ?? ''),
    number: String(data.number ?? ''),
    to,
  });
}

function eventLink(projectId: string, event: ActivityEvent): string | null {
  if (event.subject_type === 'comment' && event.type !== 'comment.deleted')
    return `/projects/${projectId}/inbox?comment=${event.subject_id}`;
  if (event.subject_type === 'page' && event.type !== 'page.deleted')
    return `/projects/${projectId}/pages?page=${event.subject_id}`;
  return null;
}

export function ActivityPage({ project }: { project: ProjectWithStats }) {
  const first = useQuery(
    ['activity', project.id],
    () => api.projects.activity(project.id, { limit: 50 }),
    { refreshMs: 30_000 },
  );
  const [older, setOlder] = useState<{ items: ActivityEvent[]; cursor: string | null } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const items = [...(first.data?.data ?? []), ...(older?.items ?? [])];
  const cursor = older ? older.cursor : (first.data?.next_cursor ?? null);

  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await api.projects.activity(project.id, { cursor, limit: 50 });
      setOlder({ items: [...(older?.items ?? []), ...page.data], cursor: page.next_cursor });
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page narrow>
      <PageHeader title={t('activity.title')} />
      {first.loading ? (
        <Skeleton lines={6} />
      ) : items.length === 0 ? (
        <EmptyState title={t('activity.empty')} />
      ) : (
        <div class="c-card c-card--flush">
          {items.map((event) => {
            const href = eventLink(project.id, event);
            const body = (
              <>
                <Avatar
                  name={event.actor.name}
                  kind={
                    event.actor.type === 'guest'
                      ? 'guest'
                      : event.actor.type === 'user'
                        ? 'user'
                        : 'agent'
                  }
                  small
                />
                <span class="u-grow u-text-sm">
                  <strong>{event.actor.name ?? t('source.api')}</strong> {describeEvent(event)}
                </span>
                <span class="u-muted u-text-xs" title={formatDateTime(event.created_at)}>
                  {timeAgo(event.created_at)}
                </span>
              </>
            );
            return href ? (
              <a key={event.id} class="c-list-row c-list-row--link" href={href}>
                {body}
              </a>
            ) : (
              <div key={event.id} class="c-list-row">
                {body}
              </div>
            );
          })}
          {cursor ? (
            <div class="c-list-row">
              <Button variant="ghost" block loading={loading} onClick={loadMore}>
                {t('inbox.loadMore')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Page>
  );
}
