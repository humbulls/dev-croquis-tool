import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * Dropdown menu: a trigger plus a popover list. Closes on outside click,
 * Escape, or selecting an item; arrow keys move between items.
 */
export function Menu({
  trigger,
  children,
  align = 'left',
  direction = 'down',
}: {
  trigger: (props: {
    open: boolean;
    toggle: () => void;
    'aria-expanded': boolean;
    'aria-haspopup': 'menu';
  }) => ComponentChildren;
  children: (close: () => void) => ComponentChildren;
  align?: 'left' | 'right';
  direction?: 'down' | 'up';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = Array.from(
        ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ??
          [],
      );
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === 'ArrowDown'
          ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length;
      items[next]?.focus();
      event.preventDefault();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')?.focus(),
    );
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div class="c-menu-anchor" ref={ref}>
      {trigger({
        open,
        toggle: () => setOpen((v) => !v),
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      })}
      {open ? (
        <div
          class={`c-menu${align === 'right' ? ' c-menu--right' : ''}${direction === 'up' ? ' c-menu--up' : ''}`}
          role="menu"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  onSelect,
  children,
  selected,
  danger,
  href,
}: {
  onSelect?: () => void;
  children: ComponentChildren;
  selected?: boolean;
  danger?: boolean;
  href?: string;
}) {
  const className = `c-menu__item${selected ? ' is-selected' : ''}${danger ? ' c-menu__item--danger' : ''}`;
  if (href) {
    return (
      <a class={className} role="menuitem" href={href} onClick={onSelect}>
        {children}
      </a>
    );
  }
  if (selected === undefined) {
    return (
      <button type="button" class={className} role="menuitem" onClick={onSelect}>
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      class={className}
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

export const MenuSeparator = () => <hr class="c-menu__separator" />;
export const MenuHeading = ({ children }: { children: ComponentChildren }) => (
  <div class="c-menu__heading">{children}</div>
);
