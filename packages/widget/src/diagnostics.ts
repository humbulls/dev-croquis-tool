import { FIELD_LIMITS } from '@croquis/shared/constants';

/**
 * A small ring buffer of console errors/warnings and failed network requests,
 * attached to bug reports. Request and response bodies are never recorded,
 * and query strings are stripped from URLs (they often carry tokens).
 */

export interface ConsoleEntry {
  level: 'error' | 'warn' | 'info' | 'log';
  message: string;
  at: number;
}
export interface NetworkEntry {
  method: string;
  url: string;
  status: number;
  duration_ms: number;
  at: number;
}

const MAX = FIELD_LIMITS.diagnosticsEntries;
const consoleEntries: ConsoleEntry[] = [];
const networkEntries: NetworkEntry[] = [];
let installed = false;

function push<T>(list: T[], entry: T): void {
  list.push(entry);
  if (list.length > MAX) list.shift();
}

function stripQuery(url: string): string {
  try {
    const parsed = new URL(url, location.href);
    return `${parsed.origin}${parsed.pathname}`.slice(0, FIELD_LIMITS.url);
  } catch {
    return url.split('?')[0]?.slice(0, FIELD_LIMITS.url) ?? '';
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Start recording. `ignore` filters out the widget's own traffic. */
export function installDiagnostics(ignore: (url: string) => boolean): void {
  if (installed) return;
  installed = true;

  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(consoleEntries, {
        level,
        message: args.map(describe).join(' ').slice(0, 2000),
        at: Date.now(),
      });
      original(...args);
    };
  }
  window.addEventListener('error', (event) => {
    push(consoleEntries, {
      level: 'error',
      message: `${event.message} (${stripQuery(event.filename || '')}:${event.lineno})`.slice(
        0,
        2000,
      ),
      at: Date.now(),
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    push(consoleEntries, {
      level: 'error',
      message: `Unhandled rejection: ${describe(event.reason)}`.slice(0, 2000),
      at: Date.now(),
    });
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = performance.now();
    const url = input instanceof Request ? input.url : String(input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    try {
      const response = await originalFetch(input, init);
      if (response.status >= 400 && !ignore(url)) {
        push(networkEntries, {
          method,
          url: stripQuery(url),
          status: response.status,
          duration_ms: Math.round(performance.now() - started),
          at: Date.now(),
        });
      }
      return response;
    } catch (error) {
      if (!ignore(url)) {
        push(networkEntries, {
          method,
          url: stripQuery(url),
          status: 0,
          duration_ms: Math.round(performance.now() - started),
          at: Date.now(),
        });
      }
      throw error;
    }
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest & { __cq?: { method: string; url: string } },
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this.__cq = { method: method.toUpperCase(), url: String(url) };
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function patchedSend(
    this: XMLHttpRequest & { __cq?: { method: string; url: string } },
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const started = performance.now();
    this.addEventListener('loadend', () => {
      const meta = this.__cq;
      if (meta && (this.status >= 400 || this.status === 0) && !ignore(meta.url)) {
        push(networkEntries, {
          method: meta.method,
          url: stripQuery(meta.url),
          status: this.status,
          duration_ms: Math.round(performance.now() - started),
          at: Date.now(),
        });
      }
    });
    return send.call(this, body);
  };
}

export function snapshotDiagnostics(): { console: ConsoleEntry[]; network: NetworkEntry[] } {
  return { console: [...consoleEntries], network: [...networkEntries] };
}

/** Test helper. */
export function resetDiagnostics(): void {
  consoleEntries.length = 0;
  networkEntries.length = 0;
}
