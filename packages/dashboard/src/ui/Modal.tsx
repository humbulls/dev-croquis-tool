import { X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../lib/i18n';
import { IconButton } from './Button';

/** Native <dialog> modal: focus trapping, Escape and backdrop come from the platform. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: ComponentChildren;
  children: ComponentChildren;
  footer?: ComponentChildren;
  onSubmit?: (event: Event) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  if (!open) return null;
  const body = (
    <>
      <header class="c-modal__header">
        <h2>{title}</h2>
        <IconButton label={t('common.close')} icon={<X class="c-icon" />} onClick={onClose} />
      </header>
      <div class="c-modal__body">{children}</div>
      {footer ? <footer class="c-modal__footer">{footer}</footer> : null}
    </>
  );
  return (
    // Backdrop click closes; the keyboard equivalent is Escape (the native `cancel` event).
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close with Escape
    <dialog
      ref={ref}
      class="c-modal"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {onSubmit ? (
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(event);
          }}
        >
          {body}
        </form>
      ) : (
        body
      )}
    </dialog>
  );
}
