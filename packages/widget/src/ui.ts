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

/** The embeddable feedback widget, fully isolated in a shadow root. */
export class CroquisWidget {
  private readonly root: ShadowRoot;
  private overlay!: HTMLElement;
  private popover!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private authorInput!: HTMLInputElement;
  private targetLabel!: HTMLElement;
  private toastEl!: HTMLElement;
  private metadata: ElementMetadata | null = null;
  private currentTarget: Element | null = null;
  private busy = false;
  private toastTimer: number | null = null;

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

    const fab = el('div', 'cq-fab');
    fab.appendChild(el('span', 'cq-fab__dot'));
    const fabText = el('span');
    fabText.textContent = 'Croquis · right-click to comment';
    fab.appendChild(fabText);

    this.overlay = el('div', 'cq-overlay cq-hidden');

    this.popover = el('div', 'cq-pop cq-hidden');
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
    const cancel = button('cq-btn', 'Cancel');
    const send = button('cq-btn cq-btn--primary', 'Send');
    cancel.addEventListener('click', () => this.close());
    send.addEventListener('click', () => void this.submit());
    actions.append(cancel, send);

    this.popover.append(title, this.targetLabel, this.textarea, this.authorInput, actions);

    this.toastEl = el('div', 'cq-toast cq-hidden');

    container.append(fab, this.overlay, this.popover, this.toastEl);
    this.root.appendChild(container);
  }

  private bindEvents(): void {
    document.addEventListener('contextmenu', (e) => this.onContextMenu(e), true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    // Keep the highlight glued to its element while the page scrolls/resizes.
    const track = (): void => this.trackTarget();
    window.addEventListener('scroll', track, { passive: true, capture: true });
    window.addEventListener('resize', track, { passive: true });
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
    this.currentTarget = target;
    this.metadata = collectMetadata(target, event.clientX, event.clientY);
    this.targetLabel.textContent = this.metadata.element_selector;
    this.textarea.value = '';
    this.showOverlay(target.getBoundingClientRect());
    this.showPopover(event.clientX, event.clientY);
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
    this.popover.classList.add('cq-hidden');
    this.overlay.classList.add('cq-hidden');
    this.metadata = null;
    this.currentTarget = null;
  }

  private async submit(): Promise<void> {
    if (this.busy || !this.metadata) return;
    const body = this.textarea.value.trim();
    if (!body) {
      this.textarea.focus();
      return;
    }
    this.busy = true;
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
      this.close();
      this.showToast('Comment sent', 'ok');
    } catch {
      this.showToast('Failed to send comment', 'error');
    } finally {
      this.busy = false;
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
