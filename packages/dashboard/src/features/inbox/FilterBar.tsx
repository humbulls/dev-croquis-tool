import type { CommentFilters, Label, Member, PageWithStats } from '@croquis/client';
import { COMMENT_KINDS, COMMENT_PRIORITIES, COMMENT_STATUSES } from '@croquis/shared/constants';
import { ArrowUpDown, Check, Search, X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type MessageKey, t } from '../../lib/i18n';
import { Avatar, LabelChip, PriorityIcon, StatusDot } from '../../ui/Display';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';

export interface InboxFilters {
  status: string[];
  priority: string[];
  kind: string[];
  page: string | null;
  assignee: string | null;
  label: string | null;
  q: string;
  sort: NonNullable<CommentFilters['sort']>;
}

const csv = (value: string | undefined) => (value ? value.split(',').filter(Boolean) : []);

export function filtersFromQuery(query: Record<string, string>): InboxFilters {
  return {
    status: csv(query.status),
    priority: csv(query.priority),
    kind: csv(query.kind),
    page: query.page ?? null,
    assignee: query.assignee ?? null,
    label: query.label ?? null,
    q: query.q ?? '',
    sort:
      (['newest', 'oldest', 'priority', 'updated'] as const).find((s) => s === query.sort) ??
      'newest',
  };
}

export function filtersToQuery(filters: InboxFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (filters.status.length) out.status = filters.status.join(',');
  if (filters.priority.length) out.priority = filters.priority.join(',');
  if (filters.kind.length) out.kind = filters.kind.join(',');
  if (filters.page) out.page = filters.page;
  if (filters.assignee) out.assignee = filters.assignee;
  if (filters.label) out.label = filters.label;
  if (filters.q) out.q = filters.q;
  if (filters.sort !== 'newest') out.sort = filters.sort;
  return out;
}

export function toApiFilters(filters: InboxFilters): CommentFilters {
  return {
    status: filters.status.length ? filters.status : undefined,
    priority: filters.priority.length ? filters.priority : undefined,
    kind: filters.kind.length ? filters.kind : undefined,
    page: filters.page ?? undefined,
    assignee: filters.assignee ?? undefined,
    label: filters.label ?? undefined,
    q: filters.q || undefined,
    sort: filters.sort,
    limit: 50,
  };
}

function FilterChip({
  label,
  value,
  children,
}: {
  label: string;
  value: string | null;
  children: (close: () => void) => ComponentChildren;
}) {
  return (
    <Menu
      trigger={(props) => (
        <button
          type="button"
          class={`c-filter${value ? ' is-set' : ''}`}
          onClick={props.toggle}
          aria-expanded={props['aria-expanded']}
          aria-haspopup="menu"
        >
          {label}
          {value ? `: ${value}` : null}
        </button>
      )}
    >
      {children}
    </Menu>
  );
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function MultiOptions<T extends string>({
  options,
  selected,
  render,
  onChange,
}: {
  options: readonly T[];
  selected: string[];
  render: (value: T) => ComponentChildren;
  onChange: (next: string[]) => void;
}) {
  return (
    <>
      {options.map((value) => (
        <MenuItem
          key={value}
          selected={selected.includes(value)}
          onSelect={() => onChange(toggle(selected, value))}
        >
          {render(value)}
          <span class="u-grow" />
          {selected.includes(value) ? <Check class="c-icon c-icon--sm" /> : null}
        </MenuItem>
      ))}
    </>
  );
}

const summary = (values: string[], prefix: string) =>
  values.length === 0
    ? null
    : values.length === 1
      ? t(`${prefix}.${values[0]}` as MessageKey)
      : `${values.length}`;

export function FilterBar({
  filters,
  onChange,
  pages,
  members,
  labels,
  currentUserId,
  actions,
}: {
  filters: InboxFilters;
  onChange: (next: InboxFilters) => void;
  pages: PageWithStats[];
  members: Member[];
  labels: Label[];
  currentUserId: string | null;
  actions?: ComponentChildren;
}) {
  const [q, setQ] = useState(filters.q);
  useEffect(() => setQ(filters.q), [filters.q]);
  useEffect(() => {
    if (q === filters.q) return;
    const timer = setTimeout(() => onChange({ ...filters, q }), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const set = (patch: Partial<InboxFilters>) => onChange({ ...filters, ...patch });
  const pageName =
    filters.page === 'unassigned'
      ? t('inbox.unassignedPages')
      : ((pages.find((p) => p.id === filters.page)?.title ||
          pages.find((p) => p.id === filters.page)?.path) ??
        null);
  const assigneeName =
    filters.assignee === 'me'
      ? t('inbox.me')
      : filters.assignee === 'none'
        ? t('inbox.nobody')
        : (members.find((m) => m.user.id === filters.assignee)?.user.name ?? null);
  const labelName = labels.find((l) => l.id === filters.label)?.name ?? null;
  const active =
    filters.status.length +
      filters.priority.length +
      filters.kind.length +
      (filters.page ? 1 : 0) +
      (filters.assignee ? 1 : 0) +
      (filters.label ? 1 : 0) +
      (filters.q ? 1 : 0) >
    0;

  return (
    <div class="c-toolbar" role="toolbar" aria-label={t('common.search')}>
      <label class="c-search">
        <Search class="c-icon c-icon--sm" />
        <span class="u-visually-hidden">{t('common.search')}</span>
        <input
          type="search"
          value={q}
          placeholder={t('inbox.searchPlaceholder')}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
      </label>
      <FilterChip label={t('inbox.filter.status')} value={summary(filters.status, 'status')}>
        {() => (
          <MultiOptions
            options={COMMENT_STATUSES}
            selected={filters.status}
            onChange={(status) => set({ status })}
            render={(s) => (
              <>
                <StatusDot status={s} />
                {t(`status.${s}`)}
              </>
            )}
          />
        )}
      </FilterChip>
      <FilterChip label={t('inbox.filter.priority')} value={summary(filters.priority, 'priority')}>
        {() => (
          <MultiOptions
            options={[...COMMENT_PRIORITIES].reverse()}
            selected={filters.priority}
            onChange={(priority) => set({ priority })}
            render={(p) => <PriorityIcon priority={p} withLabel />}
          />
        )}
      </FilterChip>
      <FilterChip label={t('inbox.filter.kind')} value={summary(filters.kind, 'kind')}>
        {() => (
          <MultiOptions
            options={COMMENT_KINDS}
            selected={filters.kind}
            onChange={(kind) => set({ kind })}
            render={(k) => t(`kind.${k}`)}
          />
        )}
      </FilterChip>
      <FilterChip label={t('inbox.filter.page')} value={pageName}>
        {(close) => (
          <>
            <MenuItem
              selected={filters.page === null}
              onSelect={() => {
                set({ page: null });
                close();
              }}
            >
              {t('common.all')}
            </MenuItem>
            <MenuItem
              selected={filters.page === 'unassigned'}
              onSelect={() => {
                set({ page: 'unassigned' });
                close();
              }}
            >
              {t('inbox.unassignedPages')}
            </MenuItem>
            <MenuSeparator />
            {pages.map((p) => (
              <MenuItem
                key={p.id}
                selected={filters.page === p.id}
                onSelect={() => {
                  set({ page: p.id });
                  close();
                }}
              >
                <span class="u-truncate">{p.title || p.path}</span>
                <span class="u-muted u-mono u-text-xs">{p.path}</span>
              </MenuItem>
            ))}
          </>
        )}
      </FilterChip>
      <FilterChip label={t('inbox.filter.assignee')} value={assigneeName}>
        {(close) => (
          <>
            <MenuItem
              selected={filters.assignee === null}
              onSelect={() => {
                set({ assignee: null });
                close();
              }}
            >
              {t('common.all')}
            </MenuItem>
            {currentUserId ? (
              <MenuItem
                selected={filters.assignee === 'me'}
                onSelect={() => {
                  set({ assignee: 'me' });
                  close();
                }}
              >
                {t('inbox.me')}
              </MenuItem>
            ) : null}
            <MenuItem
              selected={filters.assignee === 'none'}
              onSelect={() => {
                set({ assignee: 'none' });
                close();
              }}
            >
              {t('inbox.nobody')}
            </MenuItem>
            <MenuSeparator />
            {members.map((m) => (
              <MenuItem
                key={m.user.id}
                selected={filters.assignee === m.user.id}
                onSelect={() => {
                  set({ assignee: m.user.id });
                  close();
                }}
              >
                <Avatar name={m.user.name} image={m.user.image} small />
                {m.user.name}
              </MenuItem>
            ))}
          </>
        )}
      </FilterChip>
      {labels.length ? (
        <FilterChip label={t('inbox.filter.label')} value={labelName}>
          {(close) => (
            <>
              <MenuItem
                selected={filters.label === null}
                onSelect={() => {
                  set({ label: null });
                  close();
                }}
              >
                {t('common.all')}
              </MenuItem>
              {labels.map((l) => (
                <MenuItem
                  key={l.id}
                  selected={filters.label === l.id}
                  onSelect={() => {
                    set({ label: l.id });
                    close();
                  }}
                >
                  <LabelChip name={l.name} color={l.color} />
                </MenuItem>
              ))}
            </>
          )}
        </FilterChip>
      ) : null}
      {active ? (
        <button
          type="button"
          class="c-btn c-btn--ghost c-btn--sm"
          onClick={() =>
            onChange({
              status: [],
              priority: [],
              kind: [],
              page: null,
              assignee: null,
              label: null,
              q: '',
              sort: filters.sort,
            })
          }
        >
          <X class="c-icon c-icon--sm" />
          {t('inbox.filter.clear')}
        </button>
      ) : null}
      <span class="u-grow" />
      <Menu
        align="right"
        trigger={(props) => (
          <button
            type="button"
            class="c-btn c-btn--ghost c-btn--sm"
            onClick={props.toggle}
            aria-expanded={props['aria-expanded']}
            aria-haspopup="menu"
          >
            <ArrowUpDown class="c-icon c-icon--sm" />
            {t(`inbox.sort.${filters.sort}`)}
          </button>
        )}
      >
        {(close) =>
          (['newest', 'oldest', 'priority', 'updated'] as const).map((sort) => (
            <MenuItem
              key={sort}
              selected={filters.sort === sort}
              onSelect={() => {
                set({ sort });
                close();
              }}
            >
              {t(`inbox.sort.${sort}`)}
            </MenuItem>
          ))
        }
      </Menu>
      {actions}
    </div>
  );
}
