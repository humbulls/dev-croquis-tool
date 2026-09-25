import { FIELD_LIMITS } from '@croquis/shared/constants';

/**
 * Pins must survive redeploys. Each comment stores several independent ways
 * to find its element again — a CSS selector built from stable attributes, an
 * XPath, and the element's text — plus the click position inside it.
 */

export interface Anchor {
  selector: string;
  xpath: string;
  text_quote: string | null;
  tag: string;
  text: string;
  html: string;
  context: string;
  attrs: string;
  computed_style: string;
  rel_x: number;
  rel_y: number;
  doc_x: number;
  doc_y: number;
}

const STABLE_ATTRIBUTES = [
  'data-croquis-id',
  'data-testid',
  'data-test',
  'data-cy',
  'data-qa',
  'name',
  'aria-label',
];
const COMPUTED_PROPS = [
  'color',
  'background-color',
  'font-size',
  'font-family',
  'font-weight',
  'line-height',
  'padding',
  'margin',
  'display',
];

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);
const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

function cssEscape(value: string): string {
  const native = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape;
  return native ? native(value) : value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

/** Generated ids and class names (React `:r1:`, `ember123`, CSS modules hashes) change between builds. */
function looksGenerated(token: string): boolean {
  return /\d{3,}|^[a-z]{1,3}-[a-z0-9]{5,}$|__[a-z0-9]{4,}$|^:|^css-|^sc-|^jsx-/i.test(token);
}

function unique(doc: Document, selector: string): boolean {
  try {
    return doc.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function stableAttribute(el: Element): string | null {
  for (const name of STABLE_ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (value && value.length <= 80 && !looksGenerated(value))
      return `[${name}="${value.replace(/"/g, '\\"')}"]`;
  }
  return null;
}

function segment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  if (id && !looksGenerated(id)) return `#${cssEscape(id)}`;
  const attribute = stableAttribute(el);
  if (attribute) return `${tag}${attribute}`;
  const classes = Array.from(el.classList)
    .filter((c) => !looksGenerated(c) && !c.includes(':'))
    .slice(0, 2)
    .map((c) => `.${cssEscape(c)}`)
    .join('');
  let part = `${tag}${classes}`;
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(el) + 1})`;
  }
  return part;
}

/** Shortest unique selector built bottom-up from stable attributes. */
export function buildSelector(el: Element): string {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== doc.documentElement && parts.length < 8) {
    parts.unshift(segment(node));
    const candidate = parts.join(' > ');
    if (unique(doc, candidate)) return candidate;
    if (parts[0]?.startsWith('#')) break;
    node = node.parentElement;
  }
  return parts.join(' > ');
}

export function buildXPath(el: Element): string {
  const steps: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1) {
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (!parent) {
      steps.unshift(tag);
      break;
    }
    const same = Array.from(parent.children).filter((c) => c.tagName === node?.tagName);
    steps.unshift(same.length > 1 ? `${tag}[${same.indexOf(node) + 1}]` : tag);
    node = parent;
  }
  return `/${steps.join('/')}`;
}

/** Nearest preceding heading — tells a developer where on the page this is. */
export function headingContext(el: Element): string {
  const headings = Array.from(el.ownerDocument.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  let context = '';
  for (const heading of headings) {
    if (
      heading === el ||
      heading.contains(el) ||
      heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
    ) {
      context = `${heading.tagName.toLowerCase()}: ${squash(heading.textContent ?? '')}`;
    } else {
      break;
    }
  }
  return clip(context, FIELD_LIMITS.elementContext);
}

function attributes(el: Element): string {
  const out: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'style' || attr.name.startsWith('on')) continue;
    out[attr.name] = clip(attr.value, 200);
  }
  return clip(JSON.stringify(out), FIELD_LIMITS.elementAttrs);
}

function computed(el: Element): string {
  const view = el.ownerDocument.defaultView;
  if (!view) return '{}';
  const style = view.getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const prop of COMPUTED_PROPS) out[prop] = style.getPropertyValue(prop).trim();
  return clip(JSON.stringify(out), FIELD_LIMITS.computedStyle);
}

export function captureAnchor(
  el: Element,
  clientX: number,
  clientY: number,
  selection?: string | null,
): Anchor {
  const rect = el.getBoundingClientRect();
  const relX = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const relY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  const text = squash(el.textContent ?? '');
  const quote = squash(selection ?? '') || (text.length > 0 && text.length <= 160 ? text : null);
  const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000;
  return {
    selector: clip(buildSelector(el), FIELD_LIMITS.selector),
    xpath: clip(buildXPath(el), FIELD_LIMITS.xpath),
    text_quote: quote ? clip(quote, FIELD_LIMITS.textQuote) : null,
    tag: clip(el.tagName.toLowerCase(), FIELD_LIMITS.elementTag),
    text: clip(text, FIELD_LIMITS.elementText),
    html: clip(el.outerHTML, FIELD_LIMITS.elementHtml),
    context: headingContext(el),
    attrs: attributes(el),
    computed_style: computed(el),
    rel_x: round(relX),
    rel_y: round(relY),
    doc_x: Math.round(clientX + (el.ownerDocument.defaultView?.scrollX ?? 0)),
    doc_y: Math.round(clientY + (el.ownerDocument.defaultView?.scrollY ?? 0)),
  };
}

interface StoredAnchor {
  selector: string | null;
  xpath: string | null;
  text_quote: string | null;
}

function byXPath(doc: Document, xpath: string): Element | null {
  try {
    const node = doc.evaluate(
      xpath,
      doc,
      null,
      9 /* FIRST_ORDERED_NODE_TYPE */,
      null,
    ).singleNodeValue;
    return node instanceof Element ? node : null;
  } catch {
    return null;
  }
}

function byText(doc: Document, quote: string): Element | null {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const target = squash(quote);
  let best: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!squash(node.textContent ?? '').includes(target.slice(0, 60))) continue;
    let el = node.parentElement;
    // Climb to the smallest element that contains the whole quote.
    while (el && !squash(el.textContent ?? '').includes(target) && el !== doc.body)
      el = el.parentElement;
    if (el && (!best || best.contains(el))) best = el;
  }
  return best;
}

/**
 * Re-find a pinned element: selector, then XPath, then text. A selector or
 * XPath hit is only trusted when the element still contains the quoted text.
 */
export function resolveAnchor(doc: Document, anchor: StoredAnchor): Element | null {
  const quote = anchor.text_quote ? squash(anchor.text_quote).slice(0, 60) : null;
  const matches = (el: Element | null) =>
    el && (!quote || squash(el.textContent ?? '').includes(quote));
  if (anchor.selector) {
    try {
      const el = doc.querySelector(anchor.selector);
      if (matches(el)) return el;
    } catch {
      // invalid selector (older browser syntax) — try the next strategy
    }
  }
  if (anchor.xpath) {
    const el = byXPath(doc, anchor.xpath);
    if (matches(el)) return el;
  }
  if (anchor.text_quote) return byText(doc, anchor.text_quote);
  return null;
}
