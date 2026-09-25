import type {
  ComponentChildren,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'preact';
import { useId } from 'preact/hooks';
import { t } from '../lib/i18n';

export function Field({
  label,
  hint,
  error,
  children,
  optional,
}: {
  label: ComponentChildren;
  hint?: ComponentChildren;
  error?: string | null;
  optional?: boolean;
  children: (id: string) => ComponentChildren;
}) {
  const id = useId();
  return (
    <div class="c-field">
      <label class="c-field__label" for={id}>
        {label}
        {optional ? <span class="u-muted"> · {t('common.optional')}</span> : null}
      </label>
      {children(id)}
      {error ? (
        <p class="c-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p class="c-field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { small?: boolean; bare?: boolean };

export function Input({ small, bare, class: className, ...rest }: InputProps) {
  return (
    <input
      class={['c-input', small && 'c-input--sm', bare && 'c-input--bare', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
}

export function Textarea({
  class: className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea class={['c-textarea', className].filter(Boolean).join(' ')} {...rest} />;
}

export function Select({
  small,
  options,
  class: className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  small?: boolean;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      class={['c-select', small && 'c-select--sm', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  label,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ComponentChildren }) {
  return (
    <label class="c-check">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  label,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <input
      type="checkbox"
      role="switch"
      class="c-switch"
      aria-label={label}
      aria-checked={Boolean(rest.checked)}
      {...rest}
    />
  );
}
