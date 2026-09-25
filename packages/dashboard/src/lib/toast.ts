import { signal } from '@preact/signals';

export interface Toast {
  id: number;
  text: string;
  tone: 'default' | 'error';
  action?: { label: string; run: () => void };
}

export const toasts = signal<Toast[]>([]);
let next = 1;

export function toast(text: string, options: Partial<Omit<Toast, 'id' | 'text'>> = {}): void {
  const item: Toast = { id: next++, text, tone: options.tone ?? 'default', action: options.action };
  toasts.value = [...toasts.value, item];
  setTimeout(() => dismiss(item.id), item.action ? 6000 : 3500);
}

export function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
