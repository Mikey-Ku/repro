import { describe, expect, it } from 'vitest';
import { sanitizeRrwebEvent, sanitizeUrlAttribute } from '../src/index.js';

describe('sanitizeRrwebEvent', () => {
  it('redacts the page href in the Meta event', () => {
    const event = { type: 4, data: { href: 'http://shop/checkout?ref=email&token=CANARY_QS', width: 1, height: 1 }, timestamp: 1 };
    const out = sanitizeRrwebEvent(event);
    expect(out.data.href).toBe('http://shop/checkout?ref=email&token=%5Bredacted%5D');
  });

  it('redacts URL attributes inside a full snapshot, leaving other attributes alone', () => {
    const event = {
      type: 2,
      timestamp: 1,
      data: {
        node: {
          type: 0,
          childNodes: [
            {
              type: 2,
              tagName: 'html',
              attributes: {},
              childNodes: [
                { type: 2, tagName: 'a', attributes: { href: '/reset?token=CANARY_A', class: 'token' }, childNodes: [] },
                { type: 2, tagName: 'form', attributes: { action: 'https://api/x?apiKey=CANARY_B', method: 'post' }, childNodes: [] },
                { type: 2, tagName: 'img', attributes: { src: 'https://cdn/img.png?sig=CANARY_C&w=10', alt: 'token=notaurl' }, childNodes: [] },
                { type: 3, textContent: 'token=CANARY_TEXT_LEFT_ALONE' },
              ],
            },
          ],
        },
        initialOffset: { left: 0, top: 0 },
      },
    };
    const json = JSON.stringify(sanitizeRrwebEvent(event));
    expect(json).not.toContain('CANARY_A');
    expect(json).not.toContain('CANARY_B');
    expect(json).not.toContain('CANARY_C');
    expect(json).toContain('w=10');
    expect(json).toContain('"class":"token"');
    expect(json).toContain('"alt":"token=notaurl"');
    // Text nodes are the application's responsibility (data-repro-mask); the walker does not touch them.
    expect(json).toContain('CANARY_TEXT_LEFT_ALONE');
  });

  it('redacts URL attributes in mutation adds and attribute changes', () => {
    const event = {
      type: 3,
      timestamp: 1,
      data: {
        source: 0,
        texts: [],
        removes: [],
        adds: [{ parentId: 1, nextId: null, node: { type: 2, tagName: 'a', attributes: { href: '/x?session=CANARY_D' }, childNodes: [], id: 9 } }],
        attributes: [{ id: 3, attributes: { href: 'http://h/p#access_token=CANARY_E', title: 'ok' } }],
      },
    };
    const json = JSON.stringify(sanitizeRrwebEvent(event));
    expect(json).not.toContain('CANARY_D');
    expect(json).not.toContain('CANARY_E');
    expect(json).toContain('"title":"ok"');
  });

  it('ignores events without URL data', () => {
    const event = { type: 3, timestamp: 1, data: { source: 1, positions: [{ x: 1, y: 2, id: 3, timeOffset: 0 }] } };
    expect(sanitizeRrwebEvent(structuredClone(event))).toEqual(event);
  });
});

describe('sanitizeCssUrls', () => {
  it('redacts query strings inside url() in inline styles and inlined stylesheets', () => {
    const event = {
      type: 2,
      timestamp: 1,
      data: {
        node: {
          type: 2,
          tagName: 'div',
          attributes: { style: 'background-image: url("https://cdn/x.png?token=CANARY_F"); color: red' },
          childNodes: [{ type: 2, tagName: 'style', attributes: { _cssText: ".a{background:url('/i.png?sig=CANARY_G')}" }, childNodes: [] }],
        },
        initialOffset: { left: 0, top: 0 },
      },
    };
    const json = JSON.stringify(sanitizeRrwebEvent(event));
    expect(json).not.toContain('CANARY_F');
    expect(json).not.toContain('CANARY_G');
    expect(json).toContain('color: red');
  });
});

describe('sanitizeUrlAttribute', () => {
  it('keeps relative references relative', () => {
    expect(sanitizeUrlAttribute('/checkout?token=x&page=2')).toBe('/checkout?token=%5Bredacted%5D&page=2');
    expect(sanitizeUrlAttribute('/plain')).toBe('/plain');
  });
});
