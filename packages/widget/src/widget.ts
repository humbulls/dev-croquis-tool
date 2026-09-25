import type {
  PublicComment,
  WidgetConfig as RemoteConfig,
  ShareCommentDetail,
} from '@croquis/shared';
import tokensCss from '@croquis/tokens/tokens.css';
import { type Anchor, captureAnchor, resolveAnchor } from './anchor';
import { WidgetApi, WidgetApiError } from './api';
import { takeScreenshot } from './capture';
import type { WidgetConfig } from './config';
import { installDiagnostics, snapshotDiagnostics } from './diagnostics';
import { captureEnvironment } from './environment';
import { type MessageKey, messages } from './i18n';
import {
  clearSession,
  loadReviewer,
  loadSession,
  type ReviewSession,
  saveSession,
  takeActivationSlug,
} from './session';
import { h, icon, placeNear } from './ui/dom';
import widgetCss from './widget.css';

type Kind = 'feedback' | 'bug' | 'question';

interface Target {
  element: Element | null;
  anchor: Anchor | null;
  x: number;
  y: number;
  selection: string | null;
}

const HOST_ATTR = 'data-croquis-widget';

/** The only style the widget adds to the host page: a crosshair while picking. */
function ensurePickingCursor(): void {
  if (document.getElementById('croquis-picking-style')) return;
  const style = document.createElement('style');
  style.id = 'croquis-picking-style';
  style.textContent = '.croquis-picking, .croquis-picking * { cursor: crosshair !important; }';
  document.head.append(style);
}

/**
 * The embeddable widget. Everything renders inside a closed-over shadow root
 * so host-page CSS cannot leak in (and ours cannot leak out).
 */
export class CroquisWidget {
  private readonly api: WidgetApi;
  private readonly t: (key: MessageKey) => string;
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly layer: HTMLElement;
  private remote: RemoteConfig | null = null;
  private session: ReviewSession | null = null;
  private mode: 'idle' | 'picking' | 'composing' = 'idle';
  private collapsed = false;
  private pinsVisible = false;
  private pins: PublicComment[] = [];
  private hovered: Element | null = null;
  private highlight: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private launcher: HTMLElement | null = null;
  private pinLayer: HTMLElement | null = null;
  private frame = 0;
  private lastUrl = location.href;

  constructor(private readonly config: WidgetConfig) {
    this.api = new WidgetApi(config.apiUrl, config.ingestKey);
    this.t = (key) => messages[config.lang][key];
    this.host = h('div', { [HOST_ATTR]: '', lang: config.lang });
    this.host.style.setProperty('all', 'initial');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = `${tokensCss}\n${widgetCss}`;
    this.layer = h('div', { class: 'cq-root' });
    this.root.append(style, this.layer);
  }

  async start(): Promise<void> {
    try {
      this.remote = await this.api.config();
    } catch (error) {
      console.warn('[croquis]', error instanceof Error ? error.message : error);
      return;
    }
    if (this.remote.widget_mode === 'off') return;
    const projectId = this.remote.project.id;
    this.session = loadSession(projectId);
    if (this.session) this.api.shareToken = this.session.token;

    const slug = takeActivationSlug();
    const active = this.remote.widget_mode === 'always' || this.session !== null || slug !== null;
    if (!active) return;

    document.body.append(this.host);
    installDiagnostics((url) => url.startsWith(this.config.apiUrl));
    this.renderLauncher();
    this.bindGlobalEvents();
    if (slug && (!this.session || this.session.slug !== slug)) await this.openGate(slug);
    else if (this.session) this.setPinsVisible(true);
  }

  // ---------------------------------------------------------------------------
  // Launcher (bottom-right pill)
  // ---------------------------------------------------------------------------

  private renderLauncher(): void {
    this.launcher?.remove();
    const commentButton = h(
      'button',
      {
        type: 'button',
        class: 'cq-pill__action cq-pill__action--primary',
        title: this.t('commentHint'),
        onclick: () => this.startPicking(),
      },
      icon('message'),
      h('span', { class: 'cq-pill__label' }, this.t('comment')),
    );
    const pinsButton = this.session
      ? h(
          'button',
          {
            type: 'button',
            class: `cq-pill__action${this.pinsVisible ? ' is-active' : ''}`,
            'aria-pressed': String(this.pinsVisible),
            title: this.pinsVisible ? this.t('hidePins') : this.t('showPins'),
            onclick: () => this.setPinsVisible(!this.pinsVisible),
          },
          icon('pin'),
          h(
            'span',
            { class: 'cq-pill__count' },
            String(this.pins.filter((p) => !p.resolved_at).length),
          ),
        )
      : null;
    const reviewer = this.session
      ? h(
          'button',
          {
            type: 'button',
            class: 'cq-pill__action cq-pill__action--quiet',
            title: `${this.t('signOut')}`,
            onclick: () => this.signOut(),
          },
          h(
            'span',
            { class: 'cq-avatar', 'aria-hidden': 'true' },
            (this.session.reviewerName[0] ?? '?').toUpperCase(),
          ),
        )
      : null;
    const collapse = h(
      'button',
      {
        type: 'button',
        class: 'cq-pill__action cq-pill__action--quiet',
        title: this.t('collapse'),
        onclick: () => this.setCollapsed(true),
      },
      icon('minus'),
    );
    const expanded = h(
      'div',
      { class: 'cq-pill', role: 'toolbar', 'aria-label': 'Croquis' },
      commentButton,
      pinsButton,
      reviewer,
      collapse,
    );
    const bubble = h(
      'button',
      {
        type: 'button',
        class: 'cq-bubble',
        title: this.t('comment'),
        onclick: () => this.setCollapsed(false),
      },
      icon('message'),
    );
    this.launcher = h('div', { class: 'cq-launcher' }, this.collapsed ? bubble : expanded);
    this.layer.append(this.launcher);
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    if (collapsed) this.setPinsVisible(false);
    this.renderLauncher();
  }

  // ---------------------------------------------------------------------------
  // Review session gate (activated through a share link)
  // ---------------------------------------------------------------------------

  private async openGate(slug: string): Promise<void> {
    let meta: Awaited<ReturnType<WidgetApi['shareMeta']>>;
    try {
      meta = await this.api.shareMeta(slug);
    } catch {
      this.toast(this.t('linkInvalid'), 'error');
      return;
    }
    const previous = this.remote ? loadReviewer(this.remote.project.id) : null;
    const name = h('input', {
      class: 'cq-input',
      name: 'name',
      required: true,
      maxLength: 120,
      autocomplete: 'name',
      value: previous?.name ?? '',
    });
    const password = meta.password_required
      ? h('input', {
          class: 'cq-input',
          name: 'password',
          type: 'password',
          required: true,
          autocomplete: 'current-password',
        })
      : null;
    const error = h('p', { class: 'cq-form__error', role: 'alert' });
    const submit = h(
      'button',
      { type: 'submit', class: 'cq-btn cq-btn--primary' },
      this.t('start'),
    );
    const form = h(
      'form',
      {
        class: 'cq-card cq-gate',
        onsubmit: async (event: Event) => {
          event.preventDefault();
          submit.disabled = true;
          error.textContent = '';
          try {
            const session = await this.api.startSession(slug, {
              name: name.value.trim(),
              password: password?.value,
              reviewer_token: previous?.token,
            });
            this.session = {
              slug,
              token: session.token,
              expiresAt: session.expires_at,
              reviewerToken: session.reviewer_token,
              reviewerName: session.reviewer.name,
            };
            this.api.shareToken = session.token;
            if (this.remote) saveSession(this.remote.project.id, this.session);
            this.closePanel();
            this.renderLauncher();
            this.setPinsVisible(true);
          } catch (err) {
            error.textContent =
              err instanceof WidgetApiError && err.code === 'invalid_password'
                ? this.t('wrongPassword')
                : this.t('failed');
            submit.disabled = false;
          }
        },
      },
      h('p', { class: 'cq-card__eyebrow' }, `${this.t('gateTitle')} · ${meta.project.name}`),
      h('p', { class: 'cq-card__text' }, this.t('gateIntro')),
      h(
        'label',
        { class: 'cq-field' },
        h('span', { class: 'cq-field__label' }, this.t('yourName')),
        name,
      ),
      password
        ? h(
            'label',
            { class: 'cq-field' },
            h('span', { class: 'cq-field__label' }, this.t('password')),
            password,
          )
        : null,
      error,
      h('div', { class: 'cq-card__actions' }, submit),
    );
    this.showPanel(form, 'gate');
    name.focus();
  }

  private signOut(): void {
    if (this.remote) clearSession(this.remote.project.id);
    this.session = null;
    this.api.shareToken = null;
    this.setPinsVisible(false);
    if (this.remote?.widget_mode === 'always') this.renderLauncher();
    else this.host.remove();
  }

  // ---------------------------------------------------------------------------
  // Picking an element
  // ---------------------------------------------------------------------------

  private startPicking(): void {
    if (this.remote?.requires_reviewer && !this.session) return;
    this.closePanel();
    this.mode = 'picking';
    this.highlight = h('div', { class: 'cq-highlight', 'aria-hidden': 'true' });
    this.hint = h(
      'div',
      { class: 'cq-hint', role: 'status' },
      h('span', {}, this.t('selecting')),
      h(
        'button',
        {
          type: 'button',
          class: 'cq-hint__link',
          onclick: () =>
            this.compose({
              element: null,
              anchor: null,
              x: innerWidth / 2,
              y: innerHeight / 3,
              selection: null,
            }),
        },
        this.t('pageComment'),
      ),
    );
    this.layer.append(this.highlight, this.hint);
    ensurePickingCursor();
    document.documentElement.classList.add('croquis-picking');
  }

  private stopPicking(): void {
    this.mode = this.mode === 'picking' ? 'idle' : this.mode;
    this.highlight?.remove();
    this.hint?.remove();
    this.highlight = null;
    this.hint = null;
    this.hovered = null;
    document.documentElement.classList.remove('croquis-picking');
  }

  private isOwn(node: EventTarget | null): boolean {
    return node instanceof Node && (node === this.host || this.host.contains(node));
  }

  private targetAt(event: MouseEvent): Element | null {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || this.isOwn(el) || el === document.documentElement || el === document.body)
      return null;
    return el.closest('[data-croquis-ignore]') ? null : el;
  }

  private onPointerMove = (event: MouseEvent) => {
    if (this.mode !== 'picking' || !this.highlight) return;
    const el = this.targetAt(event);
    if (el === this.hovered) return;
    this.hovered = el;
    if (!el) {
      this.highlight.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    Object.assign(this.highlight.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  };

  private onClick = (event: MouseEvent) => {
    if (this.mode !== 'picking' || this.isOwn(event.target)) return;
    const el = this.targetAt(event);
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    const selection = window.getSelection()?.toString().trim() || null;
    this.compose({
      element: el,
      anchor: captureAnchor(el, event.clientX, event.clientY, selection),
      x: event.clientX,
      y: event.clientY,
      selection,
    });
  };

  // ---------------------------------------------------------------------------
  // Composer
  // ---------------------------------------------------------------------------

  private compose(target: Target): void {
    this.stopPicking();
    this.mode = 'composing';
    let kind: Kind = 'feedback';
    const kinds: [Kind, MessageKey][] = [
      ['feedback', 'kindFeedback'],
      ['bug', 'kindBug'],
      ['question', 'kindQuestion'],
    ];
    const segmented = h('div', { class: 'cq-segmented', role: 'radiogroup' });
    const renderKinds = () => {
      segmented.replaceChildren(
        ...kinds.map(([value, label]) =>
          h(
            'button',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(kind === value),
              class: `cq-segmented__item${kind === value ? ' is-active' : ''}`,
              onclick: () => {
                kind = value;
                renderKinds();
              },
            },
            this.t(label),
          ),
        ),
      );
    };
    renderKinds();

    const body = h('textarea', {
      class: 'cq-textarea',
      required: true,
      maxLength: 4000,
      placeholder: this.t('placeholder'),
      rows: 3,
    });
    const originalText =
      target.selection ??
      (target.anchor?.text && target.anchor.text.length <= 400 ? target.anchor.text : '');
    const original = h('textarea', {
      class: 'cq-textarea cq-textarea--quiet',
      rows: 2,
      maxLength: 4000,
      value: originalText,
    });
    const replacement = h('textarea', {
      class: 'cq-textarea',
      rows: 2,
      maxLength: 4000,
      value: originalText,
    });
    const suggestion = h(
      'div',
      { class: 'cq-suggestion', hidden: true },
      h(
        'label',
        { class: 'cq-field' },
        h('span', { class: 'cq-field__label' }, this.t('currentText')),
        original,
      ),
      h(
        'label',
        { class: 'cq-field' },
        h('span', { class: 'cq-field__label' }, this.t('newText')),
        replacement,
      ),
    );
    const suggestToggle = h(
      'button',
      {
        type: 'button',
        class: 'cq-chip',
        'aria-expanded': 'false',
        onclick: () => {
          suggestion.hidden = !suggestion.hidden;
          suggestToggle.setAttribute('aria-expanded', String(!suggestion.hidden));
          suggestToggle.classList.toggle('is-active', !suggestion.hidden);
          if (!suggestion.hidden) replacement.focus();
        },
      },
      icon('type'),
      this.t('suggestText'),
    );
    const screenshot = h('input', {
      type: 'checkbox',
      class: 'cq-checkbox',
      checked: target.element !== null,
    });
    const anonymous = !this.session;
    const name = anonymous
      ? h('input', {
          class: 'cq-input',
          maxLength: 120,
          autocomplete: 'name',
          placeholder: this.t('yourName'),
        })
      : null;
    const error = h('p', { class: 'cq-form__error', role: 'alert' });
    const sendLabel = h('span', {}, this.t('send'));
    const send = h(
      'button',
      { type: 'submit', class: 'cq-btn cq-btn--primary' },
      icon('send'),
      sendLabel,
    );

    const form = h(
      'form',
      {
        class: 'cq-card cq-composer',
        onsubmit: async (event: Event) => {
          event.preventDefault();
          if (!body.value.trim()) {
            body.focus();
            return;
          }
          send.disabled = true;
          sendLabel.textContent = this.t('sending');
          error.textContent = '';
          form.classList.add('is-busy');
          try {
            const rect = target.element?.getBoundingClientRect() ?? null;
            form.style.visibility = 'hidden';
            const shot = screenshot.checked
              ? await takeScreenshot(this.config.apiUrl, this.host, rect)
              : null;
            form.style.visibility = '';
            const diagnostics = snapshotDiagnostics();
            await this.api.submit({
              page_url: location.href,
              body: body.value.trim(),
              kind,
              author_name: name?.value.trim() || null,
              anchor: target.anchor ?? undefined,
              environment: captureEnvironment(this.config.buildId),
              suggestion:
                !suggestion.hidden && original.value.trim() && replacement.value !== original.value
                  ? { original: original.value.trim(), text: replacement.value.trim() }
                  : undefined,
              screenshot: shot,
              diagnostics:
                kind === 'bug' || diagnostics.console.length || diagnostics.network.length
                  ? diagnostics
                  : undefined,
            });
            this.closePanel();
            this.toast(this.t('sent'), 'success');
            if (this.pinsVisible) await this.refreshPins();
          } catch (err) {
            form.style.visibility = '';
            error.textContent =
              err instanceof WidgetApiError && err.status < 500 && err.message
                ? err.message
                : this.t('failed');
            send.disabled = false;
            sendLabel.textContent = this.t('send');
            form.classList.remove('is-busy');
          }
        },
        onkeydown: (event: KeyboardEvent) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit();
        },
      },
      target.anchor
        ? h(
            'p',
            { class: 'cq-card__eyebrow cq-truncate', title: target.anchor.selector },
            target.anchor.context || `<${target.anchor.tag}>`,
          )
        : h('p', { class: 'cq-card__eyebrow' }, this.t('pageComment')),
      segmented,
      body,
      target.element ? h('div', { class: 'cq-row' }, suggestToggle) : null,
      suggestion,
      name,
      h(
        'div',
        { class: 'cq-card__actions' },
        target.element
          ? h(
              'label',
              { class: 'cq-check' },
              screenshot,
              icon('camera'),
              h('span', {}, this.t('screenshot')),
            )
          : h('span'),
        h(
          'div',
          { class: 'cq-card__buttons' },
          h(
            'button',
            { type: 'button', class: 'cq-btn cq-btn--ghost', onclick: () => this.closePanel() },
            this.t('cancel'),
          ),
          send,
        ),
      ),
      error,
    );
    this.showPanel(form, 'composer', target.x, target.y);
    body.focus();
  }

  // ---------------------------------------------------------------------------
  // Pins
  // ---------------------------------------------------------------------------

  private async setPinsVisible(visible: boolean): Promise<void> {
    this.pinsVisible = visible && this.session !== null;
    if (this.pinsVisible) await this.refreshPins();
    else {
      this.pinLayer?.remove();
      this.pinLayer = null;
    }
    if (this.launcher) this.renderLauncher();
  }

  private async refreshPins(): Promise<void> {
    if (!this.session) return;
    try {
      this.pins = (await this.api.pins(location.href)).data;
    } catch (error) {
      if (error instanceof WidgetApiError && error.status === 401 && this.remote) {
        clearSession(this.remote.project.id);
        this.session = null;
      }
      this.pins = [];
    }
    this.renderPins();
    this.renderLauncher();
  }

  private renderPins(): void {
    this.pinLayer?.remove();
    if (!this.pinsVisible) return;
    this.pinLayer = h('div', { class: 'cq-pins' });
    for (const pin of this.pins) {
      const button = h(
        'button',
        {
          type: 'button',
          class: `cq-pin${pin.resolved_at ? ' cq-pin--resolved' : ''}`,
          'aria-label': `#${pin.number}: ${pin.body.slice(0, 80)}`,
          onclick: (event: MouseEvent) => this.openThread(pin, event.clientX, event.clientY),
        },
        String(pin.number),
      );
      button.dataset.commentId = pin.id;
      this.pinLayer.append(button);
    }
    this.layer.prepend(this.pinLayer);
    this.positionPins();
  }

  /** Pins are `position: fixed`; recompute on scroll/resize in one animation frame. */
  private positionPins = () => {
    if (!this.pinLayer) return;
    for (const button of Array.from(this.pinLayer.children) as HTMLElement[]) {
      const pin = this.pins.find((p) => p.id === button.dataset.commentId);
      if (!pin) continue;
      const el = pin.anchor.status === 'page' ? null : resolveAnchor(document, pin.anchor);
      let x: number;
      let y: number;
      if (el) {
        const rect = el.getBoundingClientRect();
        x = rect.left + rect.width * (pin.anchor.rel_x ?? 0.5);
        y = rect.top + rect.height * (pin.anchor.rel_y ?? 0.5);
        button.classList.remove('cq-pin--orphan');
      } else if (pin.anchor.doc_x !== null && pin.anchor.doc_y !== null) {
        x = pin.anchor.doc_x - scrollX;
        y = pin.anchor.doc_y - scrollY;
        button.classList.add('cq-pin--orphan');
      } else {
        button.hidden = true;
        continue;
      }
      button.hidden = false;
      button.style.left = `${Math.round(x)}px`;
      button.style.top = `${Math.round(y)}px`;
    }
  };

  private schedulePositioning = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.positionPins();
      if (location.href !== this.lastUrl) {
        this.lastUrl = location.href;
        if (this.pinsVisible) void this.refreshPins();
      }
    });
  };

  private async openThread(pin: PublicComment, x: number, y: number): Promise<void> {
    if (!this.session) return;
    let thread: ShareCommentDetail;
    try {
      thread = await this.api.thread(this.session.slug, pin.id);
    } catch {
      this.toast(this.t('failed'), 'error');
      return;
    }
    const replyBox = h('textarea', {
      class: 'cq-textarea',
      rows: 2,
      maxLength: 4000,
      placeholder: this.t('replyPlaceholder'),
    });
    const card = h(
      'form',
      {
        class: 'cq-card cq-thread',
        onsubmit: async (event: Event) => {
          event.preventDefault();
          if (!replyBox.value.trim() || !this.session) return;
          try {
            await this.api.reply(this.session.slug, pin.id, replyBox.value.trim());
            this.closePanel();
            this.toast(this.t('sent'), 'success');
          } catch {
            this.toast(this.t('failed'), 'error');
          }
        },
      },
      h(
        'div',
        { class: 'cq-thread__head' },
        h('span', { class: `cq-status cq-status--${thread.status}` }),
        h('strong', {}, `#${thread.number}`),
        h('span', { class: 'cq-muted' }, thread.author_name ?? ''),
        thread.resolved_at
          ? h('span', { class: 'cq-badge' }, icon('check'), this.t('resolved'))
          : null,
        h(
          'button',
          {
            type: 'button',
            class: 'cq-icon-btn',
            'aria-label': this.t('close'),
            onclick: () => this.closePanel(),
          },
          icon('x'),
        ),
      ),
      h('p', { class: 'cq-thread__body' }, thread.body),
      thread.screenshot_url
        ? h('img', {
            class: 'cq-thread__shot',
            src: `${this.config.apiUrl}${thread.screenshot_url}`,
            alt: '',
            loading: 'lazy',
          })
        : null,
      ...thread.replies.map((r) =>
        h(
          'div',
          { class: 'cq-reply' },
          h('span', { class: 'cq-reply__author' }, r.author_name ?? ''),
          h('p', { class: 'cq-reply__body' }, r.body),
        ),
      ),
      replyBox,
      h(
        'div',
        { class: 'cq-card__actions' },
        h('span'),
        h('button', { type: 'submit', class: 'cq-btn cq-btn--primary' }, this.t('reply')),
      ),
    );
    this.showPanel(card, 'thread', x, y);
  }

  // ---------------------------------------------------------------------------
  // Panels, toasts and global events
  // ---------------------------------------------------------------------------

  private showPanel(node: HTMLElement, kind: string, x?: number, y?: number): void {
    this.closePanel(false);
    this.panel = h(
      'div',
      { class: `cq-panel cq-panel--${kind}`, role: 'dialog', 'aria-modal': 'false' },
      node,
    );
    this.layer.append(this.panel);
    if (x !== undefined && y !== undefined) placeNear(this.panel, x, y);
    else this.panel.classList.add('cq-panel--docked');
  }

  private closePanel(resetMode = true): void {
    this.panel?.remove();
    this.panel = null;
    if (resetMode) this.mode = 'idle';
  }

  private toast(text: string, tone: 'success' | 'error'): void {
    const node = h(
      'div',
      { class: `cq-toast cq-toast--${tone}`, role: tone === 'error' ? 'alert' : 'status' },
      text,
    );
    this.layer.append(node);
    setTimeout(() => node.remove(), 3200);
  }

  private bindGlobalEvents(): void {
    document.addEventListener('mousemove', this.onPointerMove, true);
    document.addEventListener('click', this.onClick, true);
    window.addEventListener('scroll', this.schedulePositioning, { passive: true, capture: true });
    window.addEventListener('resize', this.schedulePositioning, { passive: true });
    window.addEventListener('popstate', this.schedulePositioning);
    // SPA navigations: re-check the URL whenever history changes.
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history);
      history[method] = (...args: Parameters<History['pushState']>) => {
        original(...args);
        this.schedulePositioning();
      };
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (this.mode === 'picking') this.stopPicking();
        else if (this.panel) this.closePanel();
        return;
      }
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
      if (
        !typing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'c' &&
        this.mode === 'idle' &&
        !this.collapsed
      ) {
        this.startPicking();
      }
    });
  }
}
