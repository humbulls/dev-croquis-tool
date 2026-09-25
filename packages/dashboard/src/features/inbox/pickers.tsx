import type { CommentPriority, CommentStatus, Label, Member } from '@croquis/client';
import { COMMENT_PRIORITIES, COMMENT_STATUSES } from '@croquis/shared/constants';
import { Check, UserRound } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { t } from '../../lib/i18n';
import { Avatar, LabelChip, PriorityIcon, StatusDot } from '../../ui/Display';
import { Menu, MenuHeading, MenuItem } from '../../ui/Menu';

function Trigger({ children, label }: { children: ComponentChildren; label: string }) {
  return (props: { toggle: () => void; 'aria-expanded': boolean }) => (
    <button
      type="button"
      class="c-btn c-btn--ghost c-btn--sm"
      onClick={props.toggle}
      aria-expanded={props['aria-expanded']}
      aria-haspopup="menu"
    >
      <span class="u-visually-hidden">{label}: </span>
      {children}
    </button>
  );
}

export function StatusPicker({
  value,
  onChange,
}: {
  value: CommentStatus;
  onChange: (status: CommentStatus) => void;
}) {
  return (
    <Menu
      trigger={Trigger({
        label: t('common.status'),
        children: (
          <>
            <StatusDot status={value} />
            {t(`status.${value}`)}
          </>
        ),
      })}
    >
      {(close) =>
        COMMENT_STATUSES.map((status) => (
          <MenuItem
            key={status}
            selected={status === value}
            onSelect={() => {
              onChange(status);
              close();
            }}
          >
            <StatusDot status={status} />
            {t(`status.${status}`)}
          </MenuItem>
        ))
      }
    </Menu>
  );
}

export function PriorityPicker({
  value,
  onChange,
}: {
  value: CommentPriority;
  onChange: (priority: CommentPriority) => void;
}) {
  return (
    <Menu
      trigger={Trigger({
        label: t('common.priority'),
        children: <PriorityIcon priority={value} withLabel />,
      })}
    >
      {(close) =>
        [...COMMENT_PRIORITIES].reverse().map((priority) => (
          <MenuItem
            key={priority}
            selected={priority === value}
            onSelect={() => {
              onChange(priority);
              close();
            }}
          >
            <PriorityIcon priority={priority} withLabel />
          </MenuItem>
        ))
      }
    </Menu>
  );
}

export function AssigneePicker({
  value,
  members,
  onChange,
}: {
  value: { id: string; name: string; image: string | null } | null;
  members: Member[];
  onChange: (userId: string | null) => void;
}) {
  return (
    <Menu
      trigger={Trigger({
        label: t('common.assignee'),
        children: value ? (
          <>
            <Avatar name={value.name} image={value.image} small />
            {value.name}
          </>
        ) : (
          <>
            <UserRound class="c-icon c-icon--sm" />
            {t('inbox.nobody')}
          </>
        ),
      })}
    >
      {(close) => (
        <>
          <MenuItem
            selected={value === null}
            onSelect={() => {
              onChange(null);
              close();
            }}
          >
            <UserRound class="c-icon c-icon--sm" />
            {t('inbox.nobody')}
          </MenuItem>
          {members.map((m) => (
            <MenuItem
              key={m.user.id}
              selected={value?.id === m.user.id}
              onSelect={() => {
                onChange(m.user.id);
                close();
              }}
            >
              <Avatar name={m.user.name} image={m.user.image} small />
              {m.user.name}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

export function LabelsPicker({
  value,
  labels,
  onChange,
}: {
  value: Label[];
  labels: Label[];
  onChange: (ids: string[]) => void;
}) {
  const selected = new Set(value.map((l) => l.id));
  return (
    <Menu
      trigger={Trigger({
        label: t('common.labels'),
        children: value.length ? (
          <span class="o-cluster">
            {value.map((l) => (
              <LabelChip key={l.id} name={l.name} color={l.color} />
            ))}
          </span>
        ) : (
          <span class="u-muted">{t('common.none')}</span>
        ),
      })}
    >
      {() => (
        <>
          <MenuHeading>{t('common.labels')}</MenuHeading>
          {labels.length === 0 ? <p class="c-menu__item u-muted">{t('common.none')}</p> : null}
          {labels.map((label) => (
            <MenuItem
              key={label.id}
              selected={selected.has(label.id)}
              onSelect={() => {
                const next = new Set(selected);
                if (next.has(label.id)) next.delete(label.id);
                else next.add(label.id);
                onChange([...next]);
              }}
            >
              <LabelChip name={label.name} color={label.color} />
              <span class="u-grow" />
              {selected.has(label.id) ? <Check class="c-icon c-icon--sm" /> : null}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}
