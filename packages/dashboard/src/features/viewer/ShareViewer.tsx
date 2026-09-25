import type {
  PageApproval,
  PublicComment,
  PublicReply,
  ShareCommentDetail,
  ShareMeta,
  SharePage,
  SharePageDetail,
  ShareSession,
} from '@croquis/client';
import {
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  MessageSquarePlus,
  RotateCcw,
} from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { locale, setLocale, t, timeAgo } from '../../lib/i18n';
import { buildPageTree, flattenTree } from '../../lib/tree';
import { Button, buttonClass } from '../../ui/Button';
import { Avatar, Badge, Callout, EmptyState, Skeleton, StatusDot } from '../../ui/Display';
import { Field, Input } from '../../ui/Form';
import { Logo } from '../auth/AuthLayout';

// --- Public API (share session) ---------------------------------------------------

class ShareError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function sessionKey(slug: string) {
  return `croquis:share:${slug}`;
}

function loadStored(slug: string): ShareSession | null {
  try {
    const session = JSON.parse(
      localStorage.getItem(sessionKey(slug)) ?? 'null',
    ) as ShareSession | null;
    return session && session.expires_at > Date.now() ? session : null;
  } catch {
    return null;
  }
}

async function call<T>(
  slug: string,
  path: string,
  init: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const response = await fetch(`/api/v1/public/share/${slug}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.token ? { 'X-Croquis-Share-Token': init.token } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { code?: string } | null;
    throw new ShareError(response.status, problem?.code ?? 'http_error');
  }
  return (await response.json()) as T;
}

// --- Gate --------------------------------------------------------------------------------

function Gate({
  slug,
  meta,
  onSession,
}: {
  slug: string;
  meta: ShareMeta;
  onSession: (s: ShareSession) => void;
}) {
  const previous = (() => {
    try {
      return JSON.parse(localStorage.getItem(`croquis:reviewer:${meta.project.id}`) ?? 'null') as {
        token: string;
        name: string;
      } | null;
    } catch {
      return null;
    }
  })();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div class="o-center">
      <form
        class="c-auth"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget as HTMLFormElement);
          setBusy(true);
          setError(null);
          try {
            const session = await call<ShareSession>(slug, '/session', {
              method: 'POST',
              body: {
                name: String(data.get('name')),
                email: String(data.get('email') ?? '') || undefined,
                password: meta.password_required ? String(data.get('password')) : undefined,
                reviewer_token: previous?.token,
              },
            });
            localStorage.setItem(sessionKey(slug), JSON.stringify(session));
            localStorage.setItem(
              `croquis:reviewer:${meta.project.id}`,
              JSON.stringify({ token: session.reviewer_token, name: session.reviewer.name }),
            );
            onSession(session);
          } catch (err) {
            setError(
              err instanceof ShareError && err.code === 'invalid_password'
                ? t('viewer.wrongPassword')
                : t('common.unknownError'),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div class="c-auth__brand">
          <Logo />
          {meta.project.name}
        </div>
        <div class="c-auth__card">
          <div class="o-stack o-stack--xs">
            <h2>{t('viewer.welcome', { project: meta.project.name })}</h2>
            <p class="u-secondary u-text-sm">{t('viewer.intro')}</p>
          </div>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Field label={t('viewer.yourName')}>
            {(id) => (
              <Input
                id={id}
                name="name"
                required
                maxLength={120}
                value={previous?.name ?? ''}
                autoFocus
              />
            )}
          </Field>
          <Field label={t('viewer.email')}>
            {(id) => <Input id={id} name="email" type="email" autoComplete="email" />}
          </Field>
          {meta.password_required ? (
            <Field label={t('common.password')}>
              {(id) => (
                <Input
                  id={id}
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              )}
            </Field>
          ) : null}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            {t('viewer.start')}
          </Button>
        </div>
        <p class="u-muted u-text-xs">{t('viewer.poweredBy')}</p>
      </form>
    </div>
  );
}

// --- Comments ------------------------------------------------------------------------------

function CommentThread({
  slug,
  token,
  comment,
  canReply,
}: {
  slug: string;
  token: string;
  comment: PublicComment;
  canReply: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<ShareCommentDetail | null>(null);
  const [reply, setReply] = useState('');
  const load = async () =>
    setThread(await call<ShareCommentDetail>(slug, `/comments/${comment.id}`, { token }));
  return (
    <div class="c-card">
      <button
        type="button"
        class="o-cluster o-cluster--between"
        onClick={() => {
          setOpen(!open);
          if (!thread) void load();
        }}
        aria-expanded={open}
      >
        <span class="o-cluster">
          <StatusDot status={comment.status} label={t(`status.${comment.status}`)} />
          <strong class="u-nums">#{comment.number}</strong>
          <span class="u-secondary u-text-sm">{comment.author_name ?? '—'}</span>
          <span class="u-muted u-text-xs">{timeAgo(comment.created_at)}</span>
        </span>
        <span class="o-cluster u-muted u-text-xs">
          {comment.status === 'resolved' ? (
            <Badge tone="success">{t('status.resolved')}</Badge>
          ) : null}
          <MessageSquare class="c-icon c-icon--sm" />
          {comment.reply_count}
        </span>
      </button>
      <p class="u-pre-wrap">{comment.body}</p>
      {comment.suggestion ? (
        <div class="c-diff">
          <span class="c-diff__del">{comment.suggestion.original}</span>
          <span class="c-diff__add">{comment.suggestion.text}</span>
        </div>
      ) : null}
      {open && thread ? (
        <div class="c-thread">
          {thread.screenshot_url ? (
            <img class="c-screenshot" src={thread.screenshot_url} alt="" loading="lazy" />
          ) : null}
          {thread.replies.map((r: PublicReply) => (
            <div key={r.id} class="c-message">
              <Avatar name={r.author_name} small />
              <div class="o-stack o-stack--xs">
                <div class="c-message__head">
                  <span class="c-message__author">{r.author_name ?? '—'}</span>
                  <span class="c-message__time">{timeAgo(r.created_at)}</span>
                </div>
                <p class="c-message__body">{r.body}</p>
              </div>
            </div>
          ))}
          {canReply ? (
            <form
              class="c-composer"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!reply.trim()) return;
                await call(slug, `/comments/${comment.id}/replies`, {
                  method: 'POST',
                  token,
                  body: { body: reply.trim() },
                });
                setReply('');
                await load();
              }}
            >
              <textarea
                value={reply}
                onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)}
                placeholder={t('inbox.replyPlaceholder')}
                aria-label={t('inbox.reply')}
              />
              <div class="o-cluster o-cluster--between">
                <span />
                <Button type="submit" size="sm" variant="primary" disabled={!reply.trim()}>
                  {t('inbox.reply')}
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// --- Page view ------------------------------------------------------------------------------

function PageView({
  slug,
  token,
  meta,
  pageId,
  onChanged,
}: {
  slug: string;
  token: string;
  meta: ShareMeta;
  pageId: string;
  onChanged: () => void;
}) {
  const [page, setPage] = useState<SharePageDetail | null>(null);
  const [comments, setComments] = useState<PublicComment[] | null>(null);
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState<PageApproval['decision'] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [detail, list] = await Promise.all([
      call<SharePageDetail>(slug, `/pages/${pageId}`, { token }),
      call<{ data: PublicComment[] }>(slug, `/comments?page=${pageId}&include_closed=true`, {
        token,
      }),
    ]);
    setPage(detail);
    setComments(list.data);
  };
  useEffect(() => {
    setPage(null);
    setDecision(null);
    void load();
  }, [pageId]);

  if (!page) return <Skeleton lines={6} />;

  const approve = async (value: PageApproval['decision']) => {
    setBusy(true);
    try {
      await call(slug, `/pages/${pageId}/approvals`, {
        method: 'POST',
        token,
        body: { decision: value, note },
      });
      setDecision(value);
      setNote('');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="o-stack o-stack--lg">
      <header class="o-stack o-stack--xs">
        <span class="u-mono u-muted u-text-sm">{page.path}</span>
        <h1>{page.title || page.path}</h1>
        {page.purpose ? <p class="u-secondary">{page.purpose}</p> : null}
      </header>

      {page.content_blocks.length ? (
        <article class="c-card o-stack">
          {page.content_blocks.map((block) =>
            block.type === 'heading' ? (
              <h2 key={block.id}>{block.content}</h2>
            ) : block.type === 'cta' ? (
              <div key={block.id}>
                <span class={buttonClass('primary')}>{block.content}</span>
              </div>
            ) : block.type === 'image' ? (
              <Callout key={block.id}>🖼 {block.content}</Callout>
            ) : (
              <p key={block.id} class="u-pre-wrap">
                {block.content}
              </p>
            ),
          )}
        </article>
      ) : null}

      {meta.allow_approvals ? (
        <div class="c-approval">
          {decision || page.approval ? (
            <span class="o-cluster">
              <CheckCircle2 class="c-icon" />
              {(decision ?? page.approval) === 'approved'
                ? t('viewer.approved')
                : t('viewer.changesRequested')}
            </span>
          ) : null}
          <Input
            small
            class="u-grow"
            placeholder={t('viewer.note')}
            value={note}
            onInput={(e) => setNote((e.target as HTMLInputElement).value)}
            aria-label={t('viewer.note')}
          />
          <Button
            size="sm"
            icon={<RotateCcw class="c-icon c-icon--sm" />}
            loading={busy}
            onClick={() => approve('changes_requested')}
          >
            {t('viewer.requestChanges')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<CheckCircle2 class="c-icon c-icon--sm" />}
            loading={busy}
            onClick={() => approve('approved')}
          >
            {t('viewer.approve')}
          </Button>
        </div>
      ) : null}

      <section class="o-stack">
        <div class="o-cluster o-cluster--between">
          <h3>{t('nav.inbox')}</h3>
          {meta.site_url ? (
            <a
              class={buttonClass('secondary', 'sm')}
              href={meta.site_url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink class="c-icon c-icon--sm" />
              {t('viewer.openSite')}
            </a>
          ) : null}
        </div>
        {meta.allow_comments ? (
          <form
            class="c-composer"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!body.trim()) return;
              await call(slug, '/comments', {
                method: 'POST',
                token,
                body: { page_id: pageId, body: body.trim() },
              });
              setBody('');
              await load();
              onChanged();
            }}
          >
            <textarea
              value={body}
              onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
              placeholder={t('viewer.commentPlaceholder')}
              aria-label={t('viewer.comment')}
            />
            <div class="o-cluster o-cluster--between">
              <span />
              <Button
                type="submit"
                size="sm"
                variant="primary"
                icon={<MessageSquarePlus class="c-icon c-icon--sm" />}
                disabled={!body.trim()}
              >
                {t('viewer.comment')}
              </Button>
            </div>
          </form>
        ) : null}
        {comments?.length === 0 ? <p class="u-muted u-text-sm">{t('viewer.noComments')}</p> : null}
        {(comments ?? []).map((comment) => (
          <CommentThread
            key={comment.id}
            slug={slug}
            token={token}
            comment={comment}
            canReply={meta.allow_comments}
          />
        ))}
      </section>
    </div>
  );
}

// --- Viewer -------------------------------------------------------------------------------------

export function ShareViewer({ slug, pageId }: { slug: string; pageId?: string }) {
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [error, setError] = useState<'invalid' | 'expired' | null>(null);
  const [session, setSession] = useState<ShareSession | null>(() => loadStored(slug));
  const [pages, setPages] = useState<SharePage[] | null>(null);

  useEffect(() => {
    call<ShareMeta>(slug, '')
      .then(setMeta)
      .catch((err: unknown) =>
        setError(err instanceof ShareError && err.status === 410 ? 'expired' : 'invalid'),
      );
  }, [slug]);

  const loadPages = () => {
    if (!session) return;
    call<{ data: SharePage[] }>(slug, '/pages', { token: session.token })
      .then((r) => setPages(r.data))
      .catch((err: unknown) => {
        if (err instanceof ShareError && err.status === 401) {
          localStorage.removeItem(sessionKey(slug));
          setSession(null);
        }
      });
  };
  useEffect(loadPages, [session]);

  if (error) {
    return (
      <div class="o-center">
        <EmptyState title={t(error === 'expired' ? 'viewer.expired' : 'viewer.invalid')} />
      </div>
    );
  }
  if (!meta)
    return (
      <div class="o-center">
        <Skeleton />
      </div>
    );
  if (!session) return <Gate slug={slug} meta={meta} onSession={setSession} />;

  const tree = flattenTree(buildPageTree(pages ?? []));
  const current = pageId ?? tree[0]?.page.id;

  return (
    <div class="c-viewer">
      <nav class="c-viewer__nav o-stack" aria-label={t('viewer.pages')}>
        <div class="c-auth__brand">
          <Logo />
          <span class="u-truncate">{meta.project.name}</span>
        </div>
        <p class="u-muted u-text-xs">{t('viewer.reviewingAs', { name: session.reviewer.name })}</p>
        <div class="c-sidebar__section">
          <div class="c-sidebar__heading">{t('viewer.pages')}</div>
          {tree.map((node) => {
            const page = node.page;
            return (
              <a
                key={page.id}
                href={`/s/${slug}/${page.id}`}
                class={`c-sidebar__link${page.id === current ? ' is-active' : ''}`}
                style={{
                  paddingLeft: `calc(var(--cq-space-2) + var(--cq-space-4) * ${node.depth})`,
                }}
              >
                <StatusDot
                  status={
                    page.approval === 'approved'
                      ? 'resolved'
                      : page.approval === 'changes_requested'
                        ? 'in_progress'
                        : 'todo'
                  }
                />
                <span class="u-truncate">{page.title || page.path}</span>
                {page.comments_active ? (
                  <span class="c-sidebar__count">{page.comments_active}</span>
                ) : null}
              </a>
            );
          })}
        </div>
        <div class="c-sidebar__footer">
          <button
            type="button"
            class="c-sidebar__link"
            onClick={() => setLocale(locale.value === 'ja' ? 'en' : 'ja')}
          >
            {locale.value === 'ja' ? 'English' : '日本語'}
          </button>
        </div>
      </nav>
      <main class="c-viewer__main">
        <div class="o-container o-container--prose">
          {current ? (
            <PageView
              slug={slug}
              token={session.token}
              meta={meta}
              pageId={current}
              onChanged={loadPages}
            />
          ) : pages === null ? (
            <Skeleton />
          ) : (
            <EmptyState title={t('pages.empty')} />
          )}
        </div>
      </main>
    </div>
  );
}
