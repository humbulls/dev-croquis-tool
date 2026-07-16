import widgetCss from './widget.css';
import tokensCss from '@croquis/tokens/tokens.css';
import type { WidgetConfig } from './config';
import { collectMetadata, type ElementMetadata } from './metadata';
import { postComment } from './api';

const MOBILE_MAX_WIDTH = 767;
const POPOVER_MARGIN = 8;
const POPOVER_W = 340;
const POPOVER_H = 260;
const TOAST_MS = 2600;

function el(tag: string, className = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function button(className: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  return b;
}

/** Coarse-pointer (touch-first) device, e.g. phones and tablets. */
function isTouchDevice(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** The embeddable feedback widget, fully isolated in a shadow root. */
export class CroquisWidget {
  private readonly root: ShadowRoot;
  private overlay!: HTMLElement;
  private popover!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private authorInput!: HTMLInputElement;
  private targetLabel!: HTMLElement;
  private toastEl!: HTMLElement;
  private fab!: HTMLButtonElement;
  private sendBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;
  private metadata: ElementMetadata | null = null;
  private currentTarget: Element | null = null;
  private busy = false;
  private toastTimer: number | null = null;
  /** Touch fallback: FAB toggles "tap an element to comment" mode. */
  private tapMode = false;
  private readonly touch = isTouchDevice();

  constructor(private readonly config: WidgetConfig) {
    const host = el('div');
    host.setAttribute('data-croquis-widget', '');
    document.body.appendChild(host);
    this.root = host.attachShadow({ mode: 'open' });
    this.render();
    this.bindEvents();
  }

  private render(): void {
    const style = document.createElement('style');
    style.textContent = `${tokensCss}\n${widgetCss}`;
    this.root.appendChild(style);

    const container = el('div', 'cq-root');

    this.fab = button('cq-fab', '');
    this.fab.appendChild(el('span', 'cq-fab__dot'));
    const fabText = el('span');
    fabText.textContent = this.touch ? 'Croquis · tap to comment' : 'Croquis · right-click to comment';
    this.fab.appendChild(fabText);
    this.fab.title = this.touch
      ? 'Tap, then tap the element you want to comment on'
      : 'Right-click any element to comment · Shift+right-click opens the normal browser menu';
    this.fab.addEventListener('click', () => this.toggleTapMode());

    this.overlay = el('div', 'cq-overlay cq-hidden');

    this.popover = el('div', 'cq-pop cq-hidden');
    this.popover.setAttribute('role', 'dialog');
    this.popover.setAttribute('aria-modal', 'true');
    this.popover.setAttribute('aria-label', 'Leave a comment');
    const title = el('p', 'cq-pop__title');
    title.textContent = 'Leave a comment';
    this.targetLabel = el('div', 'cq-pop__target');

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'cq-pop__textarea';
    this.textarea.placeholder = 'What should change here?';

    this.authorInput = document.createElement('input');
    this.authorInput.className = 'cq-pop__input';
    this.authorInput.placeholder = 'Your name (optional)';
    if (this.config.author) this.authorInput.value = this.config.author;

    const actions = el('div', 'cq-pop__actions');
    this.cancelBtn = button('cq-btn', 'Cancel');
    this.sendBtn = button('cq-btn cq-btn--primary', 'Send');
    this.cancelBtn.addEventListener('click', () => this.close());
    this.sendBtn.addEventListener('click', () => void this.submit());
    actions.append(this.cancelBtn, this.sendBtn);

    this.popover.append(title, this.targetLabel, this.textarea, this.authorInput, actions);

    // Simple focus trap: keep Tab cycling inside the dialog while it is open.
    this.popover.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusables = [this.textarea, this.authorInput, this.cancelBtn, this.sendBtn];
      const index = focusables.indexOf(this.root.activeElement as (typeof focusables)[number]);
      if (index === -1) return;
      e.preventDefault();
      const next = e.shiftKey
        ? (index - 1 + focusables.length) % focusables.length
        : (index + 1) % focusables.length;
      focusables[next]?.focus();
    });

    this.toastEl = el('div', 'cq-toast cq-hidden');

    container.append(this.fab, this.overlay, this.popover, this.toastEl);
    this.root.appendChild(container);
  }

  private bindEvents(): void {
    document.addEventListener('contextmenu', (e) => this.onContextMenu(e), true);
    // Touch fallback: while tap mode is armed, the next tap picks the target.
    document.addEventListener('click', (e) => this.onTapModeClick(e), true);
    document.addEventListener('keydown', (e) => {
      // Escape that cancels an IME conversion must not close the popover.
      if (e.key === 'Escape' && !e.isComposing) this.close();
    });
    // Keep the highlight glued to its element while the page scrolls/resizes.
    const track = (): void => this.trackTarget();
    window.addEventListener('scroll', track, { passive: true, capture: true });
    window.addEventListener('resize', track, { passive: true });
  }

  private toggleTapMode(): void {
    this.tapMode = !this.tapMode;
    const label = this.fab.querySelector('span:last-child');
    if (this.tapMode) {
      if (label) label.textContent = 'Now tap/click the element to comment on…';
    } else if (label) {
      label.textContent = this.touch ? 'Croquis · tap to comment' : 'Croquis · right-click to comment';
    }
  }

  private onTapModeClick(event: MouseEvent): void {
    if (!this.tapMode) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-croquis-widget]')) return; // taps on our own UI
    event.preventDefault();
    event.stopPropagation();
    this.toggleTapMode(); // disarm
    this.openFor(target, event.clientX, event.clientY);
  }

  private trackTarget(): void {
    if (!this.currentTarget) return;
    this.showOverlay(this.currentTarget.getBoundingClientRect());
  }

  private onContextMenu(event: MouseEvent): void {
    // Shift+right-click bypasses Croquis and opens the native context menu.
    if (event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Ignore right-clicks on our own host element.
    if (target.closest('[data-croquis-widget]')) return;

    event.preventDefault();
    this.openFor(target, event.clientX, event.clientY);
  }

  private openFor(target: Element, x: number, y: number): void {
    const sameTarget = this.currentTarget === target;
    this.currentTarget = target;
    this.metadata = collectMetadata(target, x, y);
    this.targetLabel.textContent = this.metadata.element_selector;
    // Keep an unsent draft when re-opening on the same element.
    if (!sameTarget) this.textarea.value = '';
    this.showOverlay(target.getBoundingClientRect());
    this.showPopover(x, y);
    this.textarea.focus();
  }

  private showOverlay(rect: DOMRect): void {
    this.overlay.classList.remove('cq-hidden');
    this.overlay.style.left = `${rect.left}px`;
    this.overlay.style.top = `${rect.top}px`;
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;
  }

  private showPopover(x: number, y: number): void {
    this.popover.classList.remove('cq-hidden');
    // Measure the real (token-driven) size; constants are only a fallback.
    const width = this.popover.offsetWidth || POPOVER_W;
    const height = this.popover.offsetHeight || POPOVER_H;
    const left = Math.max(POPOVER_MARGIN, Math.min(x, window.innerWidth - width - POPOVER_MARGIN));
    const top = Math.max(POPOVER_MARGIN, Math.min(y, window.innerHeight - height - POPOVER_MARGIN));
    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${top}px`;
  }

  private close(): void {
    if (this.busy) return; // don't allow closing mid-send; state would be ambiguous
    this.popover.classList.add('cq-hidden');
    this.overlay.classList.add('cq-hidden');
    this.metadata = null;
  }

  private setSending(sending: boolean): void {
    this.sendBtn.disabled = sending;
    this.cancelBtn.disabled = sending;
    this.sendBtn.textContent = sending ? 'Sending…' : 'Send';
  }

  private async submit(): Promise<void> {
    if (this.busy || !this.metadata) return;
    const body = this.textarea.value.trim();
    if (!body) {
      this.textarea.focus();
      return;
    }
    this.busy = true;
    this.setSending(true);
    try {
      await postComment(this.config, {
        ...this.metadata,
        page_url: window.location.href,
        viewport: window.innerWidth <= MOBILE_MAX_WIDTH ? 'mobile' : 'desktop',
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
        body,
        author_name: this.authorInput.value.trim() || null,
      });
      this.busy = false;
      this.setSending(false);
      this.textarea.value = '';
      this.close();
      this.showToast('Comment sent', 'ok');
    } catch (error) {
      this.busy = false;
      this.setSending(false);
      // Surface the cause for the site owner's console; keep the toast short.
      // eslint-disable-next-line no-console
      console.error('[croquis] failed to send comment:', error);
      const message = error instanceof Error ? error.message : '';
      const misconfigured = /(401|403)/.test(message);
      this.showToast(
        misconfigured ? 'Feedback widget is misconfigured (invalid key)' : 'Failed to send comment',
        'error',
      );
    }
  }

  private showToast(message: string, kind: 'ok' | 'error'): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.toggle('cq-toast--error', kind === 'error');
    this.toastEl.classList.remove('cq-hidden');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('cq-hidden'), TOAST_MS);
  }
}
