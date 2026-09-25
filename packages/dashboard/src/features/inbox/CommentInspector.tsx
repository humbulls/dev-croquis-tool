import type {
  Comment,
  CommentDetail,
  Integration,
  Label,
  Member,
  PageWithStats,
  UpdateCommentInput,
} from '@croquis/client';
import {
  AlertTriangle,
  Bot,
  Camera,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  GitCommit,
  Globe,
  Languages,
  Link2,
  Monitor,
  MoreHorizontal,
  Trash2,
  X,
} from 'lucide-preact';
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { api, errorMessage } from '../../lib/api';
import { copyText } from '../../lib/copy';
import { formatDateTime, locale, t, timeAgo } from '../../lib/i18n';
import { useComment } from '../../lib/queries';
import { invalidate, setQueryData, useQuery } from '../../lib/query';
import { toast } from '../../lib/toast';
import { Button, IconButton } from '../../ui/Button';
import { Avatar, Badge, Callout, Skeleton } from '../../ui/Display';
import { Checkbox, Select } from '../../ui/Form';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { Modal } from '../../ui/Modal';
import { AssigneePicker, LabelsPicker, PriorityPicker, StatusPicker } from './pickers';

export function commentTitle(comment: Pick<Comment, 'title' | 'body'>): string {
  return comment.title?.trim() || comment.body.split('\n')[0]?.slice(0, 140) || '';
}

function Thread({ comment }: { comment: CommentDetail }) {
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (event: Event) => {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.comments.reply(comment.id, { body: body.trim(), internal });
      setBody('');
      await Promise.all([
        invalidate(['comment', comment.id]),
        invalidate(['comments', comment.project_id]),
      ]);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="c-thread">
      {comment.replies.length === 0 ? (
        <p class="u-muted u-text-sm">{t('inbox.noReplies')}</p>
      ) : null}
      {comment.replies.map((reply) => (
        <div key={reply.id} class={`c-message${reply.internal ? ' c-message--internal' : ''}`}>
          <Avatar name={reply.author.name} kind={reply.author.type} small />
          <div class="o-stack o-stack--xs">
            <div class="c-message__head">
              <span class="c-message__author">{reply.author.name ?? '—'}</span>
              {reply.internal ? <Badge tone="warning">{t('inbox.internalNote')}</Badge> : null}
              <span class="c-message__time" title={formatDateTime(reply.created_at)}>
                {timeAgo(reply.created_at)}
              </span>
            </div>
            <p class="c-message__body">{reply.body}</p>
          </div>
        </div>
      ))}
      <form class="c-composer" onSubmit={send}>
        <textarea
          value={body}
          placeholder={internal ? t('inbox.internalHint') : t('inbox.replyPlaceholder')}
          onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
              (e.currentTarget.form as HTMLFormElement).requestSubmit();
          }}
          aria-label={t('inbox.reply')}
        />
        <div class="o-cluster o-cluster--between">
          <Checkbox
            label={t('inbox.internalNote')}
            checked={internal}
            onChange={(e) => setInternal((e.target as HTMLInputElement).checked)}
          />
          <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!body.trim()}>
            {t('inbox.reply')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function MoveToPageDialog({
  comment,
  pages,
  open,
  onClose,
  onSave,
}: {
  comment: Comment;
  pages: PageWithStats[];
  open: boolean;
  onClose: () => void;
  onSave: (input: UpdateCommentInput) => void;
}) {
  const [pageId, setPageId] = useState(comment.page_id ?? pages[0]?.id ?? '');
  const [learn, setLearn] = useState(true);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('inbox.assignPage')}
      onSubmit={() => {
        onSave({ page_id: pageId || null, learn_path_alias: learn });
        onClose();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p class="u-secondary u-text-sm u-mono">{comment.page_url || comment.page_path}</p>
      <Select
        value={pageId}
        onChange={(e) => setPageId((e.target as HTMLSelectElement).value)}
        options={pages.map((p) => ({ value: p.id, label: `${p.title || p.path}  ${p.path}` }))}
      />
      <Checkbox
        label={t('inbox.learnAlias')}
        checked={learn}
        onChange={(e) => setLearn((e.target as HTMLInputElement).checked)}
      />
    </Modal>
  );
}

export function CommentInspector({
  commentId,
  pages,
  members,
  labels,
  onClose,
}: {
  commentId: string;
  pages: PageWithStats[];
  members: Member[];
  labels: Label[];
  onClose: () => void;
}) {
  const query = useComment(commentId);
  const comment = query.data;
  const integrations = useQuery(
    comment ? ['integrations', comment.project_id] : null,
    async () => (await api.integrations.list(comment?.project_id as string)).data,
  );
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [moving, setMoving] = useState(false);

  if (query.loading || !comment) {
    return (
      <aside class="c-inspector">
        <div class="c-inspector__section">
          <Skeleton lines={6} />
        </div>
      </aside>
    );
  }

  const update = async (input: UpdateCommentInput) => {
    setQueryData<CommentDetail>(['comment', comment.id], (current) =>
      current ? ({ ...current, ...input } as CommentDetail) : current,
    );
    try {
      await api.comments.update(comment.id, input);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
    await Promise.all([
      invalidate(['comment', comment.id]),
      invalidate(['comments', comment.project_id]),
      invalidate(['projects']),
    ]);
  };

  const remove = async () => {
    if (!confirm(`${t('inbox.deleteComment')}? ${t('common.confirmDelete')}`)) return;
    await api.comments.delete(comment.id);
    onClose();
    await invalidate(['comments', comment.project_id]);
  };

  const createIssue = async (provider: 'github' | 'linear') => {
    try {
      const link = await api.comments.createIssue(comment.id, provider);
      toast(t('inbox.issueCreated'), {
        action: { label: t('common.open'), run: () => window.open(link.url, '_blank', 'noopener') },
      });
      await invalidate(['comment', comment.id]);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  const translate = async () => {
    if (translated) {
      setTranslated(null);
      return;
    }
    setTranslating(true);
    try {
      setTranslated((await api.comments.translate(comment.id, locale.value)).body);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setTranslating(false);
    }
  };

  const page = pages.find((p) => p.id === comment.page_id);
  const trackers = (integrations.data ?? []).filter(
    (i: Integration) => i.enabled && i.has_secret && i.provider !== 'slack',
  );
  const linkedProviders = new Set(comment.external_links.map((l) => l.provider));
  const env = comment.environment;
  const canTranslate = comment.body_lang !== null && comment.body_lang !== locale.value;

  return (
    <aside class="c-inspector" aria-label={`#${comment.number}`}>
      <header class="c-inspector__header">
        <span class="u-muted u-nums">#{comment.number}</span>
        <StatusPicker value={comment.status} onChange={(status) => update({ status })} />
        <span class="u-grow" />
        <IconButton
          label={t('inbox.copyLink')}
          icon={<Link2 class="c-icon" />}
          onClick={() =>
            copyText(
              `${location.origin}/projects/${comment.project_id}/inbox?comment=${comment.id}`,
            )
          }
        />
        <Menu
          align="right"
          trigger={(props) => (
            <IconButton
              label={t('common.more')}
              icon={<MoreHorizontal class="c-icon" />}
              onClick={props.toggle}
              aria-expanded={props['aria-expanded']}
            />
          )}
        >
          {(close) => (
            <>
              {comment.page_url ? (
                <MenuItem href={comment.page_url} onSelect={close}>
                  <ExternalLink class="c-icon c-icon--sm" />
                  {t('inbox.openPage')}
                </MenuItem>
              ) : null}
              <MenuItem
                onSelect={() => {
                  setMoving(true);
                  close();
                }}
              >
                <FileText class="c-icon c-icon--sm" />
                {t('inbox.assignPage')}
              </MenuItem>
              {trackers.map((integration) => (
                <MenuItem
                  key={integration.provider}
                  onSelect={() => {
                    void createIssue(integration.provider as 'github' | 'linear');
                    close();
                  }}
                >
                  <GitCommit class="c-icon c-icon--sm" />
                  {t('inbox.createIssueIn', {
                    provider: integration.provider === 'github' ? 'GitHub' : 'Linear',
                  })}
                  {linkedProviders.has(integration.provider) ? ' ✓' : ''}
                </MenuItem>
              ))}
              <MenuItem
                onSelect={() => {
                  void copyText(comment.anchor.selector ?? comment.page_path);
                  close();
                }}
              >
                <Copy class="c-icon c-icon--sm" />
                {t('inbox.element')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                danger
                onSelect={() => {
                  void remove();
                  close();
                }}
              >
                <Trash2 class="c-icon c-icon--sm" />
                {t('inbox.deleteComment')}
              </MenuItem>
            </>
          )}
        </Menu>
        <IconButton label={t('common.close')} icon={<X class="c-icon" />} onClick={onClose} />
      </header>

      <section class="c-inspector__section">
        <h2 class="c-inspector__title">{commentTitle(comment)}</h2>
        <div class="o-cluster u-text-sm">
          <Avatar name={comment.author.name} kind={comment.author.type} small />
          <span>{comment.author.name ?? '—'}</span>
          <span class="u-muted">· {t(`source.${comment.source}`)} ·</span>
          <span class="u-muted" title={formatDateTime(comment.created_at)}>
            {timeAgo(comment.created_at)}
          </span>
          {comment.author.type === 'agent' ? <Bot class="c-icon c-icon--sm u-muted" /> : null}
        </div>
        {!comment.author.verified ? (
          <Callout tone="warning">
            <AlertTriangle class="c-icon" />
            <span>
              <strong>{t('inbox.unverified')}.</strong> {t('inbox.unverifiedHint')}
            </span>
          </Callout>
        ) : null}
        <div class="c-quote">{translated ?? comment.body}</div>
        {canTranslate ? (
          <div>
            <Button
              size="sm"
              variant="ghost"
              icon={<Languages class="c-icon c-icon--sm" />}
              loading={translating}
              onClick={translate}
            >
              {translated ? t('inbox.showOriginal') : t('inbox.translate')}
            </Button>
          </div>
        ) : null}
        {comment.suggestion ? (
          <div class="o-stack o-stack--xs">
            <span class="u-muted u-text-xs">{t('inbox.suggestion')}</span>
            <div class="c-diff">
              <span class="c-diff__del">{comment.suggestion.original}</span>
              <span class="c-diff__add">{comment.suggestion.text}</span>
            </div>
          </div>
        ) : null}
        {comment.screenshot ? (
          <a
            href={comment.screenshot.url}
            target="_blank"
            rel="noreferrer"
            aria-label={t('inbox.screenshot')}
          >
            <img
              class="c-screenshot"
              src={comment.screenshot.url}
              alt={t('inbox.screenshot')}
              loading="lazy"
            />
          </a>
        ) : null}
      </section>

      <section class="c-inspector__section">
        <div class="c-props">
          <span class="c-props__key">{t('common.priority')}</span>
          <span class="c-props__value">
            <PriorityPicker
              value={comment.priority}
              onChange={(priority) => update({ priority })}
            />
          </span>
          <span class="c-props__key">{t('common.assignee')}</span>
          <span class="c-props__value">
            <AssigneePicker
              value={comment.assignee}
              members={members}
              onChange={(assignee_user_id) => update({ assignee_user_id })}
            />
          </span>
          <span class="c-props__key">{t('common.labels')}</span>
          <span class="c-props__value">
            <LabelsPicker
              value={comment.labels}
              labels={labels}
              onChange={(label_ids) => update({ label_ids })}
            />
          </span>
          <span class="c-props__key">{t('common.kind')}</span>
          <span class="c-props__value u-text-sm">{t(`kind.${comment.kind}`)}</span>
          <span class="c-props__key">
            <FileText class="c-icon c-icon--sm" />
            {t('common.page')}
          </span>
          <span class="c-props__value u-text-sm">
            {page ? (
              <a href={`/projects/${comment.project_id}/pages?page=${page.id}`}>
                {page.title || page.path}
              </a>
            ) : (
              <button
                type="button"
                class="c-btn c-btn--ghost c-btn--sm"
                onClick={() => setMoving(true)}
              >
                <Badge tone="warning">{t('inbox.unassignedPages')}</Badge>
              </button>
            )}
          </span>
          <span class="c-props__key">
            <Globe class="c-icon c-icon--sm" />
            URL
          </span>
          <span class="c-props__value u-text-sm u-truncate" title={comment.page_url}>
            {comment.page_url ? (
              <a href={comment.page_url} target="_blank" rel="noreferrer">
                {comment.page_path}
              </a>
            ) : (
              comment.page_path
            )}
          </span>
          {comment.anchor.selector ? (
            <>
              <span class="c-props__key">
                <Code2 class="c-icon c-icon--sm" />
                {t('inbox.element')}
              </span>
              <span
                class="c-props__value u-mono u-text-xs u-truncate"
                title={comment.anchor.selector}
              >
                {comment.anchor.selector}
              </span>
            </>
          ) : null}
          {env.browser || env.viewport_w ? (
            <>
              <span class="c-props__key">
                <Monitor class="c-icon c-icon--sm" />
                {t('inbox.environment')}
              </span>
              <span class="c-props__value u-text-sm">
                {[
                  env.browser,
                  env.os,
                  env.viewport_w ? `${env.viewport_w}×${env.viewport_h}` : null,
                  env.build_id,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </>
          ) : null}
          {comment.fix ? (
            <>
              <span class="c-props__key">
                <GitCommit class="c-icon c-icon--sm" />
                {t('inbox.fix')}
              </span>
              <span class="c-props__value o-cluster u-text-sm">
                {comment.fix.commit_sha ? <code>{comment.fix.commit_sha.slice(0, 7)}</code> : null}
                {comment.fix.pr_url ? (
                  <a href={comment.fix.pr_url} target="_blank" rel="noreferrer">
                    {t('inbox.fixPr')}
                  </a>
                ) : null}
                {comment.fix.deploy_url ? (
                  <a href={comment.fix.deploy_url} target="_blank" rel="noreferrer">
                    {t('inbox.fixPreview')}
                  </a>
                ) : null}
              </span>
            </>
          ) : null}
          {comment.external_links.map((link) => (
            <Fragment key={link.id}>
              <span class="c-props__key">
                <ExternalLink class="c-icon c-icon--sm" />
                {link.provider}
              </span>
              <span class="c-props__value u-text-sm">
                <a href={link.url} target="_blank" rel="noreferrer">
                  {link.external_id}
                </a>
              </span>
            </Fragment>
          ))}
          {comment.attachments.some((a) => a.kind !== 'screenshot') ? (
            <>
              <span class="c-props__key">
                <Camera class="c-icon c-icon--sm" />
                {t('inbox.diagnostics')}
              </span>
              <span class="c-props__value o-cluster u-text-sm">
                {comment.attachments
                  .filter((a) => a.kind !== 'screenshot')
                  .map((a) => (
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                      {a.kind === 'console_log' ? t('inbox.console') : t('inbox.network')}
                    </a>
                  ))}
              </span>
            </>
          ) : null}
        </div>
      </section>

      <section class="c-inspector__section">
        <h3 class="u-text-sm">{t('inbox.reply')}</h3>
        <Thread comment={comment} />
      </section>

      {moving ? (
        <MoveToPageDialog
          comment={comment}
          pages={pages}
          open={moving}
          onClose={() => setMoving(false)}
          onSave={update}
        />
      ) : null}
    </aside>
  );
}
