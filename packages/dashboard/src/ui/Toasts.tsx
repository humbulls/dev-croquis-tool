import { dismiss, toasts } from '../lib/toast';

export function Toasts() {
  return (
    <div class="c-toasts" aria-live="polite">
      {toasts.value.map((item) => (
        <div
          key={item.id}
          class={`c-toast${item.tone === 'error' ? ' c-toast--error' : ''}`}
          role={item.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{item.text}</span>
          {item.action ? (
            <button
              type="button"
              class="c-toast__action"
              onClick={() => {
                item.action?.run();
                dismiss(item.id);
              }}
            >
              {item.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
