import { describe, expect, it } from 'vitest';
import {
  matchPage,
  normalizeOrigin,
  normalizePath,
  pagePathFromUrl,
  pathMatches,
  stripBasePath,
  viewportKind,
} from '../src/url';

describe('normalizeOrigin', () => {
  it('lowercases and drops default ports and paths', () => {
    expect(normalizeOrigin('HTTPS://Example.COM:443/a?b=1')).toBe('https://example.com');
    expect(normalizeOrigin('http://localhost:5173/x')).toBe('http://localhost:5173');
  });
  it('rejects non-http(s) and garbage', () => {
    expect(normalizeOrigin('file:///etc/passwd')).toBeNull();
    expect(normalizeOrigin('not a url')).toBeNull();
  });
});

describe('normalizePath', () => {
  it.each([
    ['/', '/'],
    ['', '/'],
    ['/about/', '/about'],
    ['/about.html', '/about'],
    ['/blog/index.html', '/blog'],
    ['//a///b//', '/a/b'],
    ['/a?x=1#y', '/a'],
    ['/%E6%96%99%E9%87%91', '/料金'],
    ['/bad%E0', '/bad%E0'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe('stripBasePath / pagePathFromUrl', () => {
  it('removes a mount prefix only at a segment boundary', () => {
    expect(stripBasePath('/docs/intro', '/docs')).toBe('/intro');
    expect(stripBasePath('/docs', '/docs/')).toBe('/');
    expect(stripBasePath('/docsify', '/docs')).toBe('/docsify');
  });
  it('derives a path from a full URL', () => {
    expect(pagePathFromUrl('https://acme.test/pricing/?utm=x#top')).toBe('/pricing');
    expect(pagePathFromUrl('https://acme.test/lp/v2/index.html', '/lp')).toBe('/v2');
  });
});

describe('pathMatches', () => {
  it('matches params and trailing wildcards', () => {
    expect(pathMatches('/blog/:slug', '/blog/hello')).toBe(true);
    expect(pathMatches('/blog/:slug', '/blog/hello/extra')).toBe(false);
    expect(pathMatches('/docs/*', '/docs/a/b')).toBe(true);
    expect(pathMatches('/docs/*', '/docs')).toBe(true);
    expect(pathMatches('/about', '/about/')).toBe(true);
    expect(pathMatches('/about', '/contact')).toBe(false);
  });
});

describe('matchPage', () => {
  const pages = [
    { pageId: 'home', path: '/' },
    { pageId: 'blog', path: '/blog' },
    { pageId: 'post', path: '/blog/:slug' },
    { pageId: 'docs', path: '/docs/*' },
    { pageId: 'docs-api', path: '/docs/api/:name' },
  ];

  it('prefers exact matches over patterns', () => {
    expect(matchPage('/blog', pages)).toBe('blog');
    expect(matchPage('/', pages)).toBe('home');
  });
  it('falls back to the most specific pattern', () => {
    expect(matchPage('/blog/hello-world', pages)).toBe('post');
    expect(matchPage('/docs/api/users', pages)).toBe('docs-api');
    expect(matchPage('/docs/guide/intro', pages)).toBe('docs');
  });
  it('uses learned aliases for exact paths', () => {
    expect(matchPage('/company', pages, [{ pageId: 'home', path: '/company/' }])).toBe('home');
  });
  it('returns null when nothing matches (unassigned inbox)', () => {
    expect(matchPage('/contact', pages)).toBeNull();
  });
});

describe('viewportKind', () => {
  it('buckets widths', () => {
    expect(viewportKind(375)).toBe('mobile');
    expect(viewportKind(768)).toBe('tablet');
    expect(viewportKind(1440)).toBe('desktop');
  });
});
