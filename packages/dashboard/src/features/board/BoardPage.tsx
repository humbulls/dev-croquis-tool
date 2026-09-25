import type { Comment, CommentStatus, Paginated, ProjectWithStats } from '@croquis/client';
import { COMMENT_STATUSES } from '@croquis/shared/constants';
import { MessageSquareText } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { api, errorMessage } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useLabels, useMembers, usePages } from '../../lib/queries';
import { invalidate, setQueryData, useQuery } from '../../lib/query';
import { workspace } from '../../lib/session';
import { toast } from '../../lib/toast';
import { Avatar, LabelChip, PriorityIcon, Skeleton, StatusDot } from '../../ui/Display';
import { CommentInspector, commentTitle } from '../inbox/CommentInspector';

const BOARD_KEY = (projectId: string) => ['comments', projectId, 'board'] as const;

function Card({
  comment,
  onOpen,
  selected,
}: {
  comment: Comment;
  onOpen: () => void;
  selected: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <button
      type="button"
      class={`c-board-card${dragging ? ' is-dragging' : ''}`}
      draggable
      aria-pressed={selected}
      onDragStart={(event) => {
        event.dataTransfer?.setData('text/plain', comment.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={onOpen}
    >
      <span class="o-cluster o-cluster--between">
        <span class="u-muted u-text-xs u-nums">#{comment.number}</span>
        <PriorityIcon priority={comment.priority} />
      </span>
      <span class="c-board-card__text">{commentTitle(comment)}</span>
      <span class="o-cluster o-cluster--between u-text-xs u-muted">
        <span class="u-mono u-truncate">{comment.page_path}</span>
        <span class="o-cluster o-cluster--nowrap">
          {comment.reply_count ? (
            <>
              <MessageSquareText class="c-icon c-icon--sm" />
              {comment.reply_count}
            </>
          ) : null}
          {comment.assignee ? (
            <Avatar name={comment.assignee.name} image={comment.assignee.image} small />
          ) : null}
        </span>
      </span>
      {comment.labels.length ? (
        <span class="o-cluster">
          {comment.labels.map((l) => (
            <LabelChip key={l.id} name={l.name} color={l.color} />
          ))}
        </span>
      ) : null}
    </button>
  );
}

export function BoardPage({ project }: { project: ProjectWithStats }) {
  const { path, query, route } = useLocation();
  const selectedId = query.comment ?? null;
  const [over, setOver] = useState<CommentStatus | null>(null);
  const board = useQuery(
    BOARD_KEY(project.id),
    () =>
      api.comments.list(project.id, {
        status: [...COMMENT_STATUSES],
        sort: 'priority',
        limit: 200,
      }),
    {
      refreshMs: 30_000,
    },
  );
  const pages = usePages(project.id);
  const members = useMembers(workspace.value?.id);
  const labels = useLabels(project.id);

  const move = async (commentId: string, status: CommentStatus) => {
    setQueryData<Paginated<Comment>>(BOARD_KEY(project.id), (current) =>
      current
        ? { ...current, data: current.data.map((c) => (c.id === commentId ? { ...c, status } : c)) }
        : current,
    );
    try {
      await api.comments.update(commentId, { status });
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
    await Promise.all([invalidate(['comments', project.id]), invalidate(['comment', commentId])]);
  };

  const open = (id: string | null) => route(id ? `${path}?comment=${id}` : path, true);
  const items = board.data?.data ?? [];

  return (
    <div class={`o-split${selectedId ? '' : ' o-split--collapsed'}`}>
      <div class="c-main">
        <p class="c-toolbar u-muted u-text-sm">{t('board.dragHint')}</p>
        {board.loading ? (
          <div class="c-inspector__section">
            <Skeleton lines={6} />
          </div>
        ) : (
          <div class="c-board">
            {COMMENT_STATUSES.map((status) => {
              const column = items.filter((c) => c.status === status);
              return (
                <section
                  key={status}
                  class={`c-board__column${over === status ? ' is-over' : ''}`}
                  aria-label={t(`status.${status}`)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setOver(status);
                  }}
                  onDragLeave={() => setOver((current) => (current === status ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    setOver(null);
                    const id = event.dataTransfer?.getData('text/plain');
                    if (id && items.find((c) => c.id === id)?.status !== status)
                      void move(id, status);
                  }}
                >
                  <header class="c-board__column-header">
                    <StatusDot status={status} />
                    {t(`status.${status}`)}
                    <span class="u-muted u-nums">{column.length}</span>
                  </header>
                  {column.length === 0 ? (
                    <p class="u-muted u-text-xs c-board__column-header">{t('board.empty')}</p>
                  ) : null}
                  {column.map((comment) => (
                    <Card
                      key={comment.id}
                      comment={comment}
                      selected={comment.id === selectedId}
                      onOpen={() => open(comment.id)}
                    />
                  ))}
                </section>
              );
            })}
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
          onClose={() => open(null)}
        />
      ) : null}
    </div>
  );
}
