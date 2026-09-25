type CaptureFn = (options: {
  hostSelector: string;
  highlight: DOMRect | null;
  maxWidth: number;
  colors: { outline: string; mask: string };
}) => Promise<string>;

let loading: Promise<CaptureFn> | null = null;

/** Load widget-capture.js from the Croquis instance on first use. */
function loadCapture(apiUrl: string): Promise<CaptureFn> {
  const existing = (window as unknown as { __croquisCapture?: CaptureFn }).__croquisCapture;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise<CaptureFn>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${apiUrl}/widget-capture.js`;
    script.async = true;
    script.onload = () => {
      const fn = (window as unknown as { __croquisCapture?: CaptureFn }).__croquisCapture;
      if (fn) resolve(fn);
      else reject(new Error('capture module did not register'));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error('capture module failed to load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** A JPEG data URL of the viewport, or null if capturing is impossible on this page. */
export async function takeScreenshot(
  apiUrl: string,
  host: HTMLElement,
  highlight: DOMRect | null,
): Promise<string | null> {
  try {
    const capture = await loadCapture(apiUrl);
    const style = getComputedStyle(host);
    const colors = {
      outline: style.getPropertyValue('--cq-color-accent-default').trim(),
      mask: style.getPropertyValue('--cq-color-neutral-400').trim(),
    };
    return await capture({
      hostSelector: '[data-croquis-widget]',
      highlight,
      maxWidth: 1600,
      colors,
    });
  } catch {
    return null;
  }
}
