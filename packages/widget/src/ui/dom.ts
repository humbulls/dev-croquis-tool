/**
 * Minimal hyperscript for building the widget UI without a framework.
 * `h('button', { class: 'cq-btn', onclick }, 'Send')`
 */

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string };

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in el && typeof value !== 'string') {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 16px stroke icons (Lucide-style paths, drawn with currentColor). */
const ICONS = {
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  pin: 'M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  x: 'M18 6 6 18 M6 6l12 12',
  chevron: 'M6 9l6 6 6-6',
  check: 'M20 6 9 17l-5-5',
  camera:
    'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  type: 'M4 7V4h16v3 M9 20h6 M12 4v16',
  minus: 'M5 12h14',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7z',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'cq-icon');
  for (const d of ICONS[name].split(' M')) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d.startsWith('M') ? d : `M${d}`);
    svg.append(path);
  }
  return svg;
}

/** Keep a floating box inside the viewport, preferring below-right of the point. */
export function placeNear(box: HTMLElement, x: number, y: number, margin = 12): void {
  const { innerWidth, innerHeight } = window;
  const width = box.offsetWidth || 340;
  const height = box.offsetHeight || 280;
  let left = x + margin;
  let top = y + margin;
  if (left + width > innerWidth - margin) left = Math.max(margin, x - width - margin);
  if (top + height > innerHeight - margin) top = Math.max(margin, innerHeight - height - margin);
  box.style.left = `${Math.round(left)}px`;
  box.style.top = `${Math.round(top)}px`;
}
