import { FIELD_LIMITS } from '@croquis/shared';

/** Rich element metadata captured for a comment target. */
export interface ElementMetadata {
  element_selector: string;
  element_tag: string;
  element_text: string;
  element_html: string;
  element_context: string;
  element_attrs: string;
  computed_style: string;
  rel_x: number;
  rel_y: number;
}

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
] as const;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** CSS.escape with a fallback for environments (e.g. jsdom) that lack it. */
function cssEscape(value: string): string {
  const globalCss = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS;
  if (globalCss?.escape) return globalCss.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

/** Build a reasonably stable CSS selector for an element. */
export function buildSelector(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;

  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;

  while (node && node.nodeType === 1 && depth < 5) {
    if (node.id) {
      parts.unshift(`#${cssEscape(node.id)}`);
      break;
    }
    let part = node.tagName.toLowerCase();
    const classes = Array.from(node.classList)
      .slice(0, 2)
      .map((c) => `.${cssEscape(c)}`)
      .join('');
    part += classes;

    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
    }
    parts.unshift(part);
    node = parent;
    depth += 1;
  }

  return parts.join(' > ');
}

/** Nearest heading (h1-h6) that precedes the element in document order. */
export function buildHeadingContext(el: Element): string {
  const headings = Array.from(el.ownerDocument.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  let context = '';
  for (const heading of headings) {
    const relation = heading.compareDocumentPosition(el);
    // eslint-disable-next-line no-bitwise
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) {
      context = `${heading.tagName.toLowerCase()}: ${(heading.textContent ?? '').trim()}`;
    } else {
      break;
    }
  }
  return truncate(context, FIELD_LIMITS.elementContext);
}

function serializeAttrs(el: Element): string {
  const obj: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) obj[attr.name] = attr.value;
  return truncate(JSON.stringify(obj), FIELD_LIMITS.elementAttrs);
}

function serializeComputedStyle(el: Element): string {
  const view = el.ownerDocument.defaultView;
  if (!view) return '{}';
  const cs = view.getComputedStyle(el);
  const obj: Record<string, string> = {};
  for (const prop of COMPUTED_PROPS) obj[prop] = cs.getPropertyValue(prop).trim();
  return truncate(JSON.stringify(obj), FIELD_LIMITS.computedStyle);
}

/** Collect all metadata for an element given the click coordinates. */
export function collectMetadata(el: Element, clientX: number, clientY: number): ElementMetadata {
  const rect = el.getBoundingClientRect();
  const relX = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const relY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;

  return {
    element_selector: truncate(buildSelector(el), FIELD_LIMITS.selector),
    element_tag: truncate(el.tagName.toLowerCase(), FIELD_LIMITS.elementTag),
    element_text: truncate((el.textContent ?? '').replace(/\s+/g, ' ').trim(), FIELD_LIMITS.elementText),
    element_html: truncate(el.outerHTML, FIELD_LIMITS.elementHtml),
    element_context: buildHeadingContext(el),
    element_attrs: serializeAttrs(el),
    computed_style: serializeComputedStyle(el),
    rel_x: Number(Math.min(1, Math.max(0, relX)).toFixed(4)),
    rel_y: Number(Math.min(1, Math.max(0, relY)).toFixed(4)),
  };
}
