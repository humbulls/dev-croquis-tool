import { signal } from '@preact/signals';

export type Theme = 'system' | 'light' | 'dark';

function saved(): Theme {
  try {
    const value = localStorage.getItem('croquis:theme');
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // ignore
  }
  return 'system';
}

export const theme = signal<Theme>(typeof window === 'undefined' ? 'system' : saved());

/** `data-theme` overrides the OS preference; tokens.css handles both. */
export function applyTheme(next: Theme = theme.value): void {
  theme.value = next;
  if (next === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('croquis:theme', next);
  } catch {
    // ignore
  }
}
