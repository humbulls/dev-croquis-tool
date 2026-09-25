import { domToJpeg } from 'modern-screenshot';

/**
 * Screenshot module, built as a separate file (widget-capture.js) and loaded
 * only when a reviewer attaches a screenshot, so the core widget stays small.
 * Captures the visible viewport; the widget itself and elements marked
 * `data-croquis-mask` (or password fields) are hidden or blanked.
 */
interface CaptureOptions {
  hostSelector: string;
  highlight: DOMRect | null;
  maxWidth: number;
  /** Resolved token values from the widget (the page has no access to our CSS). */
  colors: { outline: string; mask: string };
}

async function capture(options: CaptureOptions): Promise<string> {
  const { scrollX, scrollY, innerWidth, innerHeight } = window;
  const scale = Math.min(window.devicePixelRatio || 1, options.maxWidth / innerWidth, 2);
  const dataUrl = await domToJpeg(document.documentElement, {
    width: innerWidth,
    height: innerHeight,
    scale,
    quality: 0.82,
    timeout: 8000,
    backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
    style: { transform: `translate(${-scrollX}px, ${-scrollY}px)` },
    filter: (node) => !(node instanceof Element && node.matches(options.hostSelector)),
    onCloneEachNode: (cloned) => {
      if (
        cloned instanceof HTMLElement &&
        cloned.matches('[data-croquis-mask], input[type="password"]')
      ) {
        cloned.style.setProperty('color', 'transparent', 'important');
        cloned.style.setProperty('background', options.colors.mask, 'important');
        cloned.style.setProperty('text-shadow', 'none', 'important');
        for (const child of Array.from(cloned.children))
          (child as HTMLElement).style?.setProperty('visibility', 'hidden', 'important');
      }
    },
  });
  if (!options.highlight) return dataUrl;
  return outline(dataUrl, options.highlight, scale, options.colors.outline);
}

/** Draw an outline around the commented element (the "annotation"). */
async function outline(
  dataUrl: string,
  rect: DOMRect,
  scale: number,
  color: string,
): Promise<string> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(image, 0, 0);
  ctx.lineWidth = Math.max(2, 3 * scale);
  ctx.strokeStyle = color;
  const pad = 4 * scale;
  ctx.strokeRect(
    rect.left * scale - pad,
    rect.top * scale - pad,
    rect.width * scale + pad * 2,
    rect.height * scale + pad * 2,
  );
  return canvas.toDataURL('image/jpeg', 0.82);
}

(window as unknown as { __croquisCapture?: typeof capture }).__croquisCapture = capture;
