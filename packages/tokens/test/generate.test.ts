import { describe, it, expect } from 'vitest';
import {
  flatten,
  camelKey,
  cssVarName,
  isAlias,
  aliasToPath,
  resolveCssValue,
  generate,
} from '../src/lib/generate';

describe('helpers', () => {
  it('detects aliases', () => {
    expect(isAlias('{color.brand.600}')).toBe(true);
    expect(isAlias('#ffffff')).toBe(false);
  });

  it('converts alias to path', () => {
    expect(aliasToPath('{color.brand.600}')).toEqual(['color', 'brand', '600']);
  });

  it('builds namespaced css var names and camel keys', () => {
    expect(cssVarName(['color', 'status', 'in-progress'])).toBe('--cq-color-status-in-progress');
    expect(cssVarName(['color', 'brand', '600'], 'x')).toBe('--x-color-brand-600');
    expect(camelKey(['color', 'status', 'in-progress'])).toBe('colorStatusInProgress');
    expect(camelKey(['font', 'size', '2xl'])).toBe('fontSize2xl');
  });

  it('resolves css values with the namespace', () => {
    expect(resolveCssValue('#fff')).toBe('#fff');
    expect(resolveCssValue('{color.brand.600}')).toBe('var(--cq-color-brand-600)');
  });
});

describe('flatten', () => {
  it('inherits $type and flattens groups', () => {
    const flat = flatten({
      color: {
        $type: 'color',
        brand: { '600': { $value: '#4f46e5' } },
      },
    });
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({ path: ['color', 'brand', '600'], type: 'color', value: '#4f46e5' });
  });
});

describe('generate', () => {
  it('emits namespaced css with resolved aliases and shadow-dom-safe selector', () => {
    const result = generate([
      { color: { $type: 'color', brand: { '600': { $value: '#4f46e5' } } } },
      { color: { $type: 'color', accent: { default: { $value: '{color.brand.600}' } } } },
    ]);
    expect(result.css).toContain(':where(:root, :host) {');
    expect(result.css).toContain('--cq-color-brand-600: #4f46e5;');
    expect(result.css).toContain('--cq-color-accent-default: var(--cq-color-brand-600);');
    expect(result.tokens.colorAccentDefault).toBe('var(--cq-color-accent-default)');
    expect(result.js).toContain('export const tokens');
    expect(result.dts).toContain('readonly colorAccentDefault: string;');
  });

  it('throws on an alias pointing to an unknown token', () => {
    expect(() =>
      generate([{ color: { $type: 'color', x: { $value: '{color.does.not.exist}' } } }]),
    ).toThrow(/unknown token/);
  });

  it('throws on duplicate tokens', () => {
    expect(() =>
      generate([
        { color: { $type: 'color', brand: { '600': { $value: '#111' } } } },
        { color: { $type: 'color', brand: { '600': { $value: '#222' } } } },
      ]),
    ).toThrow(/Duplicate token/);
  });
});
