import type { ContentBlock, PageWithStats, ProjectWithStats } from '@croquis/client';
import { CONTENT_BLOCK_TYPES, PAGE_STATUSES } from '@croquis/shared/constants';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  MessageSquare,
  Plus,
  Sparkles,
  SpellCheck,
  Trash2,
} from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime, t } from '../../lib/i18n';
import { usePages } from '../../lib/queries';
import { invalidate, useQuery } from '../../lib/query';
import { instance } from '../../lib/session';
import { toast } from '../../lib/toast';
import { buildPageTree, flattenTree, type PageNode } from '../../lib/tree';
import { Button, IconButton } from '../../ui/Button';
import { Badge, EmptyState, Skeleton, StatusDot } from '../../ui/Display';
import { Field, Input, Select, Textarea } from '../../ui/Form';
import { Menu, MenuItem } from '../../ui/Menu';
import { Modal } from '../../ui/Modal';

// --- Tree ----------------------------------------------------------------------

function Tree({
  pages,
  selectedId,
  onSelect,
  onMove,
}: {
  pages: PageWithStats[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (pageId: string, parentId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const nodes = flattenTree(buildPageTree(pages));
  const hidden = new Set<string>();
  for (const node of nodes) {
    if (
      node.page.parent_id &&
      (collapsed.has(node.page.parent_id) || hidden.has(node.page.parent_id))
    )
      hidden.add(node.page.id);
  }

  return (
    <div class="c-tree" role="tree">
      {nodes
        .filter((node) => !hidden.has(node.page.id))
        .map((node: PageNode<PageWithStats>) => {
          const page = node.page;
          const hasChildren = node.children.length > 0;
          return (
            <div
              key={page.id}
              role="treeitem"
              aria-selected={page.id === selectedId}
              aria-expanded={hasChildren ? !collapsed.has(page.id) : undefined}
              class={`c-tree__row${page.id === selectedId ? ' is-selected' : ''}${dropTarget === page.id ? ' is-drop-target' : ''}`}
              style={{ '--depth': node.depth }}
              draggable
              tabIndex={0}
              onClick={() => onSelect(page.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(page.id)}
              onDragStart={(e) => e.dataTransfer?.setData('text/plain', page.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setDropTarget(page.id);
              }}
              onDragLeave={() => setDropTarget((current) => (current === page.id ? null : current))}
              onDrop={(e) => {
                e.preventDefault();
                setDropTarget(null);
                const dragged = e.dataTransfer?.getData('text/plain');
                if (dragged && dragged !== page.id) onMove(dragged, page.id);
              }}
            >
              <button
                type="button"
                class="c-tree__toggle"
                aria-label={
                  hasChildren
                    ? t(collapsed.has(page.id) ? 'common.expand' : 'common.collapse')
                    : undefined
                }
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = new Set(collapsed);
                  if (next.has(page.id)) next.delete(page.id);
                  else next.add(page.id);
                  setCollapsed(next);
                }}
              >
                {hasChildren ? (
                  collapsed.has(page.id) ? (
                    <ChevronRight class="c-icon c-icon--sm" />
                  ) : (
                    <ChevronDown class="c-icon c-icon--sm" />
                  )
                ) : null}
              </button>
              <StatusDot status={page.status} label={t(`pageStatus.${page.status}`)} />
              <span class="o-stack o-stack--xs u-grow">
                <span class="c-tree__title u-truncate">{page.title || page.path}</span>
                {page.title ? <span class="c-tree__path u-truncate">{page.path}</span> : null}
              </span>
              <span class="c-tree__meta">
                {page.approval === 'approved' ? (
                  <Badge tone="success">{t('approval.approved')}</Badge>
                ) : null}
                {page.approval === 'changes_requested' ? (
                  <Badge tone="warning">{t('approval.changes_requested')}</Badge>
                ) : null}
                {page.comments_active ? (
                  <span class="o-cluster o-cluster--nowrap">
                    <MessageSquare class="c-icon c-icon--sm" />
                    {page.comments_active}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
    </div>
  );
}

// --- Content blocks ----------------------------------------------------------------

function Block({
  block,
  first,
  last,
  onChange,
  onDelete,
  onMove,
}: {
  block: ContentBlock;
  first: boolean;
  last: boolean;
  onChange: (content: string) => void;
  onDelete: () => void;
  onMove: (delta: number) => void;
}) {
  const [value, setValue] = useState(block.content);
  useEffect(() => setValue(block.content), [block.content]);
  return (
    <div class="c-block">
      <span class="c-block__type">
        {t(`pages.block.${block.type}`)}
        {block.ai_generated ? (
          <span class="c-ai-badge">
            <Sparkles class="c-icon c-icon--sm" />
            AI
          </span>
        ) : null}
      </span>
      <textarea
        class={`c-block__content${block.type === 'heading' ? ' c-block__content--heading' : ''}`}
        value={value}
        rows={1}
        aria-label={t(`pages.block.${block.type}`)}
        onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
        onBlur={() => value !== block.content && onChange(value)}
      />
      <span class="c-block__actions">
        <IconButton
          size="sm"
          label={t('common.moveUp')}
          icon={<ArrowUp class="c-icon c-icon--sm" />}
          disabled={first}
          onClick={() => onMove(-1)}
        />
        <IconButton
          size="sm"
          label={t('common.moveDown')}
          icon={<ArrowDown class="c-icon c-icon--sm" />}
          disabled={last}
          onClick={() => onMove(1)}
        />
        <IconButton
          size="sm"
          label={t('common.delete')}
          icon={<Trash2 class="c-icon c-icon--sm" />}
          onClick={onDelete}
        />
      </span>
    </div>
  );
}

function ContentEditor({ page }: { page: PageWithStats }) {
  const blocks = useQuery(['content', page.id], async () => (await api.content.list(page.id)).data);
  const [drafting, setDrafting] = useState(false);
  const refresh = () => invalidate(['content', page.id]);
  const list = blocks.data ?? [];

  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
    await refresh();
  };

  const swap = (index: number, delta: number) =>
    run(async () => {
      const a = list[index];
      const b = list[index + delta];
      if (!a || !b) return;
      await Promise.all([
        api.content.update(a.id, { position: b.position }),
        api.content.update(b.id, { position: a.position }),
      ]);
    });

  const draft = async () => {
    setDrafting(true);
    await run(() => api.ai.draftContent(page.id));
    setDrafting(false);
  };

  return (
    <div class="o-stack">
      <div class="o-cluster o-cluster--between">
        <h3>{t('pages.content')}</h3>
        <span class="o-cluster">
          {instance.value?.ai_enabled ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Sparkles class="c-icon c-icon--sm" />}
              loading={drafting}
              onClick={draft}
            >
              {t('pages.aiDraft')}
            </Button>
          ) : null}
          <Menu
            align="right"
            trigger={(props) => (
              <Button
                size="sm"
                icon={<Plus class="c-icon c-icon--sm" />}
                onClick={props.toggle}
                aria-expanded={props['aria-expanded']}
              >
                {t('pages.addBlock')}
              </Button>
            )}
          >
            {(close) =>
              CONTENT_BLOCK_TYPES.map((type) => (
                <MenuItem
                  key={type}
                  onSelect={() => {
                    close();
                    void run(() => api.content.create(page.id, { type, content: '' }));
                  }}
                >
                  {t(`pages.block.${type}`)}
                </MenuItem>
              ))
            }
          </Menu>
        </span>
      </div>
      {blocks.loading ? <Skeleton /> : null}
      {!blocks.loading && list.length === 0 ? (
        <p class="u-muted u-text-sm">{t('pages.contentEmpty')}</p>
      ) : null}
      <div class="c-blocks">
        {list.map((block, index) => (
          <Block
            key={block.id}
            block={block}
            first={index === 0}
            last={index === list.length - 1}
            onChange={(content) => run(() => api.content.update(block.id, { content }))}
            onDelete={() => run(() => api.content.delete(block.id))}
            onMove={(delta) => swap(index, delta)}
          />
        ))}
      </div>
    </div>
  );
}

// --- Page detail ---------------------------------------------------------------------

function PageDetail({
  page,
  pages,
  projectId,
  onDeleted,
}: {
  page: PageWithStats;
  pages: PageWithStats[];
  projectId: string;
  onDeleted: () => void;
}) {
  const approvals = useQuery(
    ['approvals', page.id],
    async () => (await api.pages.approvals(page.id)).data,
  );
  const save = async (input: Parameters<typeof api.pages.update>[1]) => {
    try {
      await api.pages.update(page.id, input);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
    await invalidate(['pages', projectId]);
  };
  const remove = async () => {
    if (!confirm(t('pages.deleteConfirm'))) return;
    await api.pages.delete(page.id);
    onDeleted();
    await invalidate(['pages', projectId]);
  };
  // A page cannot move under itself or its descendants.
  const descendants = new Set<string>([page.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of pages) {
      if (p.parent_id && descendants.has(p.parent_id) && !descendants.has(p.id)) {
        descendants.add(p.id);
        grew = true;
      }
    }
  }

  return (
    <aside class="c-inspector" aria-label={page.title || page.path}>
      <header class="c-inspector__header">
        <StatusDot status={page.status} />
        <span class="u-mono u-text-sm u-truncate u-grow">{page.path}</span>
        {page.comments_active ? (
          <a
            class="c-btn c-btn--ghost c-btn--sm"
            href={`/projects/${projectId}/inbox?page=${page.id}`}
          >
            <MessageSquare class="c-icon c-icon--sm" />
            {t('pages.comments', { count: page.comments_active })}
          </a>
        ) : null}
        <IconButton label={t('common.delete')} icon={<Trash2 class="c-icon" />} onClick={remove} />
      </header>
      <section class="c-inspector__section">
        <Input
          bare
          class="c-inspector__title"
          value={page.title}
          placeholder={t('pages.titleField')}
          aria-label={t('pages.titleField')}
          onBlur={(e) => {
            const value = (e.target as HTMLInputElement).value;
            if (value !== page.title) void save({ title: value });
          }}
        />
        <div class="c-props">
          <span class="c-props__key">{t('pages.path')}</span>
          <Input
            small
            class="u-mono"
            value={page.path}
            onBlur={(e) => {
              const value = (e.target as HTMLInputElement).value.trim();
              if (value && value !== page.path) void save({ path: value });
            }}
          />
          <span class="c-props__key">{t('pages.status')}</span>
          <Select
            small
            value={page.status}
            onChange={(e) =>
              save({ status: (e.target as HTMLSelectElement).value as PageWithStats['status'] })
            }
            options={PAGE_STATUSES.map((s) => ({ value: s, label: t(`pageStatus.${s}`) }))}
          />
          <span class="c-props__key">{t('pages.parent')}</span>
          <Select
            small
            value={page.parent_id ?? ''}
            aria-label={t('pages.parent')}
            onChange={(e) => save({ parent_id: (e.target as HTMLSelectElement).value || null })}
            options={[
              { value: '', label: '—' },
              ...pages
                .filter((p) => !descendants.has(p.id))
                .map((p) => ({ value: p.id, label: p.title || p.path })),
            ]}
          />
        </div>
        <Field label={t('pages.purpose')}>
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={page.purpose}
              onBlur={(e) => {
                const value = (e.target as HTMLTextAreaElement).value;
                if (value !== page.purpose) void save({ purpose: value });
              }}
            />
          )}
        </Field>
        <Field label={t('pages.audience')}>
          {(id) => (
            <Input
              id={id}
              value={page.audience}
              onBlur={(e) => {
                const value = (e.target as HTMLInputElement).value;
                if (value !== page.audience) void save({ audience: value });
              }}
            />
          )}
        </Field>
      </section>
      <section class="c-inspector__section">
        <ContentEditor page={page} />
      </section>
      <section class="c-inspector__section">
        <h3>{t('pages.approvals')}</h3>
        {(approvals.data ?? []).length === 0 ? (
          <p class="u-muted u-text-sm">{t('pages.noApprovals')}</p>
        ) : null}
        {(approvals.data ?? []).map((a) => (
          <div key={a.id} class="o-stack o-stack--xs">
            <span class="o-cluster u-text-sm">
              <Badge tone={a.decision === 'approved' ? 'success' : 'warning'}>
                {t(`approval.${a.decision}`)}
              </Badge>
              <strong>{a.approver_name}</strong>
              <span class="u-muted">{formatDateTime(a.created_at)}</span>
            </span>
            {a.note ? <p class="u-secondary u-text-sm u-pre-wrap">{a.note}</p> : null}
          </div>
        ))}
      </section>
    </aside>
  );
}

// --- Page ------------------------------------------------------------------------------

function NewPageDialog({
  projectId,
  parentId,
  open,
  onClose,
  onCreated,
}: {
  projectId: string;
  parentId: string | null;
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={parentId ? t('pages.addChild') : t('pages.add')}
      onSubmit={async (event) => {
        const data = new FormData(event.target as HTMLFormElement);
        setBusy(true);
        setError(null);
        try {
          const page = await api.pages.create(projectId, {
            path: String(data.get('path')),
            title: String(data.get('title')),
            parent_id: parentId,
          });
          await invalidate(['pages', projectId]);
          onCreated(page.id);
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
      <Field label={t('pages.path')} hint={t('pages.pathHint')} error={error}>
        {(id) => (
          <Input
            id={id}
            name="path"
            required
            pattern="/.*"
            placeholder="/pricing"
            class="u-mono"
            autoFocus
          />
        )}
      </Field>
      <Field label={t('pages.titleField')} optional>
        {(id) => <Input id={id} name="title" maxLength={200} />}
      </Field>
    </Modal>
  );
}

function AiSitemapDialog({
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
      title={t('pages.aiSitemap')}
      onSubmit={async (event) => {
        const brief = String(new FormData(event.target as HTMLFormElement).get('brief'));
        setBusy(true);
        setError(null);
        try {
          await api.ai.draftSitemap(projectId, brief);
          await invalidate(['pages', projectId]);
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
          <Button
            type="submit"
            variant="primary"
            icon={<Sparkles class="c-icon c-icon--sm" />}
            loading={busy}
          >
            {busy ? t('ai.working') : t('pages.aiDraft')}
          </Button>
        </>
      }
    >
      <Field label={t('pages.aiSitemapBrief')} error={error}>
        {(id) => (
          <Textarea
            id={id}
            name="brief"
            rows={5}
            required
            maxLength={4000}
            placeholder={t('pages.aiSitemapPlaceholder')}
            autoFocus
          />
        )}
      </Field>
    </Modal>
  );
}

export function SitemapPage({ project }: { project: ProjectWithStats }) {
  const { path, query, route } = useLocation();
  const pages = usePages(project.id);
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [checking, setChecking] = useState(false);
  const selectedId = query.page ?? null;
  const list = pages.data ?? [];
  const selected = list.find((p) => p.id === selectedId) ?? null;
  const select = (id: string | null) => route(id ? `${path}?page=${id}` : path, true);

  const move = async (pageId: string, parentId: string) => {
    const siblings = list
      .filter((p) => p.parent_id === parentId && p.id !== pageId)
      .sort((a, b) => a.sort_index - b.sort_index);
    try {
      await api.pages.reorder(project.id, parentId, [...siblings.map((p) => p.id), pageId]);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
    await invalidate(['pages', project.id]);
  };

  const copyCheck = async () => {
    setChecking(true);
    try {
      const result = await api.ai.copyCheck(project.id);
      toast(
        result.findings.length
          ? t('pages.copyCheckDone', { count: result.comments_created })
          : t('pages.copyCheckClean'),
      );
      await invalidate(['comments', project.id]);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div class={`o-split o-split--wide${selected ? '' : ' o-split--collapsed'}`}>
      <div>
        <div class="c-toolbar">
          <Button
            size="sm"
            variant="primary"
            icon={<FilePlus2 class="c-icon c-icon--sm" />}
            onClick={() => setAdding({ parentId: selected?.id ?? null })}
          >
            {selected ? t('pages.addChild') : t('pages.add')}
          </Button>
          {instance.value?.ai_enabled ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Sparkles class="c-icon c-icon--sm" />}
                onClick={() => setDrafting(true)}
              >
                {t('pages.aiSitemap')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<SpellCheck class="c-icon c-icon--sm" />}
                loading={checking}
                onClick={copyCheck}
              >
                {t('pages.copyCheck')}
              </Button>
            </>
          ) : null}
        </div>
        {pages.loading ? (
          <div class="c-inspector__section">
            <Skeleton lines={6} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            title={t('pages.empty')}
            text={t('pages.emptyText')}
            action={
              <span class="o-cluster">
                <Button
                  variant="primary"
                  icon={<Plus class="c-icon" />}
                  onClick={() => setAdding({ parentId: null })}
                >
                  {t('pages.add')}
                </Button>
                {instance.value?.ai_enabled ? (
                  <Button icon={<Sparkles class="c-icon" />} onClick={() => setDrafting(true)}>
                    {t('pages.aiSitemap')}
                  </Button>
                ) : null}
              </span>
            }
          />
        ) : (
          <Tree pages={list} selectedId={selectedId} onSelect={select} onMove={move} />
        )}
      </div>
      {selected ? (
        <PageDetail
          key={selected.id}
          page={selected}
          pages={list}
          projectId={project.id}
          onDeleted={() => select(null)}
        />
      ) : null}
      {adding ? (
        <NewPageDialog
          projectId={project.id}
          parentId={adding.parentId}
          open
          onClose={() => setAdding(null)}
          onCreated={(id) => select(id)}
        />
      ) : null}
      {drafting ? (
        <AiSitemapDialog projectId={project.id} open onClose={() => setDrafting(false)} />
      ) : null}
    </div>
  );
}
