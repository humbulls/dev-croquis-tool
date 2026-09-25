import type { Comment, ProjectWithStats } from '@croquis/client';
import { Camera, MessageSquareText, Sparkles, Wand2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { api, errorMessage } from '../../lib/api';
import { t, timeAgo } from '../../lib/i18n';
import { useComments, useLabels, useMembers, usePages } from '../../lib/queries';
import { invalidate } from '../../lib/query';
import { instance, me, workspace } from '../../lib/session';
import { toast } from '../../lib/toast';
import { Button, buttonClass } from '../../ui/Button';
import { Avatar, EmptyState, LabelChip, PriorityIcon, Skeleton, StatusDot } from '../../ui/Display';
import { Modal } from '../../ui/Modal';
import { CommentInspector, commentTitle } from './CommentInspector';
import {
  FilterBar,
  filtersFromQuery,
  filtersToQuery,
  type InboxFilters,
  toApiFilters,
} from './FilterBar';

function CommentRow({
  comment,
  selected,
  href,
  pageLabel,
}: {
  comment: Comment;
  selected: boolean;
  href: string;
  pageLabel: string | null;
}) {
  return (
    <a
      class={`c-comment-row${selected ? ' is-selected' : ''}`}
      href={href}
      aria-current={selected ? 'true' : undefined}
      data-comment-id={comment.id}
    >
      <span class="c-comment-row__lead">
        <PriorityIcon priority={comment.priority} />
        <StatusDot status={comment.status} label={t(`status.${comment.status}`)} />
        <span class="c-comment-row__number">#{comment.number}</span>
      </span>
      <span class="c-comment-row__main">
        <span class="c-comment-row__title">{commentTitle(comment)}</span>
        <span class="c-comment-row__meta">
          <span>{comment.author.name ?? '—'}</span>
          <span>·</span>
          <span class="u-mono">{pageLabel ?? comment.page_path}</span>
          {comment.kind !== 'feedback' ? <span>· {t(`kind.${comment.kind}`)}</span> : null}
          {comment.labels.map((l) => (
            <LabelChip key={l.id} name={l.name} color={l.color} />
          ))}
        </span>
      </span>
      <span class="c-comment-row__aside">
        {comment.screenshot ? (
          <Camera class="c-icon c-icon--sm" aria-label={t('inbox.screenshot')} />
        ) : null}
        {comment.reply_count ? (
          <span class="o-cluster o-cluster--nowrap">
            <MessageSquareText class="c-icon c-icon--sm" />
            {comment.reply_count}
          </span>
        ) : null}
        {comment.assignee ? (
          <Avatar name={comment.assignee.name} image={comment.assignee.image} small />
        ) : null}
        <span class="u-hide-mobile">{timeAgo(comment.created_at)}</span>
      </span>
    </a>
  );
}

function AiActions({ projectId }: { projectId: string }) {
  const [digest, setDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState<'digest' | 'triage' | null>(null);
  if (!instance.value?.ai_enabled) return null;

  const runDigest = async () => {
    setBusy('digest');
    try {
      setDigest((await api.ai.digest(projectId)).markdown);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const runTriage = async () => {
    setBusy('triage');
    try {
      const result = await api.ai.triage(projectId);
      toast(t('ai.triageDone', { titled: result.titled, duplicates: result.duplicates_marked }));
      await invalidate(['comments', projectId]);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={<Wand2 class="c-icon c-icon--sm" />}
        loading={busy === 'triage'}
        onClick={runTriage}
      >
        {t('ai.triage')}
      </Button>
      <Button
        size="sm"
        icon={<Sparkles class="c-icon c-icon--sm" />}
        loading={busy === 'digest'}
        onClick={runDigest}
      >
        {t('ai.digest')}
      </Button>
      <Modal open={digest !== null} onClose={() => setDigest(null)} title={t('ai.digestTitle')}>
        <div class="u-pre-wrap u-text-sm">{digest}</div>
      </Modal>
    </>
  );
}

export function InboxPage({ project }: { project: ProjectWithStats }) {
  const { path, query, route } = useLocation();
  const filters = filtersFromQuery(query);
  const selectedId = query.comment ?? null;
  const apiFilters = toApiFilters(filters);
  const comments = useComments(project.id, apiFilters);
  // Further pages are fetched with the cursor and appended; they reset when filters change.
  const [more, setMore] = useState<{ items: Comment[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const filterKey = JSON.stringify(apiFilters);
  useEffect(() => setMore(null), [filterKey]);
  const loadMore = async () => {
    const cursor = more ? more.cursor : (comments.data?.next_cursor ?? null);
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api.comments.list(project.id, { ...apiFilters, cursor });
      setMore({ items: [...(more?.items ?? []), ...page.data], cursor: page.next_cursor });
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setLoadingMore(false);
    }
  };
  const pages = usePages(project.id);
  const members = useMembers(workspace.value?.id);
  const labels = useLabels(project.id);

  const hrefFor = (next: InboxFilters, comment: string | null = selectedId) => {
    const params = new URLSearchParams(filtersToQuery(next));
    if (comment) params.set('comment', comment);
    const qs = params.toString();
    return `${path}${qs ? `?${qs}` : ''}`;
  };
  const list = [...(comments.data?.data ?? []), ...(more?.items ?? [])];
  const hasMore = more ? more.cursor !== null : Boolean(comments.data?.next_cursor);
  const pageLabels = new Map((pages.data ?? []).map((p) => [p.id, p.title || p.path]));

  // j / k move through the list, Escape closes the inspector.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return;
      if (event.key === 'Escape' && selectedId) route(hrefFor(filters, null), true);
      if (event.key !== 'j' && event.key !== 'k') return;
      const index = list.findIndex((c) => c.id === selectedId);
      const next =
        list[event.key === 'j' ? Math.min(list.length - 1, index + 1) : Math.max(0, index - 1)];
      if (next) {
        route(hrefFor(filters, next.id), true);
        document
          .querySelector(`[data-comment-id="${next.id}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [list, selectedId, filters]);

  const noFilters =
    !filters.status.length &&
    !filters.priority.length &&
    !filters.kind.length &&
    !filters.page &&
    !filters.assignee &&
    !filters.label &&
    !filters.q;

  return (
    <div class={`o-split${selectedId ? '' : ' o-split--collapsed'}`}>
      <div>
        <FilterBar
          filters={filters}
          onChange={(next) => route(hrefFor(next), true)}
          pages={pages.data ?? []}
          members={members.data ?? []}
          labels={labels.data ?? []}
          currentUserId={me.value?.user.id ?? null}
          actions={<AiActions projectId={project.id} />}
        />
        {comments.loading ? (
          <div class="c-inspector__section">
            <Skeleton lines={8} />
          </div>
        ) : list.length === 0 ? (
          noFilters && project.stats.comments_total === 0 ? (
            <EmptyState
              title={t('inbox.emptyFirst')}
              text={t('inbox.emptyFirstText')}
              action={
                <a class={buttonClass('primary')} href={`/projects/${project.id}/settings`}>
                  {t('settings.widget')}
                </a>
              }
            />
          ) : (
            <EmptyState title={t('inbox.empty')} text={t('inbox.emptyText')} />
          )
        ) : (
          <div class="c-comment-list">
            {list.map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                selected={comment.id === selectedId}
                href={hrefFor(filters, comment.id)}
                pageLabel={comment.page_id ? (pageLabels.get(comment.page_id) ?? null) : null}
              />
            ))}
            {hasMore ? (
              <div class="c-list-row">
                <Button variant="ghost" block loading={loadingMore} onClick={loadMore}>
                  {t('inbox.loadMore')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {selectedId ? (
        <CommentInspector
          key={selectedId}
          commentId={selectedId}
          pages={pages.data ?? []}
          members={members.data ?? []}
          labels={labels.data ?? []}
          onClose={() => route(hrefFor(filters, null), true)}
        />
      ) : null}
    </div>
  );
}
