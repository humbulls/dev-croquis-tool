import { describe, it, expect } from 'vitest';
import { buildSelector, buildHeadingContext, collectMetadata } from '../src/metadata';

describe('buildSelector', () => {
  it('uses an id selector when present', () => {
    document.body.innerHTML = '<div id="hero"></div>';
    const el = document.getElementById('hero')!;
    expect(buildSelector(el)).toBe('#hero');
  });

  it('builds a path with nth-of-type that resolves back to the element', () => {
    document.body.innerHTML = '<section><p class="a">1</p><p class="a">2</p></section>';
    const second = document.querySelectorAll('p')[1]!;
    const selector = buildSelector(second);
    expect(selector).toContain('p.a:nth-of-type(2)');
    expect(document.querySelector(selector)).toBe(second);
  });
});

describe('buildHeadingContext', () => {
  it('captures the nearest preceding heading', () => {
    document.body.innerHTML = '<h2>Pricing</h2><button id="cta">Buy</button>';
    const cta = document.getElementById('cta')!;
    expect(buildHeadingContext(cta)).toBe('h2: Pricing');
  });
});

describe('collectMetadata', () => {
  it('collects tag, text, selector, attrs and clamped rel coordinates', () => {
    document.body.innerHTML = '<button id="b" class="cta" data-x="1">Buy now</button>';
    const b = document.getElementById('b')!;
    const meta = collectMetadata(b, 0, 0);
    expect(meta.element_tag).toBe('button');
    expect(meta.element_text).toBe('Buy now');
    expect(meta.element_selector).toBe('#b');
    expect(JSON.parse(meta.element_attrs)['data-x']).toBe('1');
    expect(meta.rel_x).toBeGreaterThanOrEqual(0);
    expect(meta.rel_x).toBeLessThanOrEqual(1);
    expect(meta.rel_y).toBeGreaterThanOrEqual(0);
  });
});
