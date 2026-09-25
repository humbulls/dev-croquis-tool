import { describe, expect, it } from 'vitest';
import { locale, setLocale, t, timeAgo } from './i18n';

describe('i18n', () => {
  it('interpolates placeholders and switches language', () => {
    setLocale('en');
    expect(t('projects.pages', { count: 3 })).toBe('3 pages');
    setLocale('ja');
    expect(t('projects.pages', { count: 3 })).toBe('3 ページ');
    expect(document.documentElement.lang).toBe('ja');
    setLocale('en');
    expect(locale.value).toBe('en');
  });

  it('formats relative times', () => {
    setLocale('en');
    expect(timeAgo(Date.now())).toBe('just now');
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe('5 minutes ago');
  });
});
