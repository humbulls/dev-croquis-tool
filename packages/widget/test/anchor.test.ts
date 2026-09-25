import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildSelector,
  buildXPath,
  captureAnchor,
  headingContext,
  resolveAnchor,
} from '../src/anchor';

beforeEach(() => {
  document.body.innerHTML = `
    <header><h1>Pricing</h1></header>
    <main>
      <section class="plans">
        <h2>Plans</h2>
        <div class="card css-1x2y3z"><p>Starter</p><a class="btn" href="#">Buy now</a></div>
        <div class="card"><p>Pro</p><a class="btn" data-testid="buy-pro" href="#">Buy now</a></div>
      </section>
      <button id=":r3:">Generated id</button>
      <button id="signup">Sign up</button>
    </main>`;
});

const $ = (selector: string) => document.querySelector(selector) as Element;

describe('buildSelector', () => {
  it('prefers stable ids and test attributes', () => {
    expect(buildSelector($('#signup'))).toBe('#signup');
    expect(buildSelector($('[data-testid="buy-pro"]'))).toBe('a[data-testid="buy-pro"]');
  });

  it('ignores generated ids and hashed classes but stays unique', () => {
    const generated = document.getElementById(':r3:') as Element;
    const selector = buildSelector(generated);
    expect(selector).not.toContain(':r3:');
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    const starter = $('.plans .card:first-of-type .btn');
    const starterSelector = buildSelector(starter);
    expect(starterSelector).not.toContain('css-1x2y3z');
    expect(document.querySelector(starterSelector)).toBe(starter);
  });
});

describe('capture and resolve', () => {
  it('captures text, context and click position', () => {
    const el = $('#signup');
    const anchor = captureAnchor(el, 0, 0);
    expect(anchor).toMatchObject({
      tag: 'button',
      text: 'Sign up',
      text_quote: 'Sign up',
      context: 'h2: Plans',
    });
    expect(buildXPath(el)).toBe('/html/body/main/button[2]');
    expect(headingContext($('h1'))).toBe('h1: Pricing');
  });

  it('uses the selected text as the quote', () => {
    const anchor = captureAnchor($('.plans .card p'), 0, 0, '  Starter  ');
    expect(anchor.text_quote).toBe('Starter');
  });

  it('falls back from selector to XPath to text when the DOM changes', () => {
    const el = $('#signup');
    const anchor = captureAnchor(el, 0, 0);
    // Redeploy: the id is gone, the structure is the same → XPath finds it.
    el.removeAttribute('id');
    expect(resolveAnchor(document, anchor)).toBe(el);
    // Structure changes too → the text still finds it.
    const wrapper = document.createElement('div');
    document.body.prepend(wrapper);
    wrapper.append(el);
    expect(resolveAnchor(document, anchor)).toBe(el);
  });

  it('does not trust a selector whose element no longer has the quoted text', () => {
    const anchor = { selector: '#signup', xpath: null, text_quote: 'Start free trial' };
    expect(resolveAnchor(document, anchor)).toBeNull();
  });
});
