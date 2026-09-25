import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size' | 'loading' | 'type'> {
  variant?: Variant;
  size?: Size;
  icon?: ComponentChildren;
  loading?: boolean;
  block?: boolean;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
}

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', extra = ''): string {
  return [
    'c-btn',
    variant !== 'secondary' && `c-btn--${variant}`,
    size !== 'md' && `c-btn--${size}`,
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

export function Button({
  variant,
  size,
  icon,
  loading,
  block,
  children,
  class: className,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      class={buttonClass(
        variant,
        size,
        [block && 'c-btn--block', loading && 'is-loading', className].filter(Boolean).join(' '),
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span class="c-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  size,
  variant = 'ghost',
  icon,
  ...rest
}: Omit<ButtonProps, 'children'> & { label: string }) {
  return (
    <button
      type="button"
      class={buttonClass(variant, size, 'c-btn--icon')}
      aria-label={label}
      title={label}
      {...rest}
    >
      {icon}
    </button>
  );
}
