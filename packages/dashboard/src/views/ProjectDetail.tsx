import {
  COMMENT_STATUSES,
  CONTENT_BLOCK_TYPES,
  type Comment,
  type CommentStatus,
  type ContentBlock,
  formatExportMarkdown,
  PAGE_STATUS_LABELS,
  PAGE_STATUSES,
  type Page,
  type PageStatus,
} from '@croquis/shared';
import { useEffect, useState } from 'preact/hooks';
import { useApp, useAsync } from '../app';
import { buildPageTree, flattenTree } from '../lib/tree';

type Tab = 'sitemap' | 'content' | 'review' | 'export';

export function ProjectDetail({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { client, notify } = useApp();
  const project = useAsync(() => client.getProject(projectId), [projectId]);
  const [tab, setTab] = useState<Tab>('sitemap');

  const deleteProject = async () => {
    const name = project.data?.name ?? '';
    const typed = window.prompt(
      `This permanently deletes the project, all pages, comments and screenshots.\nType the project name (${name}) to confirm:`,
    );
    if (typed === null) return;
    if (typed.trim() !== name) {
      notify('Name did not match — nothing deleted', 'error');
      return;
    }
    try {
      await client.deleteProject(projectId);
      notify('Project deleted');
      onBack();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to delete project', 'error');
    }
  };

  return (
    <>
      <div class="c-topbar">
        <div class="o-cluster">
          <button type="button" class="c-btn c-btn--ghost c-btn--sm" onClick={onBack}>
            ← Projects
          </button>
          <span class="c-topbar__title">{project.data?.name ?? '…'}</span>
        </div>
        <div class="o-cluster">
          {project.data && (
            <span class="u-xs u-muted u-mono">ingest: {project.data.ingest_key}</span>
          )}
          <button type="button" class="c-btn c-btn--danger c-btn--sm" onClick={deleteProject}>
            Delete project
          </button>
        </div>
      </div>
      <div class="o-container o-stack">
        {project.error && <div class="c-empty">Error: {project.error}</div>}
        <div class="c-tabs">
          {(['sitemap', 'content', 'review', 'export'] as Tab[]).map((t) => (
            <button
              type="button"
              key={t}
              class={`c-tabs__tab ${tab === t ? 'c-tabs__tab--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {tab === 'sitemap' && <SitemapTab projectId={projectId} />}
        {tab === 'content' && <ContentTab projectId={projectId} />}
        {tab === 'review' && <ReviewTab projectId={projectId} />}
        {tab === 'export' && <ExportTab projectId={projectId} />}
      </div>
    </>
  );
}

function SitemapTab({ projectId }: { projectId: string }) {
  const { client, notify } = useApp();
  const { data, loading, error, reload } = useAsync(() => client.listPages(projectId), [projectId]);
  const [path, setPath] = useState('');
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState('');

  const pages = data?.pages ?? [];
  const rows = flattenTree(buildPageTree(pages));

  const addPage = async () => {
    if (!path.trim()) return;
    try {
      await client.createPage(projectId, {
        path: path.trim(),
        title: title.trim(),
        parent_id: parentId || null,
      });
      setPath('');
      setTitle('');
      setParentId('');
      reload();
      notify('Page added');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };

  const setStatus = async (page: Page, status: PageStatus) => {
    try {
      await client.updatePage(projectId, page.id, { status });
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to update status', 'error');
    }
  };

  const remove = async (page: Page) => {
    if (!window.confirm(`Delete ${page.path}? Children are promoted; comments are kept.`)) return;
    try {
      await client.deletePage(projectId, page.id);
      reload();
      notify('Page deleted');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to delete page', 'error');
    }
  };

  return (
    <div class="o-stack">
      <div class="c-card o-stack o-stack--tight">
        <span class="u-strong">Add page</span>
        <div class="o-cluster">
          <input
            class="c-input u-grow"
            placeholder="/path"
            value={path}
            onInput={(e) => setPath((e.target as HTMLInputElement).value)}
          />
          <input
            class="c-input u-grow"
            placeholder="Title"
            value={title}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
          <select
            class="c-select"
            value={parentId}
            onChange={(e) => setParentId((e.target as HTMLSelectElement).value)}
          >
            <option value="">(root)</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.path}
              </option>
            ))}
          </select>
          <button type="button" class="c-btn c-btn--primary" onClick={addPage}>
            Add
          </button>
        </div>
      </div>

      {loading && <div class="c-empty">Loading…</div>}
      {error && <div class="c-empty">Error: {error}</div>}
      {!loading && rows.length === 0 && <div class="c-empty">No pages yet.</div>}
      {rows.length > 0 && (
        <div class="c-list">
          {rows.map(({ page, depth }) => (
            <div key={page.id} class="c-list__row">
              <span class="c-list__grow">
                {Array.from({ length: depth }).map((_, i) => (
                  <span key={i} class="c-tree__depth" />
                ))}
                <span class="c-list__path">{page.path}</span>
                {page.title && <span class="c-list__sub"> · {page.title}</span>}
              </span>
              <select
                class="c-select"
                style={{ width: 'auto' }}
                value={page.status}
                onChange={(e) =>
                  setStatus(page, (e.target as HTMLSelectElement).value as PageStatus)
                }
              >
                {PAGE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PAGE_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                class="c-btn c-btn--danger c-btn--sm"
                onClick={() => remove(page)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContentTab({ projectId }: { projectId: string }) {
  const { client, notify } = useApp();
  const pagesQuery = useAsync(() => client.listPages(projectId), [projectId]);
  const [pageId, setPageId] = useState<string>('');
  const pages = pagesQuery.data?.pages ?? [];

  useEffect(() => {
    if (!pageId && pages.length > 0) setPageId(pages[0]!.id);
  }, [pages, pageId]);

  return (
    <div class="o-stack">
      <label class="c-field">
        <span class="c-field__label">Page</span>
        <select
          class="c-select"
          value={pageId}
          onChange={(e) => setPageId((e.target as HTMLSelectElement).value)}
        >
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.path} {p.title ? `· ${p.title}` : ''}
            </option>
          ))}
        </select>
      </label>
      {pagesQuery.error && <div class="c-empty">Error: {pagesQuery.error}</div>}
      {pagesQuery.loading ? (
        <div class="c-empty">Loading…</div>
      ) : pageId ? (
        <ContentBlocks projectId={projectId} pageId={pageId} notify={notify} />
      ) : (
        <div class="c-empty">Add a page first.</div>
      )}
    </div>
  );
}

function ContentBlocks({
  projectId,
  pageId,
  notify,
}: {
  projectId: string;
  pageId: string;
  notify: (m: string, k?: 'ok' | 'error') => void;
}) {
  const { client } = useApp();
  const { data, loading, reload } = useAsync(
    () => client.listContentBlocks(projectId, pageId),
    [projectId, pageId],
  );
  const [type, setType] = useState<(typeof CONTENT_BLOCK_TYPES)[number]>('heading');
  const [content, setContent] = useState('');

  const add = async () => {
    try {
      await client.createContentBlock(projectId, pageId, { type, content });
      setContent('');
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };

  return (
    <div class="o-stack">
      <div class="c-card o-stack o-stack--tight">
        <span class="u-strong">Add content block</span>
        <div class="o-cluster">
          <select
            class="c-select"
            style={{ width: 'auto' }}
            value={type}
            onChange={(e) =>
              setType((e.target as HTMLSelectElement).value as (typeof CONTENT_BLOCK_TYPES)[number])
            }
          >
            {CONTENT_BLOCK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <textarea
          class="c-textarea"
          placeholder="Content…"
          value={content}
          onInput={(e) => setContent((e.target as HTMLTextAreaElement).value)}
        />
        <button type="button" class="c-btn c-btn--primary u-right" onClick={add}>
          Add block
        </button>
      </div>
      {loading && <div class="c-empty">Loading…</div>}
      {data && data.content_blocks.length === 0 && <div class="c-empty">No content yet.</div>}
      {data?.content_blocks.map((block) => (
        <ContentBlockRow
          key={block.id}
          projectId={projectId}
          pageId={pageId}
          block={block}
          onChange={reload}
        />
      ))}
    </div>
  );
}

function ContentBlockRow({
  projectId,
  pageId,
  block,
  onChange,
}: {
  projectId: string;
  pageId: string;
  block: ContentBlock;
  onChange: () => void;
}) {
  const { client, notify } = useApp();
  const [value, setValue] = useState(block.content);

  return (
    <div class="c-card o-stack o-stack--tight">
      <div class="o-cluster o-cluster--between">
        <span class="c-badge">{block.type}</span>
        {block.ai_generated && <span class="c-badge c-badge--review">AI draft</span>}
      </div>
      <textarea
        class="c-textarea"
        value={value}
        onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
      />
      <div class="o-cluster o-cluster--between">
        <button
          type="button"
          class="c-btn c-btn--danger c-btn--sm"
          onClick={async () => {
            if (!window.confirm('Delete this content block?')) return;
            try {
              await client.deleteContentBlock(projectId, pageId, block.id);
              onChange();
            } catch (e) {
              notify(e instanceof Error ? e.message : 'Failed to delete block', 'error');
            }
          }}
        >
          Delete
        </button>
        <button
          type="button"
          class="c-btn c-btn--primary c-btn--sm"
          onClick={async () => {
            try {
              await client.updateContentBlock(projectId, pageId, block.id, { content: value });
              onChange();
              notify('Saved');
            } catch (e) {
              notify(e instanceof Error ? e.message : 'Failed to save block', 'error');
            }
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function ReviewTab({ projectId }: { projectId: string }) {
  const { client, notify } = useApp();
  const [filter, setFilter] = useState<'all' | CommentStatus>('open');
  const { data, loading, error, reload } = useAsync(
    () => client.listComments(projectId, filter === 'all' ? {} : { status: filter }),
    [projectId, filter],
  );

  return (
    <div class="o-stack">
      <div class="o-cluster">
        <span class="c-field__label">Filter</span>
        <select
          class="c-select"
          style={{ width: 'auto' }}
          value={filter}
          onChange={(e) =>
            setFilter((e.target as HTMLSelectElement).value as 'all' | CommentStatus)
          }
        >
          <option value="all">All</option>
          {COMMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {loading && <div class="c-empty">Loading…</div>}
      {error && <div class="c-empty">Error: {error}</div>}
      {data && data.comments.length === 0 && <div class="c-empty">No comments.</div>}
      <div class="o-stack o-stack--tight">
        {data?.comments.map((comment) => (
          <CommentCard
            key={comment.id}
            projectId={projectId}
            comment={comment}
            onChange={reload}
            notify={notify}
          />
        ))}
      </div>
    </div>
  );
}

function CommentCard({
  projectId,
  comment,
  onChange,
  notify,
}: {
  projectId: string;
  comment: Comment;
  onChange: () => void;
  notify: (m: string, k?: 'ok' | 'error') => void;
}) {
  const { client } = useApp();
  const [open, setOpen] = useState(false);
  const detail = useAsync(
    () => (open ? client.getComment(projectId, comment.id) : Promise.resolve(null)),
    [open, comment.id],
  );
  const [reply, setReply] = useState('');

  return (
    <div class="c-card o-stack o-stack--tight">
      <div class="o-cluster o-cluster--between">
        <span class={`c-badge c-badge--${comment.status}`}>{comment.status}</span>
        {comment.element_selector && (
          <span class="c-comment__target u-truncate">{comment.element_selector}</span>
        )}
      </div>
      <p class="c-comment__body">{comment.body}</p>
      <div class="o-cluster o-cluster--between">
        <span class="c-comment__meta u-truncate">{comment.page_url}</span>
        <div class="o-cluster">
          <button
            type="button"
            class="c-btn c-btn--ghost c-btn--sm"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide' : 'Details'}
          </button>
          <button
            type="button"
            class="c-btn c-btn--sm"
            onClick={async () => {
              const next = comment.status === 'open' ? 'resolved' : 'open';
              try {
                await client.updateComment(projectId, comment.id, { status: next });
                onChange();
                notify(next === 'resolved' ? 'Resolved' : 'Reopened');
              } catch (e) {
                notify(e instanceof Error ? e.message : 'Failed to update', 'error');
              }
            }}
          >
            {comment.status === 'open' ? 'Resolve' : 'Reopen'}
          </button>
        </div>
      </div>
      {open && detail.loading && <div class="c-empty">Loading…</div>}
      {open && detail.error && <div class="c-empty">Error: {detail.error}</div>}
      {open && detail.data && (
        <div class="o-stack o-stack--tight">
          {comment.screenshot_key && <Screenshot projectId={projectId} commentId={comment.id} />}
          {comment.computed_style && <pre class="c-code">{prettyJson(comment.computed_style)}</pre>}
          {detail.data.replies.map((r) => (
            <div key={r.id} class="c-comment__reply">
              <span class="c-comment__meta">{r.author_name ?? 'Someone'}</span>
              <p class="c-comment__body">{r.body}</p>
            </div>
          ))}
          <div class="o-cluster">
            <input
              class="c-input u-grow"
              placeholder="Reply…"
              value={reply}
              onInput={(e) => setReply((e.target as HTMLInputElement).value)}
            />
            <button
              type="button"
              class="c-btn c-btn--primary"
              disabled={!reply.trim()}
              onClick={async () => {
                try {
                  await client.replyComment(projectId, comment.id, { body: reply.trim() });
                  setReply('');
                  detail.reload();
                } catch (e) {
                  notify(e instanceof Error ? e.message : 'Failed to reply', 'error');
                }
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Screenshot({ projectId, commentId }: { projectId: string; commentId: string }) {
  const { client } = useApp();
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  });
  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    client
      .fetchScreenshotObjectUrl(projectId, commentId)
      .then((u) => {
        objectUrl = u;
        if (active) setState({ url: u, failed: false });
        else URL.revokeObjectURL(u);
      })
      .catch(() => {
        if (active) setState({ url: null, failed: true });
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, commentId]);
  if (state.failed) return <p class="c-comment__meta">Screenshot unavailable.</p>;
  if (!state.url) return null;
  return <img src={state.url} alt="Screenshot" style={{ borderRadius: 'var(--cq-radius-md)' }} />;
}

function ExportTab({ projectId }: { projectId: string }) {
  const { client, notify } = useApp();
  const { data, loading, error } = useAsync(() => client.exportProject(projectId), [projectId]);
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown');

  if (loading) return <div class="c-empty">Loading…</div>;
  if (error) return <div class="c-empty">Error: {error}</div>;
  if (!data) return null;

  const text = format === 'markdown' ? formatExportMarkdown(data) : JSON.stringify(data, null, 2);

  return (
    <div class="o-stack">
      <div class="o-cluster o-cluster--between">
        <div class="c-tabs">
          <button
            type="button"
            class={`c-tabs__tab ${format === 'markdown' ? 'c-tabs__tab--active' : ''}`}
            onClick={() => setFormat('markdown')}
          >
            Markdown
          </button>
          <button
            type="button"
            class={`c-tabs__tab ${format === 'json' ? 'c-tabs__tab--active' : ''}`}
            onClick={() => setFormat('json')}
          >
            JSON
          </button>
        </div>
        <button
          type="button"
          class="c-btn c-btn--sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              notify('Copied to clipboard');
            } catch {
              notify('Clipboard write failed', 'error');
            }
          }}
        >
          Copy
        </button>
      </div>
      <pre class="c-code">{text}</pre>
    </div>
  );
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
