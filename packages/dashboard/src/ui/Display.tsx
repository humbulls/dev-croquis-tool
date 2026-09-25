import type { Author, CommentPriority, CommentStatus, LabelColor } from '@croquis/client';
import { Copy, Inbox } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { copyText } from '../lib/copy';
import { t } from '../lib/i18n';
import { IconButton } from './Button';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: Tone;
  children: ComponentChildren;
  title?: string;
}) {
  return (
    <span class={`c-badge${tone === 'neutral' ? '' : ` c-badge--${tone}`}`} title={title}>
      {children}
    </span>
  );
}

export function LabelChip({ name, color }: { name: string; color: LabelColor }) {
  return <span class={`c-label c-label--${color}`}>{name}</span>;
}

export function StatusDot({ status, label }: { status: string; label?: string }) {
  if (!label) return <span class={`c-dot c-dot--${status}`} aria-hidden="true" />;
  return <span class={`c-dot c-dot--${status}`} role="img" aria-label={label} title={label} />;
}

const PRIORITY_BARS: Record<CommentPriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

/** Signal-strength style priority indicator. */
export function PriorityIcon({
  priority,
  withLabel,
}: {
  priority: CommentPriority;
  withLabel?: boolean;
}) {
  const bars = PRIORITY_BARS[priority];
  return (
    <span class={`c-priority c-priority--${priority}`} title={t(`priority.${priority}`)}>
      <svg class="c-icon c-icon--sm" viewBox="0 0 16 16" aria-hidden="true">
        {priority === 'urgent' ? (
          <path d="M8 2v7M8 12.5v.5" />
        ) : (
          [0, 1, 2].map((i) => (
            <path key={i} d={`M${3 + i * 5} 13V${10 - i * 3}`} opacity={i < bars ? 1 : 0.3} />
          ))
        )}
      </svg>
      {withLabel ? t(`priority.${priority}`) : null}
    </span>
  );
}

export function StatusLabel({ status }: { status: CommentStatus }) {
  return (
    <span class="o-cluster o-cluster--nowrap">
      <StatusDot status={status} />
      {t(`status.${status}`)}
    </span>
  );
}

export function initials(name: string | null | undefined): string {
  const words = (name ?? '?').trim().split(/\s+/);
  return (
    (words[0]?.[0] ?? '?') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

export function Avatar({
  name,
  image,
  kind = 'user',
  small,
}: {
  name: string | null;
  image?: string | null;
  kind?: Author['type'];
  small?: boolean;
}) {
  const variant =
    kind === 'guest' || kind === 'anonymous'
      ? ' c-avatar--guest'
      : kind === 'agent'
        ? ' c-avatar--agent'
        : '';
  return (
    <span
      class={`c-avatar${small ? ' c-avatar--sm' : ''}${variant}`}
      title={name ?? undefined}
      aria-hidden="true"
    >
      {image ? <img src={image} alt="" /> : initials(name)}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ComponentChildren;
  title: string;
  text?: string;
  action?: ComponentChildren;
}) {
  return (
    <div class="c-empty">
      <span class="c-empty__icon">{icon ?? <Inbox class="c-icon c-icon--lg" />}</span>
      <p class="c-empty__title">{title}</p>
      {text ? <p class="c-empty__text">{text}</p> : null}
      {action}
    </div>
  );
}

export function Spinner({ label = t('common.loading') }: { label?: string }) {
  return <span class="c-spinner" role="status" aria-label={label} />;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div class="o-stack o-stack--sm" aria-busy="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} class="c-skeleton" />
      ))}
    </div>
  );
}

export function Callout({
  tone,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  children: ComponentChildren;
}) {
  return <div class={`c-callout${tone ? ` c-callout--${tone}` : ''}`}>{children}</div>;
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div class="c-code">
      {code}
      <span class="c-code__copy">
        <IconButton
          size="sm"
          label={label ?? t('common.copy')}
          icon={<Copy class="c-icon c-icon--sm" />}
          onClick={() => copyText(code)}
        />
      </span>
    </div>
  );
}

export function Kbd({ children }: { children: ComponentChildren }) {
  return <kbd class="c-kbd">{children}</kbd>;
}
